// Agent Chat: a small local app service. It serves the chat page, runs the agent loop,
// and runs tools, skills and (later) MCP servers on this laptop.
// Start it with: node server.js
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { exec, spawn } from "node:child_process";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const P = {
  env: path.join(ROOT, ".env"),
  config: path.join(ROOT, "agent.json"),
  tools: path.join(ROOT, "tools"),
  skills: path.join(ROOT, "skills"),
  output: path.join(ROOT, "output"),
  resources: path.join(ROOT, "resources"),
  oldTemplates: path.join(ROOT, "templates"),
  public: path.join(ROOT, "public"),
  worker: path.join(ROOT, "lib", "tool-worker.js"),
};
const TOKEN = crypto.randomBytes(24).toString("hex");
const APP_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
const TOOL_TIMEOUT_MS = 30000;
const MAX_ROUNDS = 8;
const MAX_TOOL_RETRIES = 3;
const SCRIPT_TIMEOUT_MS = 60000;

const PROVIDERS = {
  groq: { label: "Groq (free, fast)", baseUrl: "https://api.groq.com/openai/v1", model: "openai/gpt-oss-20b", models: ["openai/gpt-oss-20b", "openai/gpt-oss-120b"], keyUrl: "https://console.groq.com/keys" },
  gemini: { label: "Google Gemini (free)", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-flash-lite-latest", models: ["gemini-flash-lite-latest", "gemini-flash-latest"], keyUrl: "https://aistudio.google.com/apikey" },
  openrouter: { label: "OpenRouter (free models)", baseUrl: "https://openrouter.ai/api/v1", model: "openrouter/free", models: ["openrouter/free"], keyUrl: "https://openrouter.ai/keys" },
  custom: { label: "Other (OpenAI-compatible)", baseUrl: "", model: "", models: [], keyUrl: "" },
};

const DEFAULT_INSTRUCTIONS =
  "You are a helpful office assistant for Bakkerij De Zoete Korst, a small bakery in Utrecht.\n" +
  "Use your tools whenever they help. Never guess numbers: use the calculator.\n" +
  "Keep answers short and friendly. Always answer in the language the user writes in.\n" +
  "Write money amounts in euros with a comma for decimals, like € 12,50. Plain numbers and percentages are not money.";

const ENV_HEADER = `# Agent Chat keys and settings.
# This file stays on your laptop. Never share it and never put it online.
# The app writes the LLM_ lines when you change Settings. Add keys for other services below.
`;

// ---------- .env: keys and model settings ----------
function readEnv() {
  const out = {};
  if (!fs.existsSync(P.env)) return out;
  for (const line of fs.readFileSync(P.env, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
  }
  return out;
}

// Updates or adds keys and keeps the rest of the file (comments, order) as it is. A value of null removes the key.
function writeEnv(updates) {
  const lines = fs.existsSync(P.env) ? fs.readFileSync(P.env, "utf8").split(/\r?\n/) : ENV_HEADER.split("\n");
  const seen = new Set();
  const result = [];
  for (const line of lines) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (m && m[1] in updates) {
      seen.add(m[1]);
      if (updates[m[1]] !== null) result.push(`${m[1]}=${quoteEnv(updates[m[1]])}`);
    } else result.push(line);
  }
  for (const [k, v] of Object.entries(updates)) if (!seen.has(k) && v !== null) result.push(`${k}=${quoteEnv(v)}`);
  fs.writeFileSync(P.env, result.join("\n").replace(/\n*$/, "\n"), { mode: 0o600 });
}
function quoteEnv(v) { v = String(v ?? ""); return /[\s#"']/.test(v) ? JSON.stringify(v) : v; }

function ensureEnv() {
  if (fs.existsSync(P.env)) return;
  writeEnv({ LLM_PROVIDER: "groq", LLM_BASE_URL: PROVIDERS.groq.baseUrl, LLM_MODEL: PROVIDERS.groq.model, LLM_API_KEY: "" });
}

function llmSettings() {
  const env = readEnv();
  const provider = env.LLM_PROVIDER || "groq";
  return {
    provider,
    baseUrl: env.LLM_BASE_URL || PROVIDERS[provider]?.baseUrl || "",
    model: env.LLM_MODEL || PROVIDERS[provider]?.model || "",
    apiKey: env.LLM_API_KEY || "",
  };
}

// ---------- agent.json: instructions and on/off switches ----------
function readConfig() {
  let c = {};
  try { c = JSON.parse(fs.readFileSync(P.config, "utf8")); } catch { /* first run */ }
  return { instructions: DEFAULT_INSTRUCTIONS, disabledTools: [], disabledSkills: [], allowedSkillScripts: [], vision: {}, ...c };
}
function writeConfig(changes) {
  const c = { ...readConfig(), ...changes };
  fs.writeFileSync(P.config, JSON.stringify(c, null, 2));
  return c;
}

// ---------- Tools: one file per tool in tools/ ----------
const toolCache = new Map(); // file name -> { mtime, meta, error }

function runWorker(action, code, file, args, env) {
  return new Promise((resolve) => {
    const worker = new Worker(P.worker, { workerData: { action, code, file, args, env, outputDir: P.output, resourcesDir: P.resources } });
    const timer = setTimeout(() => {
      worker.terminate();
      resolve({ ok: false, error: `The tool took longer than ${TOOL_TIMEOUT_MS / 1000} seconds and was stopped` });
    }, TOOL_TIMEOUT_MS);
    worker.once("message", (msg) => { clearTimeout(timer); worker.terminate(); resolve(msg); });
    worker.once("error", (err) => { clearTimeout(timer); resolve({ ok: false, error: String(err.message || err) }); });
  });
}

async function listTools() {
  fs.mkdirSync(P.tools, { recursive: true });
  const config = readConfig();
  const files = fs.readdirSync(P.tools).filter((f) => f.endsWith(".js"));
  for (const cached of [...toolCache.keys()]) if (!files.includes(cached)) toolCache.delete(cached);
  const tools = [];
  for (const f of files) {
    const full = path.join(P.tools, f);
    const mtime = fs.statSync(full).mtimeMs;
    let entry = toolCache.get(f);
    if (!entry || entry.mtime !== mtime) {
      const res = await runWorker("describe", fs.readFileSync(full, "utf8"), full);
      entry = { mtime, meta: res.ok ? res.meta : null, error: res.ok ? null : res.error };
      toolCache.set(f, entry);
    }
    tools.push({ file: f, ...(entry.meta || { name: f.replace(/\.js$/, ""), description: "", inputs: {}, needs: [], ask_first: false }), error: entry.error, enabled: !entry.error && !config.disabledTools.includes(entry.meta?.name) });
  }
  return tools.sort((a, b) => a.name.localeCompare(b.name));
}

async function runTool(tool, args) {
  const env = readEnv();
  const allowed = Object.fromEntries((tool.needs || []).map((k) => [k, env[k] ?? ""]));
  const code = fs.readFileSync(path.join(P.tools, tool.file), "utf8");
  return runWorker("run", code, path.join(P.tools, tool.file), args, allowed);
}

// ---------- Resources: templates, price lists, logos and other files tools use ----------
function listResourceFiles() {
  const out = [];
  const walk = (dir, prefix) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      if (e.isDirectory()) walk(path.join(dir, e.name), prefix + e.name + "/");
      else out.push(prefix + e.name);
    }
  };
  walk(P.resources, "");
  return out.sort();
}

// Earlier versions had a separate templates folder; move its files into resources/templates.
function moveOldTemplates() {
  if (!fs.existsSync(P.oldTemplates)) return;
  const target = path.join(P.resources, "templates");
  fs.mkdirSync(target, { recursive: true });
  for (const f of fs.readdirSync(P.oldTemplates)) {
    if (!fs.existsSync(path.join(target, f))) fs.renameSync(path.join(P.oldTemplates, f), path.join(target, f));
  }
  try { fs.rmdirSync(P.oldTemplates); } catch { /* not empty: leave it */ }
}

// ---------- Skills: one folder per skill with a SKILL.md ----------
function parseSkill(text, fallbackName) {
  text = String(text || "").replace(/\r\n/g, "\n").trim();
  let meta = {}, body = text;
  const fm = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (fm) {
    body = fm[2].trim();
    const lines = fm[1].split("\n");
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^([A-Za-z_-]+):\s*(.*)$/);
      if (!m) continue;
      let value = m[2].trim();
      if ([">", "|", ">-", "|-"].includes(value)) {
        const parts = [];
        while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) parts.push(lines[++i].trim());
        value = parts.join(" ");
      }
      meta[m[1].toLowerCase()] = value.replace(/^["']|["']$/g, "");
    }
  }
  const heading = body.match(/^#\s+(.+)$/m);
  const name = (meta.name || (heading && heading[1]) || fallbackName || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
  if (!name) throw new Error("The skill needs a name. Add a line 'name: my-skill' between --- lines at the top.");
  if (!meta.description) throw new Error("The skill needs a description, so the agent knows when to use it. Add 'description: ...' at the top.");
  if (!body) throw new Error("The skill has no instructions below the header.");
  return { name, description: meta.description.trim(), body };
}

function listSkills() {
  fs.mkdirSync(P.skills, { recursive: true });
  const config = readConfig();
  const skills = [];
  for (const dir of fs.readdirSync(P.skills, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const file = path.join(P.skills, dir.name, "SKILL.md");
    if (!fs.existsSync(file)) continue;
    try {
      const s = parseSkill(fs.readFileSync(file, "utf8"), dir.name);
      const scriptDir = path.join(P.skills, dir.name, "scripts");
      const scripts = fs.existsSync(scriptDir) ? fs.readdirSync(scriptDir).filter((f) => /\.(m?js|cjs)$/.test(f)).sort() : [];
      skills.push({ ...s, folder: dir.name, scripts, scriptsAllowed: (config.allowedSkillScripts || []).includes(s.name), enabled: !config.disabledSkills.includes(s.name) });
    } catch (err) {
      skills.push({ name: dir.name, folder: dir.name, description: "", body: "", error: err.message, enabled: false });
    }
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

// ---------- Talking to the model ----------
function friendlyError(status, body) {
  const detail = (body && (body.error?.message || body.message || (Array.isArray(body) && body[0]?.error?.message))) || "";
  if (status === 401 || status === 403) return `The provider refused the key (${status}). Check that you pasted the whole key and picked the right provider. ${detail}`;
  if (status === 404) return `The provider does not know this address or model (404). Check the model name. ${detail}`;
  if (status === 429) return `Free limit reached for now (429). Wait a minute and try again, or switch to another provider. ${detail}`;
  if (status >= 500) return `The provider has a problem right now (${status}). Try again in a moment. ${detail}`;
  return `The provider answered with an error (${status}). ${detail}`;
}

async function chatCompletion(messages, toolList, s = llmSettings()) {
  if (!s.apiKey) throw new Error("No API key yet. Open Settings and paste your key.");
  if (!s.baseUrl || !s.model) throw new Error("Pick a provider and a model in Settings.");
  const body = { model: s.model, messages };
  if (toolList && toolList.length) { body.tools = toolList; body.tool_choice = "auto"; }
  if (s.provider === "groq" && /gpt-oss/.test(s.model)) body.reasoning_effort = "low";
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${s.apiKey}` };
  if (s.provider === "openrouter") headers["X-Title"] = "Agent Chat";
  for (let attempt = 0; attempt < 2; attempt++) {
    let response;
    try {
      response = await fetch(s.baseUrl.replace(/\/+$/, "") + "/chat/completions", { method: "POST", headers, body: JSON.stringify(body) });
    } catch {
      throw new Error("Could not reach the provider. Check your internet connection and the address in Settings.");
    }
    const data = await response.json().catch(() => null);
    if (response.ok) return data;
    // Some providers (Groq) check tool names themselves and reject a reply that calls a tool that does not exist.
    const message = data?.error?.message || "";
    if (response.status === 400 && (data?.error?.code === "tool_use_failed" || /tool call validation failed/i.test(message))) {
      const bad = message.match(/tool '([^']+)'/);
      const err = new Error(bad ? `The model tried to use a tool called "${bad[1]}", which does not exist.` : "The model asked for a tool in a way the provider could not accept.");
      err.toolMistake = true;
      throw err;
    }
    if (response.status === 429 && attempt === 0) {
      const wait = Math.min(Number(response.headers.get("retry-after")) || 8, 20);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    throw new Error(friendlyError(response.status, data));
  }
}

// ---------- The agent loop ----------
const conversations = new Map(); // id -> messages
const approvals = new Map(); // id -> resolve function

const USE_SKILL_TOOL = {
  type: "function",
  function: {
    name: "use_skill",
    description: "Read the full instructions of one of your skills. Do this before any task that a skill covers.",
    parameters: { type: "object", properties: { name: { type: "string", description: "The skill name, exactly as listed" } }, required: ["name"] },
  },
};

const RUN_SKILL_SCRIPT_TOOL = {
  type: "function",
  function: {
    name: "run_skill_script",
    description: "Run a script that belongs to one of your skills. Read the skill with use_skill first: it says which script to run and what input to give.",
    parameters: {
      type: "object",
      properties: {
        skill: { type: "string", description: "The skill name, exactly as listed" },
        script: { type: "string", description: "The script file name from the skill, for example html-to-pdf.js" },
        input: { type: "object", description: "The input the skill's instructions ask for" },
      },
      required: ["skill", "script"],
    },
  },
};

// Runs a skill script with this app's Node.js. The input goes in as JSON; whatever the script prints comes back.
// Scripts get the output and resources folders, but not the keys from .env.
function runSkillScript(skill, script, input) {
  return new Promise((resolve) => {
    const file = path.join(P.skills, skill.folder, "scripts", path.basename(script));
    if (!skill.scripts.includes(path.basename(script)) || !fs.existsSync(file)) {
      return resolve({ ok: false, error: `The skill ${skill.name} has no script called "${script}". It has: ${skill.scripts.join(", ") || "none"}` });
    }
    const env = { PATH: process.env.PATH, HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR, LOCALAPPDATA: process.env.LOCALAPPDATA, ProgramFiles: process.env.ProgramFiles, "ProgramFiles(x86)": process.env["ProgramFiles(x86)"], AGENT_OUTPUT_DIR: P.output, AGENT_RESOURCES_DIR: P.resources, AGENT_APP_DIR: ROOT };
    for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
    const child = spawn(process.execPath, [file], { cwd: path.dirname(path.dirname(file)), env, stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    const timer = setTimeout(() => { child.kill(); resolve({ ok: false, error: `The script took longer than ${SCRIPT_TIMEOUT_MS / 1000} seconds and was stopped` }); }, SCRIPT_TIMEOUT_MS);
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("error", (e) => { clearTimeout(timer); resolve({ ok: false, error: e.message }); });
    child.on("close", (code) => {
      clearTimeout(timer);
      const text = out.trim().slice(0, 20000);
      let result;
      try { result = JSON.parse(text); } catch { result = text || "(the script printed nothing)"; }
      if (code !== 0) resolve({ ok: false, error: (err.trim() || text || `The script stopped with exit code ${code}`).slice(0, 2000) });
      else resolve({ ok: true, result });
    });
    child.stdin.end(JSON.stringify(input || {}));
  });
}

// One readable line per web request, plus the service's answer when it said no.
function formatRequests(list) {
  return (list || []).map((r) => `${r.method} ${r.url}\n  → ${r.failed ? "could not connect: " + r.failed : `status ${r.status}`}${r.ms != null ? ` (${r.ms} ms)` : ""}${r.answer ? `\n  answer: ${r.answer}` : ""}`).join("\n\n");
}

function outputSnapshot() {
  const snap = new Map();
  if (fs.existsSync(P.output)) for (const f of fs.readdirSync(P.output)) if (!f.startsWith(".")) snap.set(f, fs.statSync(path.join(P.output, f)).mtimeMs);
  return snap;
}

function toolSchema(t) {
  const properties = {}, required = [];
  for (const [key, spec] of Object.entries(t.inputs || {})) {
    const { optional, ...rest } = spec || {};
    properties[key] = rest;
    if (!optional) required.push(key);
  }
  return { type: "function", function: { name: t.name, description: t.description, parameters: { type: "object", properties, required } } };
}

function systemPrompt(instructions, tools, skills) {
  const names = (skills.length ? ["use_skill"] : []).concat(skills.some((k) => k.scripts?.length) ? ["run_skill_script"] : []).concat(tools.map((t) => t.name));
  let prompt = (instructions || "").trim() || DEFAULT_INSTRUCTIONS;
  if (names.length) prompt += `\n\nYour tools are: ${names.join(", ")}. Use these exact names.`;
  prompt += "\n\nWhen a tool saves a file, tell the user and link it exactly like this: [file name](output/file-name.pdf). The user can click the link to open the file.";
  if (skills.length) {
    prompt += "\n\nYou also have skills: written know-how for certain tasks. Before a task that a skill covers, call use_skill with its name and follow its instructions.\n" +
      skills.map((k) => `- ${k.name}: ${k.description}` + (k.scripts?.length ? ` (has scripts: ${k.scripts.join(", ")}; run them with run_skill_script)` : "")).join("\n");
  }
  return prompt;
}

const short = (v, max = 60) => { const t = typeof v === "string" ? v : JSON.stringify(v); return t.length > max ? t.slice(0, max - 3) + "..." : t; };
const shortArgs = (args) => short(Object.entries(args || {}).map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`).join(", ") || "nothing");
const safeJson = (s) => { if (s && typeof s === "object") return s; try { return JSON.parse(s || "{}"); } catch { return { raw: s }; } };
const firstSentence = (text) => { const t = String(text || "").replace(/\s+/g, " ").trim(); const m = t.match(/^(.{20,140}?[.!?])\s/); return m ? m[1] : short(t, 140); };

async function runAgent(conversationId, userContent, emit) {
  const history = conversations.get(conversationId) || [];
  conversations.set(conversationId, history);
  const config = readConfig();
  const tools = (await listTools()).filter((t) => t.enabled);
  const skills = listSkills().filter((k) => k.enabled && !k.error);
  const sys = systemPrompt(config.instructions, tools, skills);
  const schemas = (skills.length ? [USE_SKILL_TOOL] : []).concat(skills.some((k) => k.scripts?.length) ? [RUN_SKILL_SCRIPT_TOOL] : []).concat(tools.map(toolSchema));
  const s = llmSettings();
  let stepId = 0;
  const stats = { modelCalls: 0, toolCalls: 0, tokens: 0, modelMs: 0, genTokens: 0, genSeconds: 0, model: s.model };
  const started = Date.now();
  const startLen = history.length;
  const turnFiles = [];
  history.push({ role: "user", content: userContent });
  emit({ type: "loop", phase: "start" });

  try {
    for (let round = 1; round <= MAX_ROUNDS; round++) {
      const id = ++stepId;
      emit({ type: "step-start", id, kind: "think", title: round === 1 ? "Thinking about your question" : "Thinking about the results" });
      if (round === 1) {
        emit({ type: "step-update", id, section: ["Instructions sent (system prompt)", sys] });
        emit({ type: "step-update", id, section: ["Tools offered to the model", tools.map((t) => ({ name: t.name, description: t.description, inputs: Object.keys(t.inputs || {}) }))] });
        if (skills.length) emit({ type: "step-update", id, section: ["Skills offered to the model (name and description only)", skills.map((k) => ({ name: k.name, description: k.description }))] });
      }
      emit({ type: "loop", phase: "think" });
      const t0 = Date.now();
      let data;
      for (let attempt = 1; ; attempt++) {
        try {
          data = await chatCompletion([{ role: "system", content: sys }, ...history], schemas, s);
          break;
        } catch (err) {
          if (!err.toolMistake) throw Object.assign(err, { stepId: id });
          if (attempt >= MAX_TOOL_RETRIES) throw Object.assign(new Error(`${err.message} Small models sometimes get tool names wrong. Ask again, or pick a stronger model in Settings, for example openai/gpt-oss-20b.`), { stepId: id });
          emit({ type: "step-update", id, retryNote: `${err.message} Asked again (${attempt} time${attempt === 1 ? "" : "s"}).` });
        }
      }
      const ms = Date.now() - t0;
      stats.modelCalls++; stats.modelMs += ms;
      stats.tokens += data.usage?.total_tokens || 0;
      if (data.usage?.completion_tokens && data.usage?.completion_time) { stats.genTokens += data.usage.completion_tokens; stats.genSeconds += data.usage.completion_time; }

      const message = data.choices?.[0]?.message || {};
      const calls = message.tool_calls || [];
      if (calls.length) {
        emit({ type: "step-update", id, title: `Thinking: decided to use ${calls.map((c) => c.function?.name).join(" and ")}` });
        emit({ type: "step-update", id, section: ["Model asked for", calls.map((c) => ({ tool: c.function?.name, inputs: safeJson(c.function?.arguments) }))] });
      } else {
        emit({ type: "step-update", id, title: "Wrote the answer", kind: "final" });
      }
      if (message.reasoning) {
        emit({ type: "step-update", id, note: firstSentence(message.reasoning) });
        emit({ type: "step-update", id, section: ["What the model was thinking", message.reasoning] });
      }
      if (data.usage) emit({ type: "step-update", id, section: ["Tokens used", `${data.usage.prompt_tokens ?? "?"} in, ${data.usage.completion_tokens ?? "?"} out`] });
      emit({ type: "step-done", id, ms, ok: true });

      // Keep only standard fields when sending the message back, so every provider accepts it.
      history.push(calls.length ? { role: "assistant", content: message.content || "", tool_calls: calls } : { role: "assistant", content: message.content || "" });
      if (!calls.length) {
        emit({ type: "answer", markdown: message.content || "(The model gave an empty answer.)" });
        emit({ type: "loop", phase: "answer" });
        break;
      }

      for (const call of calls) {
        stats.toolCalls++;
        const name = call.function?.name;
        const args = safeJson(call.function?.arguments);
        const tid = ++stepId;
        let result;
        if (name === "run_skill_script") {
          const k = skills.find((x) => x.name === String(args.skill || "").trim());
          emit({ type: "step-start", id: tid, kind: "tool", title: `Ran the script ${args.script || "?"} of the skill ${args.skill || "?"}` });
          emit({ type: "step-update", id: tid, io: [short(args.input || {}), null] });
          emit({ type: "step-update", id: tid, section: ["Input for the script", args.input || {}] });
          emit({ type: "loop", phase: "tool", tool: `script ${args.script || ""}` });
          const t1 = Date.now();
          if (!k) result = { error: `There is no switched-on skill called "${args.skill}"` };
          else {
            let allowed = readConfig().allowedSkillScripts.includes(k.name);
            if (!allowed) {
              const askId = crypto.randomUUID();
              emit({ type: "ask", id: tid, askId, tool: `the skill ${k.name}`, verb: "run its scripts", args: { script: args.script, input: args.input || {} }, note: "Scripts run on this laptop with full access. Your answer is remembered for this skill (change it under Skills)." });
              allowed = await new Promise((resolve) => {
                approvals.set(askId, resolve);
                setTimeout(() => { if (approvals.delete(askId)) resolve(false); }, 5 * 60 * 1000);
              });
              if (allowed) { const c = readConfig(); writeConfig({ allowedSkillScripts: [...new Set([...c.allowedSkillScripts, k.name])] }); }
              emit({ type: "step-update", id: tid, note: allowed ? "You allowed this skill to run scripts." : "You did not allow it, so the script did not run." });
            }
            if (!allowed) result = { error: "The user did not allow this skill to run scripts." };
            else {
              const before = outputSnapshot();
              const res = await runSkillScript(k, String(args.script || ""), args.input);
              result = res.ok ? res.result : { error: res.error };
              const after = outputSnapshot();
              const made = [...after.keys()].filter((f) => before.get(f) !== after.get(f));
              if (made.length) {
                emit({ type: "step-update", id: tid, files: made });
                turnFiles.push(...made.filter((f) => !turnFiles.includes(f)));
                const saved = made.map((f) => `output/${f}`);
                result = result && typeof result === "object" && !Array.isArray(result) ? { ...result, saved_files: saved } : { result, saved_files: saved };
              }
            }
          }
          const ok = !(result && result.error);
          emit({ type: "step-update", id: tid, io: [null, ok ? short(result) : "error: " + short(result.error)] });
          emit({ type: "step-update", id: tid, section: [ok ? "Got back" : "Error", ok ? result : result.error] });
          emit({ type: "step-done", id: tid, ms: Date.now() - t1, ok });
        } else if (name === "use_skill") {
          emit({ type: "step-start", id: tid, kind: "tool", title: "Read the skill" });
          emit({ type: "loop", phase: "tool", tool: "skill " + (args.name || "") });
          const k = skills.find((x) => x.name === String(args.name || "").trim());
          result = k ? { skill: k.name, instructions: k.body } : { error: `There is no switched-on skill called "${args.name}". Available: ${skills.map((x) => x.name).join(", ") || "none"}` };
          emit({ type: "step-update", id: tid, title: k ? `Read the skill ${k.name}` : "Tried to read a skill", io: [String(args.name || ""), k ? `${k.body.length.toLocaleString("en")} characters of instructions` : "error: " + short(result.error)] });
          emit({ type: "step-update", id: tid, section: [k ? "Instructions the agent read" : "Error", k ? k.body : result.error] });
          emit({ type: "step-done", id: tid, ms: 0, ok: !!k });
        } else {
          emit({ type: "step-start", id: tid, kind: "tool", toolName: name });
          emit({ type: "step-update", id: tid, io: [shortArgs(args), null] });
          emit({ type: "step-update", id: tid, section: ["Sent to the tool", args] });
          emit({ type: "loop", phase: "tool", tool: name });
          const tool = tools.find((t) => t.name === name);
          const t1 = Date.now();
          if (!tool) {
            result = { error: `There is no switched-on tool called "${name}"` };
          } else {
            let allowed = true;
            if (tool.ask_first) {
              const askId = crypto.randomUUID();
              emit({ type: "ask", id: tid, askId, tool: name, args });
              allowed = await new Promise((resolve) => {
                approvals.set(askId, resolve);
                setTimeout(() => { if (approvals.delete(askId)) resolve(false); }, 5 * 60 * 1000);
              });
              emit({ type: "step-update", id: tid, note: allowed ? "You allowed this." : "You did not allow this, so it did not run." });
            }
            if (!allowed) result = { error: "The user did not allow this tool to run." };
            else {
              const res = await runTool(tool, args);
              result = res.ok ? res.result : { error: res.error };
              if (res.logs?.length) emit({ type: "step-update", id: tid, section: ["What the tool printed (console)", res.logs.join("\n")] });
              if (res.requests?.length) emit({ type: "step-update", id: tid, section: ["Web requests the tool made", formatRequests(res.requests)] });
              if (!res.ok && res.details) emit({ type: "step-update", id: tid, section: ["Where it went wrong", res.details.snippet ? `${res.details.kind} on line ${res.details.line} of tools/${tool.file}:\n\n${res.details.snippet}` : res.details.stack] });
              if (!res.ok || (result && result.error)) emit({ type: "step-update", id: tid, debug: { tool: name, args, error: res.ok ? result.error : res.error } });
              if (res.files?.length) {
                emit({ type: "step-update", id: tid, files: res.files });
                turnFiles.push(...res.files.filter((f) => !turnFiles.includes(f)));
                // Tell the model where the files are, so it can link them in its answer.
                const saved = res.files.map((f) => `output/${f}`);
                result = result && typeof result === "object" && !Array.isArray(result) ? { ...result, saved_files: saved } : { result, saved_files: saved };
              }
            }
          }
          const ok = !(result && result.error);
          emit({ type: "step-update", id: tid, io: [null, ok ? short(result) : "error: " + short(result.error)] });
          emit({ type: "step-update", id: tid, section: [ok ? "Got back" : "Error", ok ? result : result.error] });
          emit({ type: "step-done", id: tid, ms: Date.now() - t1, ok });
        }
        emit({ type: "loop", phase: "look" });
        history.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
      }
      if (round === MAX_ROUNDS) emit({ type: "error", message: `I used ${MAX_ROUNDS} rounds without finishing, so I stopped. Try asking in a simpler way.` });
    }
  } catch (err) {
    emit({ type: "error", message: err.message, stepId: err.stepId });
    history.length = startLen; // drop the unanswered question so the next try starts clean
  }
  if (turnFiles.length) emit({ type: "files", files: turnFiles });
  emit({ type: "done", stats: { ...stats, totalMs: Date.now() - started } });
}

// ---------- Making a tool with AI ----------
const TOOL_PROMPT = fs.existsSync(path.join(ROOT, "lib", "make-a-tool-prompt.txt")) ? fs.readFileSync(path.join(ROOT, "lib", "make-a-tool-prompt.txt"), "utf8") : "";

function extractToolCode(text) {
  const fenced = String(text).match(/```(?:js|javascript)?\s*\n([\s\S]*?)```/);
  const src = fenced ? fenced[1] : String(text);
  const start = src.indexOf("tool(");
  const end = src.lastIndexOf("})");
  if (start < 0 || end < start) throw new Error("The model did not return tool code. Try again, or describe the idea differently.");
  return src.slice(start, end + 2).trim();
}

// ---------- Image support check ----------
async function canReadImages() {
  const s = llmSettings();
  const key = `${s.baseUrl}|${s.model}`;
  const config = readConfig();
  if (key in config.vision) return config.vision[key];
  let verdict = null;
  try {
    if (s.provider === "openrouter") {
      const r = await fetch("https://openrouter.ai/api/v1/models");
      const m = ((await r.json()).data || []).find((x) => x.id === s.model);
      if (m) verdict = (m.architecture?.input_modalities || []).includes("image");
    }
    if (verdict === null && s.apiKey) {
      // A tiny red square as a test picture (8x8 PNG).
      const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGO4o6GBFTEMLQkAe3tLAfuiUfAAAAAASUVORK5CYII=";
      const r = await fetch(s.baseUrl.replace(/\/+$/, "") + "/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.apiKey}` },
        body: JSON.stringify({ model: s.model, messages: [{ role: "user", content: [{ type: "text", text: "What colour is this square? Answer in one word." }, { type: "image_url", image_url: { url: png } }] }] }),
      });
      if (r.ok) verdict = true;
      else if ([400, 404, 415, 422].includes(r.status)) verdict = false;
    }
  } catch { verdict = null; }
  if (verdict !== null) writeConfig({ vision: { ...config.vision, [key]: verdict } });
  return verdict;
}

// ---------- HTTP ----------
function send(res, status, body, headers = {}) {
  const isJson = typeof body !== "string" && !Buffer.isBuffer(body);
  res.writeHead(status, { "Content-Type": isJson ? "application/json; charset=utf-8" : "text/plain; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(isJson ? JSON.stringify(body) : body);
}
async function readBody(req, limit = 25 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const c of req) { size += c.length; if (size > limit) throw new Error("The request is too big."); chunks.push(c); }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

const MIME = { ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".md": "text/markdown; charset=utf-8", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".csv": "text/csv", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".pdf": "application/pdf", ".txt": "text/plain; charset=utf-8" };

function publicState(tools, skills) {
  const s = llmSettings();
  const env = readEnv();
  const config = readConfig();
  return {
    settings: { provider: s.provider, baseUrl: s.baseUrl, model: s.model, hasKey: !!s.apiKey, instructions: config.instructions, defaultInstructions: DEFAULT_INSTRUCTIONS },
    providers: PROVIDERS,
    keys: Object.keys(env).filter((k) => !k.startsWith("LLM_")).map((k) => ({ name: k, set: !!env[k] })),
    tools: tools.map(({ file, name, description, inputs, needs, ask_first, enabled, error }) => ({ file, name, description, inputs, needs, ask_first, enabled, error })),
    skills: skills.map(({ name, folder, description, enabled, error, scripts, scriptsAllowed }) => ({ name, folder, description, enabled, error, scripts, scriptsAllowed })),
    folders: { root: ROOT, tools: P.tools, skills: P.skills, output: P.output, resources: P.resources },
    resources: listResourceFiles(),
    version: APP_VERSION,
  };
}

async function handleApi(req, res, url) {
  const route = `${req.method} ${url.pathname}`;
  const body = req.method === "POST" ? await readBody(req) : {};

  if (route === "GET /api/state") return send(res, 200, publicState(await listTools(), listSkills()));

  if (route === "POST /api/settings") {
    const updates = {};
    if (body.provider !== undefined) updates.LLM_PROVIDER = String(body.provider);
    if (body.baseUrl !== undefined) updates.LLM_BASE_URL = String(body.baseUrl).trim();
    if (body.model !== undefined) updates.LLM_MODEL = String(body.model).trim();
    if (body.apiKey !== undefined) updates.LLM_API_KEY = String(body.apiKey).trim();
    if (Object.keys(updates).length) writeEnv(updates);
    if (body.instructions !== undefined) writeConfig({ instructions: String(body.instructions) });
    return send(res, 200, publicState(await listTools(), listSkills()));
  }

  if (route === "POST /api/keys") {
    const name = String(body.name || "").trim().toUpperCase();
    if (!/^[A-Z_][A-Z0-9_]{0,63}$/.test(name) || name.startsWith("LLM_")) return send(res, 400, { error: "Key names use capital letters, numbers and _, for example SLACK_WEBHOOK_URL. Names starting with LLM_ are set in Settings." });
    writeEnv({ [name]: body.remove ? null : String(body.value ?? "") });
    return send(res, 200, { ok: true });
  }

  if (route === "POST /api/test") {
    const t0 = Date.now();
    try {
      const data = await chatCompletion([{ role: "user", content: "Reply with exactly: Connection works!" }]);
      return send(res, 200, { ok: true, ms: Date.now() - t0, model: llmSettings().model, reply: data.choices?.[0]?.message?.content?.trim() || "(empty reply)" });
    } catch (err) { return send(res, 200, { ok: false, error: err.message }); }
  }

  if (route === "GET /api/models") {
    const s = llmSettings();
    try {
      const r = await fetch(s.baseUrl.replace(/\/+$/, "") + "/models", { headers: { Authorization: `Bearer ${s.apiKey}` } });
      const data = await r.json();
      if (!r.ok) return send(res, 200, { ok: false, error: friendlyError(r.status, data) });
      return send(res, 200, { ok: true, models: (data.data || []).map((m) => (m.id || "").replace(/^models\//, "")).filter(Boolean).sort() });
    } catch (err) { return send(res, 200, { ok: false, error: err.message }); }
  }

  if (route === "POST /api/chat") {
    res.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" });
    const emit = (event) => { if (!res.writableEnded) res.write(JSON.stringify(event) + "\n"); };
    await runAgent(String(body.conversationId || "default"), body.content, emit);
    return res.end();
  }
  if (route === "POST /api/chat/reset") { conversations.delete(String(body.conversationId || "default")); return send(res, 200, { ok: true }); }
  if (route === "POST /api/approve") {
    const resolve = approvals.get(String(body.askId));
    if (resolve) { approvals.delete(String(body.askId)); resolve(!!body.allow); }
    return send(res, 200, { ok: !!resolve });
  }
  if (route === "POST /api/vision-check") return send(res, 200, { verdict: await canReadImages(), model: llmSettings().model });

  // Tools
  if (route === "POST /api/tools/toggle") {
    const c = readConfig();
    const set = new Set(c.disabledTools);
    body.enabled ? set.delete(body.name) : set.add(body.name);
    writeConfig({ disabledTools: [...set] });
    return send(res, 200, { ok: true });
  }
  if (route === "GET /api/tools/code") {
    const t = (await listTools()).find((x) => x.name === url.searchParams.get("name"));
    return t ? send(res, 200, { code: fs.readFileSync(path.join(P.tools, t.file), "utf8"), file: t.file }) : send(res, 404, { error: "Tool not found" });
  }
  if (route === "POST /api/tools/try") {
    const t = (await listTools()).find((x) => x.name === body.name);
    if (!t) return send(res, 404, { error: "Tool not found" });
    const r = await runTool(t, body.args || {});
    return send(res, 200, r);
  }
  if (route === "POST /api/tools/check") {
    const r = await runWorker("describe", String(body.code || ""), path.join(P.tools, "_check.js"));
    return send(res, 200, r);
  }
  if (route === "POST /api/tools/try-code") {
    const code = String(body.code || "");
    const d = await runWorker("describe", code, path.join(P.tools, "_check.js"));
    if (!d.ok) return send(res, 200, d);
    const env = readEnv();
    const r = await runWorker("run", code, path.join(P.tools, "_check.js"), body.args || {}, Object.fromEntries(d.meta.needs.map((k) => [k, env[k] ?? ""])));
    return send(res, 200, r);
  }
  if (route === "POST /api/tools/install") {
    const code = String(body.code || "").trim();
    const d = await runWorker("describe", code, path.join(P.tools, "_check.js"));
    if (!d.ok) return send(res, 200, d);
    fs.writeFileSync(path.join(P.tools, `${d.meta.name}.js`), code + "\n");
    return send(res, 200, { ok: true, meta: d.meta, file: `${d.meta.name}.js` });
  }
  if (route === "POST /api/tools/remove") {
    const t = (await listTools()).find((x) => x.name === body.name);
    if (!t) return send(res, 404, { error: "Tool not found" });
    // Moved, not deleted, so a mistake can be undone by moving the file back.
    const bin = path.join(P.tools, "removed");
    fs.mkdirSync(bin, { recursive: true });
    fs.renameSync(path.join(P.tools, t.file), path.join(bin, `${Date.now()}-${t.file}`));
    return send(res, 200, { ok: true });
  }
  if (route === "POST /api/tools/make") {
    if (!TOOL_PROMPT) return send(res, 500, { error: "The tool prompt template is missing." });
    const idea = String(body.idea || "").trim();
    if (!idea) return send(res, 400, { error: "Describe your tool idea first." });
    try {
      const prompt = TOOL_PROMPT.replace(/\[DESCRIBE YOUR TOOL HERE[^\]]*\]/, idea);
      const t0 = Date.now();
      const data = await chatCompletion([{ role: "user", content: prompt }]);
      const code = extractToolCode(data.choices?.[0]?.message?.content || "");
      const d = await runWorker("describe", code, path.join(P.tools, "_check.js"));
      return send(res, 200, { ok: true, code, ms: Date.now() - t0, check: d });
    } catch (err) { return send(res, 200, { ok: false, error: err.message }); }
  }
  if (route === "GET /api/tools/prompt") return send(res, 200, { prompt: TOOL_PROMPT });
  if (route === "POST /api/tools/modify") {
    const t = (await listTools()).find((x) => x.name === body.name);
    if (!t) return send(res, 404, { error: "Tool not found" });
    const change = String(body.change || "").trim();
    if (!change) return send(res, 400, { error: "Describe what should change first." });
    try {
      const current = fs.readFileSync(path.join(P.tools, t.file), "utf8");
      // Same rules as for a new tool, but with the current code and the requested change instead of an idea.
      const rules = TOOL_PROMPT.split(/\nMy tool idea:/)[0].replace("Please write ONE tool for me.", "Please change ONE of my tools.");
      const prompt = `${rules}\n\nHere is my current tool:\n\`\`\`js\n${current.trim()}\n\`\`\`\n\nChange it like this:\n${change}\n\nKeep the same name and keep everything else working, unless I asked otherwise. Reply with only the full updated code.`;
      const t0 = Date.now();
      const data = await chatCompletion([{ role: "user", content: prompt }]);
      const code = extractToolCode(data.choices?.[0]?.message?.content || "");
      const d = await runWorker("describe", code, path.join(P.tools, "_check.js"));
      return send(res, 200, { ok: true, code, old: current, ms: Date.now() - t0, check: d });
    } catch (err) { return send(res, 200, { ok: false, error: err.message }); }
  }
  if (route === "POST /api/tools/debug") {
    let t, current;
    if (body.code) {
      // Code that is not installed yet (from "Make a new tool").
      current = String(body.code);
      const d = await runWorker("describe", current, path.join(P.tools, "_check.js"));
      if (!d.ok) t = { name: "new tool", needs: [], ask_first: false, broken: d.error };
      else t = { ...d.meta, file: null };
    } else {
      t = (await listTools()).find((x) => x.name === body.name);
      if (!t) return send(res, 404, { error: "Tool not found" });
      current = fs.readFileSync(path.join(P.tools, t.file), "utf8");
    }
    const args = body.args || {};
    // Run it again to collect fresh details, but never repeat a tool that sends, pays or deletes (ask_first).
    let rerun = null;
    if (t.broken) rerun = { ok: false, error: t.broken };
    else if (!t.ask_first) {
      if (t.file) rerun = await runTool(t, args);
      else { const env = readEnv(); rerun = await runWorker("run", current, path.join(P.tools, "_check.js"), args, Object.fromEntries((t.needs || []).map((k) => [k, env[k] ?? ""]))); }
    }
    const error = rerun ? (rerun.ok ? rerun.result?.error : rerun.error) : String(body.error || "");
    if (rerun && rerun.ok && !(rerun.result && rerun.result.error)) {
      return send(res, 200, { ok: true, worksNow: true, explanation: "The tool works now with the same inputs. It may have been a temporary problem, such as a web service that was busy, or the tool was changed since.", result: rerun.result });
    }
    const missingKeys = (t.needs || []).filter((k) => !readEnv()[k]);
    const facts = [
      `Inputs the agent gave: ${JSON.stringify(args)}`,
      `Error: ${error || "(no message)"}`,
      rerun?.details?.snippet ? `Where:\n${rerun.details.snippet}` : rerun?.details?.stack ? `Stack:\n${rerun.details.stack}` : "",
      rerun?.logs?.length ? `What the tool printed:\n${rerun.logs.join("\n")}` : "",
      rerun?.requests?.length ? `Web requests the tool made (keys hidden as •••):\n${formatRequests(rerun.requests)}` : "",
      missingKeys.length ? `These keys from needs are empty in .env: ${missingKeys.join(", ")}` : "",
      t.ask_first ? "This tool was not run again because it sends, pays or deletes something." : "",
    ].filter(Boolean).join("\n\n");
    try {
      const rules = TOOL_PROMPT.split(/\nMy tool idea:/)[0].replace("Please write ONE tool for me.", "One of my tools failed. Please help me fix it.");
      const prompt = `${rules}\n\nWhen a web service answered with an error, read its answer carefully: it usually says which parameter is wrong or missing. If the tool uses parameters the service does not support, fix them based on what you know about that service. Never invent a parameter.\n\nHere is the tool:\n\`\`\`js\n${current.trim()}\n\`\`\`\n\n${facts}\n\nFirst explain in 2 to 4 short sentences, in plain English for someone who does not code, what went wrong. Then give the full fixed tool in one \`\`\`js code block. If the problem is not in the code (for example a missing key, a web service that is down, or wrong inputs from the agent), say what the user should do instead, and give the code unchanged.`;
      const t0 = Date.now();
      const data = await chatCompletion([{ role: "user", content: prompt }]);
      const text = data.choices?.[0]?.message?.content || "";
      const explanation = text.split("```")[0].trim() || "The model did not explain the problem.";
      let code = current, check = null;
      try { code = extractToolCode(text); check = await runWorker("describe", code, path.join(P.tools, "_check.js")); } catch { code = current; }
      return send(res, 200, { ok: true, explanation, code, changed: code.trim() !== current.trim(), check, old: current, error, details: rerun?.details || null, logs: rerun?.logs || [], requests: rerun?.requests ? formatRequests(rerun.requests) : "", ms: Date.now() - t0, reran: !!rerun && !t.broken, installed: !!t.file });
    } catch (err) { return send(res, 200, { ok: false, error: err.message }); }
  }
  if (route === "POST /api/tools/update") {
    const t = (await listTools()).find((x) => x.name === body.name);
    if (!t) return send(res, 404, { error: "Tool not found" });
    const code = String(body.code || "").trim();
    const d = await runWorker("describe", code, path.join(P.tools, "_check.js"));
    if (!d.ok) return send(res, 200, d);
    // Keep the previous version in tools/removed, so a change can be undone.
    const bin = path.join(P.tools, "removed");
    fs.mkdirSync(bin, { recursive: true });
    fs.copyFileSync(path.join(P.tools, t.file), path.join(bin, `${Date.now()}-previous-${t.file}`));
    const file = `${d.meta.name}.js`;
    fs.writeFileSync(path.join(P.tools, file), code + "\n");
    if (file !== t.file) fs.unlinkSync(path.join(P.tools, t.file));
    return send(res, 200, { ok: true, meta: d.meta, file, renamed: file !== t.file });
  }

  // Skills
  if (route === "POST /api/skills/toggle") {
    const c = readConfig();
    const set = new Set(c.disabledSkills);
    body.enabled ? set.delete(body.name) : set.add(body.name);
    writeConfig({ disabledSkills: [...set] });
    return send(res, 200, { ok: true });
  }
  if (route === "POST /api/skills/scripts-permission") {
    const c = readConfig();
    const set = new Set(c.allowedSkillScripts);
    body.allowed ? set.add(body.name) : set.delete(body.name);
    writeConfig({ allowedSkillScripts: [...set] });
    return send(res, 200, { ok: true });
  }
  if (route === "GET /api/skills/body") {
    const k = listSkills().find((x) => x.name === url.searchParams.get("name"));
    return k ? send(res, 200, { body: k.body }) : send(res, 404, { error: "Skill not found" });
  }
  if (route === "POST /api/skills/add") {
    try {
      const k = parseSkill(body.text, body.fileName ? String(body.fileName).replace(/\.(md|markdown|txt)$/i, "") : "");
      const dir = path.join(P.skills, k.name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "SKILL.md"), String(body.text).trim() + "\n");
      return send(res, 200, { ok: true, name: k.name });
    } catch (err) { return send(res, 200, { ok: false, error: err.message }); }
  }
  if (route === "POST /api/skills/remove") {
    const k = listSkills().find((x) => x.name === body.name);
    if (!k) return send(res, 404, { error: "Skill not found" });
    const bin = path.join(P.skills, ".removed");
    fs.mkdirSync(bin, { recursive: true });
    fs.renameSync(path.join(P.skills, k.folder), path.join(bin, `${Date.now()}-${k.folder}`));
    return send(res, 200, { ok: true });
  }

  if (route === "POST /api/open-output") {
    const file = path.join(P.output, path.basename(String(body.name || "")));
    if (!body.name || !fs.existsSync(file)) return send(res, 404, { error: "That file is no longer in the output folder." });
    openPath(file);
    return send(res, 200, { ok: true });
  }
  if (route === "POST /api/open-folder") {
    const target = { tools: P.tools, skills: P.skills, output: P.output, resources: P.resources, root: ROOT }[body.folder];
    if (!target) return send(res, 400, { error: "Unknown folder" });
    openPath(target);
    return send(res, 200, { ok: true });
  }

  return send(res, 404, { error: "Not found", unknownRoute: true });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    // Only this laptop may talk to the app. The Host check blocks web pages that try tricks with DNS names.
    const host = String(req.headers.host || "").replace(/:\d+$/, "");
    if (!["127.0.0.1", "localhost", "[::1]"].includes(host)) return send(res, 403, "This app only accepts requests from this laptop.");

    if (url.pathname.startsWith("/api/")) {
      const token = req.headers["x-agent-token"] || url.searchParams.get("token");
      if (token !== TOKEN) return send(res, 401, { error: "The secret link has expired. Use the link shown in the Agent Chat window (or start the app again)." });
      return await handleApi(req, res, url);
    }
    if (url.pathname.startsWith("/output/")) {
      if (url.searchParams.get("token") !== TOKEN) return send(res, 401, "The secret link has expired.");
      const name = path.basename(decodeURIComponent(url.pathname.slice(8)));
      const file = path.join(P.output, name);
      if (!fs.existsSync(file)) return send(res, 404, "File not found");
      const ext = path.extname(name).toLowerCase();
      if (url.searchParams.get("view") === "1") {
        // Open in a browser tab. The sandbox rule stops a saved HTML file from reaching the app or its secret link.
        const type = [".csv", ".json", ".md", ".txt", ".js"].includes(ext) ? "text/plain; charset=utf-8" : (MIME[ext] || "application/octet-stream");
        const headers = { "Content-Type": type, "Content-Disposition": `inline; filename="${name.replace(/"/g, "")}"`, "X-Content-Type-Options": "nosniff" };
        // Only pages that can run scripts get the sandbox; a PDF needs the browser's own PDF viewer, which the sandbox would block.
        if ([".html", ".htm", ".svg", ".xml"].includes(ext)) headers["Content-Security-Policy"] = "sandbox";
        res.writeHead(200, headers);
      } else {
        res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream", "Content-Disposition": `attachment; filename="${name.replace(/"/g, "")}"` });
      }
      return fs.createReadStream(file).pipe(res);
    }
    const rel = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname).replace(/^\/+/, "");
    const file = path.join(P.public, path.normalize(rel));
    if (!file.startsWith(P.public) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, "Not found");
    res.writeHead(200, { "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-store" });
    fs.createReadStream(file).pipe(res);
  } catch (err) {
    if (!res.headersSent) send(res, 500, { error: err.message });
    else res.end();
  }
});

function openPath(target) {
  const cmd = process.platform === "darwin" ? `open "${target}"` : process.platform === "win32" ? `start "" "${target}"` : `xdg-open "${target}"`;
  exec(cmd, () => {});
}

function listen(port, last) {
  server.once("error", (err) => {
    if (err.code === "EADDRINUSE" && port < last) return listen(port + 1, last);
    console.error(`\nAgent Chat could not start: ${err.message}\nClose other copies of Agent Chat and try again.\n`);
    process.exit(1);
  });
  server.listen(port, "127.0.0.1", () => {
    const link = `http://127.0.0.1:${port}/?token=${TOKEN}`;
    console.log(`\nAgent Chat is running at ${link}\n`);
    console.log("Your browser should open by itself. If it does not, copy the link above into your browser.");
    console.log("Keep this window open while you use Agent Chat. Close it (or press Ctrl+C) to stop.\n");
    if (process.env.NO_OPEN !== "1") openPath(link);
  });
}

fs.mkdirSync(P.output, { recursive: true });
fs.mkdirSync(P.resources, { recursive: true });
moveOldTemplates();
ensureEnv();
const startPort = Number(process.env.PORT) || 3210;
listen(startPort, startPort + 20);

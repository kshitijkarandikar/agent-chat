// Runs one tool in its own worker thread, so a tool that hangs can be stopped
// without stopping the whole app. Tools have full access to this laptop (files, network).
import { parentPort, workerData } from "node:worker_threads";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const { action, code, file, args, env, outputDir, resourcesDir } = workerData;
const require = createRequire(file || import.meta.url);
const files = [];

// Keep what the tool prints with console.log, so it can be shown when debugging.
const logs = [];
for (const level of ["log", "info", "warn", "error"]) {
  console[level] = (...parts) => {
    if (logs.length < 200) logs.push(`${level === "log" ? "" : level + ": "}${parts.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join(" ")}`.slice(0, 2000));
  };
}

// Turns an error into a short report with the line number in the tool file.
// The tool code is wrapped in 4 extra lines before it runs, so line numbers are shifted back by 4.
function errorDetails(err) {
  const stack = String(err?.stack || "");
  const m = stack.match(/<anonymous>:(\d+):(\d+)/);
  const line = m ? Number(m[1]) - 4 : null;
  let snippet = null;
  if (line && line > 0) {
    const lines = String(code).split("\n");
    snippet = lines.slice(Math.max(0, line - 3), line + 2).map((l, i) => {
      const n = Math.max(1, line - 2) + i;
      return `${n === line ? ">" : " "} ${String(n).padStart(3)} | ${l}`;
    }).join("\n");
  }
  return { kind: err?.name || "Error", line, column: m ? Number(m[2]) : null, snippet, stack: stack.split("\n").slice(0, 6).join("\n") };
}

function tool(definition) { return definition; }

// ---------- Web requests: kept in a list so a failing tool can be debugged ----------
// Keys are hidden before anything is shown or sent to the AI model.
const requests = [];
const secrets = Object.values(env || {}).filter((v) => typeof v === "string" && v.length >= 4);
function hideSecrets(text) {
  let t = String(text ?? "");
  for (const s of secrets) t = t.split(s).join("•••");
  return t.replace(/([?&](?:api[_-]?key|apikey|key|token|access_token|secret|password)=)[^&\s]+/gi, "$1•••");
}
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, options = {}) => {
  const url = typeof input === "string" ? input : input?.url || String(input);
  const entry = { method: (options.method || "GET").toUpperCase(), url: hideSecrets(url) };
  requests.push(entry);
  const t0 = Date.now();
  try {
    const response = await realFetch(input, options);
    entry.status = response.status;
    entry.ms = Date.now() - t0;
    if (!response.ok) entry.answer = hideSecrets((await response.clone().text().catch(() => "")).slice(0, 600));
    return response;
  } catch (err) {
    entry.ms = Date.now() - t0;
    entry.failed = String(err.cause?.code || err.message || err);
    throw err;
  }
};

async function getJSON(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  if (!response.ok) {
    let reason = text.slice(0, 300);
    try {
      // Services put the reason in different places; take the first one that is real text.
      const j = JSON.parse(text);
      const found = [j.message, j.reason, j.error?.message, j.error_description, j.error, j.detail, j.errors?.[0]?.message, j.title].find((v) => typeof v === "string" && v.trim());
      if (found) reason = found;
    } catch { /* not JSON */ }
    throw new Error(`The web service answered with status ${response.status}${response.statusText ? " (" + response.statusText + ")" : ""}: ${hideSecrets(typeof reason === "string" ? reason : JSON.stringify(reason))}`);
  }
  try { return JSON.parse(text); } catch { throw new Error("The web service did not answer with JSON: " + hideSecrets(text.slice(0, 200))); }
}

// Saves a file in the output folder; the chat shows it as a download.
function saveFile(name, content) {
  const safe = path.basename(String(name || "file.txt")).replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "file.txt";
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, safe), typeof content === "string" ? content : Buffer.from(content));
  files.push(safe);
  return { saved: safe };
}

// ---------- Resources: templates, price lists, logos and other files your tools use ----------
// Finds a file inside the resources folder. Sub-folders are fine ("templates/invoice.html"); leaving the folder is not.
function resourceFile(name) {
  const rel = String(name || "").replace(/\\/g, "/").replace(/^\/+/, "");
  const full = path.resolve(resourcesDir, rel);
  if (!full.startsWith(path.resolve(resourcesDir) + path.sep)) throw new Error(`"${name}" is outside the resources folder`);
  if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) throw new Error(`There is no file called "${name}" in the resources folder`);
  return full;
}

// Reads a resource as text, for example readResource("price-list.csv"). Pass null as encoding to get the raw bytes (a Buffer).
function readResource(name, encoding = "utf8") {
  return fs.readFileSync(resourceFile(name), encoding === null ? undefined : encoding);
}

// Lists all files in the resources folder, for example ["logo.png", "templates/invoice.html"].
function listResources() {
  const out = [];
  const walk = (dir, prefix) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      if (e.isDirectory()) walk(path.join(dir, e.name), prefix + e.name + "/");
      else out.push(prefix + e.name);
    }
  };
  walk(resourcesDir, "");
  return out.sort();
}

// Turns a resource (for example a logo) into a data: link, so it can be put inside HTML or a PDF: <img src="${resourceDataUrl("logo.png")}">.
function resourceDataUrl(name) {
  const types = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml", ".pdf": "application/pdf", ".css": "text/css" };
  const full = resourceFile(name);
  return `data:${types[path.extname(full).toLowerCase()] || "application/octet-stream"};base64,${fs.readFileSync(full).toString("base64")}`;
}

// Reads a template: looks in resources/templates first, then in resources itself. readTemplate("invoice.html")
function readTemplate(name) {
  const base = String(name || "");
  for (const candidate of [`templates/${base}`, base]) {
    try { return readResource(candidate); } catch { /* try the next place */ }
  }
  throw new Error(`There is no template called "${name}". Put it in the resources/templates folder.`);
}

// Fills a template, for example fillTemplate(html, { client_name: "Café De Hoek", lines: [{ description: "Bread", qty: 2 }] }).
//   {{name}}                    the value, made safe for HTML
//   {{{name}}}                  the value as ready-made HTML
//   {{#each lines}}...{{/each}} repeats the part in between for every item in a list; inside it, {{description}}
//                               reads from the item and {{@number}} is 1, 2, 3... If the value is text instead of
//                               a list, that text is put in as ready-made HTML (how older tools worked).
function fillTemplate(text, values) {
  const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const get = (scope, key) => key.split(".").reduce((v, k) => (v == null ? undefined : v[k]), scope);
  const fill = (part, scope) => part
    .replace(/\{\{#each\s+([\w.]+)\s*\}\}([\s\S]*?)\{\{\/each\}\}/g, (_, key, inner) => {
      const list = get(scope, key);
      if (Array.isArray(list)) return list.map((item, i) => fill(inner, { ...scope, ...(item && typeof item === "object" ? item : { this: item }), "@number": i + 1, "@index": i })).join("");
      return list == null ? "" : String(list);
    })
    .replace(/\{\{\{\s*([\w.@]+)\s*\}\}\}/g, (_, k) => String(get(scope, k) ?? ""))
    .replace(/\{\{\s*([\w.@]+)\s*\}\}/g, (_, k) => esc(get(scope, k)));
  return fill(String(text), values || {});
}

// Turns HTML into a PDF with the Chrome or Edge browser already on this laptop (no extra install).
function findBrowser() {
  const candidates = process.platform === "darwin" ? [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  ] : process.platform === "win32" ? [
    path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Microsoft\\Edge\\Application\\msedge.exe"),
    path.join(process.env.ProgramFiles || "C:\\Program Files", "Microsoft\\Edge\\Application\\msedge.exe"),
    path.join(process.env.ProgramFiles || "C:\\Program Files", "Google\\Chrome\\Application\\chrome.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Google\\Chrome\\Application\\chrome.exe"),
  ] : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/microsoft-edge"];
  return candidates.find((c) => c && fs.existsSync(c));
}

function savePdf(name, html) {
  const base = path.basename(String(name || "document.pdf")).replace(/\.pdf$/i, "").replace(/[^\w.\- ]+/g, "_") || "document";
  const browser = findBrowser();
  if (!browser) {
    saveFile(base + ".html", html);
    return { saved: base + ".html", note: "No Chrome or Edge found, so an HTML file was saved instead. Open it and use Print, Save as PDF." };
  }
  fs.mkdirSync(outputDir, { recursive: true });
  const tmp = path.join(os.tmpdir(), `agent-chat-${process.pid}-${Date.now()}.html`);
  const out = path.join(outputDir, base + ".pdf");
  fs.writeFileSync(tmp, html);
  try {
    execFileSync(browser, ["--headless=new", "--disable-gpu", "--no-pdf-header-footer", `--user-data-dir=${path.join(os.tmpdir(), "agent-chat-pdf-profile")}`, `--print-to-pdf=${out}`, "file://" + tmp], { timeout: 20000, stdio: "ignore" });
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  if (!fs.existsSync(out)) throw new Error("The browser could not make the PDF");
  files.push(base + ".pdf");
  return { saved: base + ".pdf" };
}

function load() {
  const body = String(code).trim().replace(/;\s*$/, "");
  let make;
  try {
    make = new Function("tool", "getJSON", "require", "saveFile", "savePdf", "readTemplate", "fillTemplate", "readResource", "listResources", "resourceDataUrl", `"use strict";\nreturn (\n${body}\n);`);
  } catch (err) {
    throw new Error(`The code is not valid JavaScript (${err.message}). Check that you copied all of it, from tool({ to the last })`);
  }
  const def = make(tool, getJSON, require, saveFile, savePdf, readTemplate, fillTemplate, readResource, listResources, resourceDataUrl);
  if (!def || typeof def !== "object") throw new Error("A tool file must contain tool({ ... })");
  if (!def.name || !/^[a-zA-Z0-9_-]{1,64}$/.test(def.name)) throw new Error("The tool needs a name with only letters, numbers, _ and -");
  if (typeof def.run !== "function") throw new Error("The tool has no run function");
  return def;
}

try {
  const def = load();
  if (action === "describe") {
    parentPort.postMessage({
      ok: true,
      meta: {
        name: def.name,
        description: String(def.description || ""),
        inputs: def.inputs || {},
        needs: Array.isArray(def.needs) ? def.needs.map(String) : [],
        ask_first: !!def.ask_first,
      },
    });
  } else {
    const result = await def.run(args || {}, { env: env || {}, saveFile, savePdf, readTemplate, fillTemplate, readResource, listResources, resourceDataUrl, getJSON, require });
    parentPort.postMessage({ ok: true, result: result === undefined ? null : JSON.parse(JSON.stringify(result)), files, logs, requests });
  }
} catch (err) {
  parentPort.postMessage({ ok: false, error: String((err && err.message) || err), details: errorDetails(err), files, logs, requests });
}

// Skill script: prints an HTML page to a PDF with the Chrome or Edge browser on this laptop.
// Input (JSON on stdin):  { "html": "<!doctype html>...", "name": "file-name" }
//                    or:  { "file": "resources/templates/menu.html", "name": "menu" }
// Output (JSON on stdout): { "saved": "file-name.pdf" }
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const outputDir = process.env.AGENT_OUTPUT_DIR;
const appDir = process.env.AGENT_APP_DIR;

function fail(message) {
  process.stderr.write(message + "\n");
  process.exit(1);
}

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

let input = "";
process.stdin.on("data", (d) => { input += d; });
process.stdin.on("end", () => {
  let args;
  try { args = JSON.parse(input || "{}"); } catch { fail("The input was not valid JSON."); }
  if (!outputDir) fail("This script must be run by Agent Chat.");

  let html = args.html;
  if (!html && args.file) {
    // Only files inside the app's resources or output folders may be printed.
    const full = path.resolve(appDir, String(args.file));
    const allowed = [path.join(appDir, "resources"), path.join(appDir, "output")].some((dir) => full.startsWith(dir + path.sep));
    if (!allowed) fail(`"${args.file}" is not in the resources or output folder.`);
    if (!fs.existsSync(full)) fail(`There is no file "${args.file}".`);
    html = fs.readFileSync(full, "utf8");
  }
  if (!html) fail('Give either "html" (the page) or "file" (a path in resources or output).');

  const base = String(args.name || "document").replace(/\.(pdf|html?)$/i, "").replace(/[^\w.\- ]+/g, "_").slice(0, 80) || "document";
  fs.mkdirSync(outputDir, { recursive: true });

  const browser = findBrowser();
  if (!browser) {
    fs.writeFileSync(path.join(outputDir, base + ".html"), html);
    console.log(JSON.stringify({ saved: base + ".html", note: "No Chrome or Edge found. Saved an HTML file instead: open it and use Print, Save as PDF." }));
    return;
  }

  const tmp = path.join(os.tmpdir(), `agent-chat-skill-${process.pid}-${Date.now()}.html`);
  const out = path.join(outputDir, base + ".pdf");
  fs.writeFileSync(tmp, html);
  try {
    execFileSync(browser, ["--headless=new", "--disable-gpu", "--no-pdf-header-footer", `--user-data-dir=${path.join(os.tmpdir(), "agent-chat-pdf-profile")}`, `--print-to-pdf=${out}`, "file://" + tmp], { timeout: 45000, stdio: "ignore" });
  } catch (err) {
    fail("The browser could not make the PDF: " + err.message);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  if (!fs.existsSync(out)) fail("The browser did not make a PDF.");
  console.log(JSON.stringify({ saved: base + ".pdf", size_kb: Math.round(fs.statSync(out).size / 1024) }));
});

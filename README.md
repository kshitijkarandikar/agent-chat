# Agent Chat

Agent Chat is your own AI agent that runs on your laptop. You chat with it in your browser. It can use **tools** (small programs that do things, like checking the weather or working out BTW), follow **skills** (written know-how) and connect to other services.

It uses a free AI model of your choice, for example from Groq. Everything else stays on your laptop.

## Quick start on a Mac

1. Unzip the download. You get a folder called `agent-chat`. Move it somewhere easy, for example your Documents folder.
2. Open the folder and double-click **Start Agent Chat (Mac).command**.
3. The first time, macOS may say it cannot check the developer. Right-click the file, choose **Open**, then **Open** again. Step by step: [docs/install-mac.md](docs/install-mac.md).
4. A Terminal window opens and sets things up. The first time this takes a minute or two. Then your browser opens Agent Chat.
5. In Agent Chat, open **Settings**, paste your free AI key and click **Test connection**.

## Quick start on Windows

1. Right-click the download and choose **Extract All**. Do not run anything from inside the zip file.
2. Open the extracted `agent-chat` folder and double-click **Start Agent Chat (Windows).bat**.
3. If Windows says "Windows protected your PC", click **More info**, then **Run anyway**. Step by step: [docs/install-windows.md](docs/install-windows.md).
4. A black window opens and sets things up. The first time this takes a minute or two. Then your browser opens Agent Chat.
5. In Agent Chat, open **Settings**, paste your free AI key and click **Test connection**.

## What the start file does

Every time you double-click it:

1. It looks for Node.js (the engine Agent Chat runs on). If your laptop already has a recent version, it uses that.
2. If not, it downloads a private copy of Node.js from nodejs.org into the hidden `.runtime` folder inside `agent-chat`. It checks the download is genuine before using it. Nothing is installed on the rest of your laptop and you do not need admin rights.
3. If Agent Chat needs extra parts, it installs them into the `agent-chat` folder. This only happens the first time or after an update.
4. It starts Agent Chat and opens your browser. The app creates a `.env` file the first time it starts. That file holds your keys.

Only the first start needs internet for the download. After that it starts in a few seconds.

## Where things live

Everything is inside the `agent-chat` folder:

| Folder or file | What it is |
|---|---|
| `tools/` | Your tools, one file per tool. Add a file and the agent can use it. |
| `skills/` | Your skills, one folder per skill, each with a `SKILL.md` file. |
| `mcp.json` | Ready-made connections to other services (MCP servers). |
| `.env` | Your keys: the AI key and keys for other services. Keep it private. Never share it or send it to anyone. |
| `output/` | Files your agent makes, like Excel sheets and PDFs. |
| `.runtime/` | The private copy of Node.js, if one was downloaded. |

Files starting with a dot are hidden. On a Mac, press Cmd + Shift + . in Finder to show them. On Windows, choose View, then Show, then Hidden items in File Explorer.

## Stopping Agent Chat

Close the Terminal window (Mac) or the black window (Windows). You can also click in that window and press Ctrl + C.

To start again, double-click the start file again.

## If it does not start

- Mac help: [docs/install-mac.md](docs/install-mac.md)
- Windows help: [docs/install-windows.md](docs/install-windows.md)
- Problems by symptom: [docs/troubleshooting.md](docs/troubleshooting.md)

### Browser-only fallback

Some laptops, often company laptops, refuse to run the start file. Then use the browser-only version: open the `fallback` folder and double-click `agent-chat-browser-only.html`. It opens in your browser with nothing to install. It can do less (tools run inside the browser, no skills with scripts, no MCP), but it is enough to follow the workshop.

## Adding tools

A tool is something your agent can do, like a calculator or a weather lookup. Each tool is one file in the `tools` folder. The agent reads each tool's name and description and decides by itself when to use it.

The easiest way to make a tool is in the app: open **Tools** and follow the four steps under **Make a new tool**.

1. Describe your tool in plain words.
2. Let an AI write the code. Either click **Write it with my agent**, or click **Copy the prompt for another AI** and paste it into Gemini, Claude or ChatGPT.
3. The code appears in step 3 (or paste the code the other AI gave you).
4. Click **Check and try** to test it, then **Install**. The app saves it as a file in `tools`.

You can also put a `.js` file in the `tools` folder yourself. The app notices it within a few seconds (switch back to the browser tab to refresh the list).

A tool file looks like this:

```js
tool({
  name: "btw_calculator",
  description: "Work out Dutch BTW (VAT) at 9% or 21%. Use it whenever the user asks about BTW on an amount.",
  inputs: {
    amount: { type: "number", description: "Amount in euros, for example 365.02" },
    rate: { type: "number", description: "BTW rate in percent: 9 or 21" }
  },
  needs: [],          // keys from .env this tool may use, for example ["SLACK_WEBHOOK_URL"]
  ask_first: false,   // true: the app asks you before every run
  run: async ({ amount, rate }, { env, saveFile, savePdf, readTemplate, fillTemplate, getJSON, require }) => {
    const btw = amount * rate / 100;
    return { btw: btw.toFixed(2), total: (amount + btw).toFixed(2) };
  }
})
```

Good to know:

- **Tools run with full access to your laptop.** They can read and write files and use the internet. Only install tools you understand or got from someone you trust.
- **Ask first:** set `ask_first: true` for tools that send, pay, delete or change something. The chat then shows an **Allow / Don't allow** card before the tool runs.
- **Files:** a tool can call `saveFile("name.csv", text)`. The file lands in the `output` folder. The agent links it in its answer, and the chat shows **Open** and **Download** buttons. Open shows PDFs, pictures, text and web pages in a new browser tab, and opens other files (like Excel) in the program your laptop uses for them.
- **PDF files:** a tool can call `savePdf("invoice.pdf", html)`. It turns an HTML page into a PDF with the Chrome or Edge browser already on your laptop. If neither is installed, it saves an HTML file you can print to PDF yourself.
- **Resources:** the `resources` folder holds files your tools use, such as templates, price lists, logos or reference data. See [Resources](#resources) below.
- **When a tool fails:** the step in the chat shows the error, the line in the tool file where it went wrong, and anything the tool printed with `console.log`. Click **🔍 Debug this tool**: your agent runs the tool again with the same inputs, explains in plain words what went wrong, and suggests a fix. Click **Try the fix with the same inputs**, then **Save the fix** (the old version is kept in `tools/removed`). Tools marked `ask_first` are never run again while debugging. The same Debug button appears when **Try it** fails in the Tools tab, and in step 4 of **Make a new tool** (before you install). For a new tool, **Use the fix** puts the fixed code back into step 3.
- **Web requests:** when a tool calls a web service, the step lists each request, its status and, when the service said no, its answer (for example `status 400: the parameter lat is missing`). Keys are hidden as `•••`.
- **Stuck tools** are stopped after 30 seconds.
- **Removing** a tool in the app moves its file to `tools/removed`, so you can get it back.

The full prompt for other AIs is in `lib/make-a-tool-prompt.txt`.

## Resources

The `resources` folder is where you keep files your tools need: templates, a price list, your logo, a customer list, and so on. Sub-folders are fine. Open it from **Tools**, **Open the resources folder**.

What comes with the app:

- `resources/templates/invoice.html`: a ready-made invoice design. Its placeholders are listed at the top of the file, including `lines` (one table row per line item: description, qty, price, btw, amount) and `btw_rows` (one row per BTW rate). Change colours and layout to make it your own.

How tools use resources:

| Helper | What it does |
|---|---|
| `readResource("price-list.csv")` | Reads a file as text |
| `listResources()` | Lists all files in the folder |
| `resourceDataUrl("logo.png")` | Turns a picture into something you can put inside HTML or a PDF: `<img src="${resourceDataUrl("logo.png")}">` |
| `readTemplate("invoice.html")` | Reads a template from `resources/templates` |
| `fillTemplate(html, values)` | Fills in `{{placeholders}}` in a template. `{{#each lines}} ... {{/each}}` repeats a part for every item in a list, for example one table row per line item |

For example, to describe a tool: "Make a quote using the prices in resources/price-list.csv and the template resources/templates/quote.html, and save it as a PDF."

Use fake or non-sensitive data here while you learn. Tools read these files, and what they return is sent to the AI model.

## Skills

A skill is know-how for your agent: instructions in plain words, like a short manual. For example how your business writes to customers, or your rules for late payments.

Each skill is a folder in `skills` with a file called `SKILL.md`:

```text
---
name: late-payment-policy
description: The bakery's rules for chasing unpaid invoices. Use it when writing a payment reminder.
---

# Late payment policy
Write the steps and rules here.
```

The agent always sees each skill's **name and description**. It reads the full instructions only when a task needs them, so many skills do not slow it down.

Add a skill in the app (**Skills**, then upload a `SKILL.md` or paste one), or copy a skill folder into `skills`. Public skills are shared on sites like github.com/anthropics/skills.

Three example skills come with the app: `bakery-tone-of-voice`, `late-payment-policy` and `html-to-pdf`.

### Skills with scripts

A skill can bring its own scripts in a `scripts` folder inside the skill folder, for example `skills/html-to-pdf/scripts/html-to-pdf.js`. The agent runs them with the built-in `run_skill_script` tool.

- The first time a skill wants to run a script, the chat asks **Allow / Don't allow**. Your answer is remembered for that skill. Under **Skills** you can click **Stop allowing** to take it back.
- Scripts run on your laptop with full access, like tools. They get the `output` and `resources` folders, but not your keys from `.env`.
- Scripts must be JavaScript. They get their input as JSON and print their answer. Write them as modern JavaScript modules (`import fs from "node:fs"`); name the file `.cjs` if it uses `require`.
- A script that runs longer than 60 seconds is stopped.

The `html-to-pdf` skill turns any HTML page into a PDF, using the Chrome or Edge browser on your laptop. Try: "Make a one-page PDF price list for December from resources/price-list.csv."

## MCP servers

MCP is a common way to connect AI agents to other services, such as a calendar, email or files. Many ready-made MCP servers exist.

Coming next: you list MCP servers in `mcp.json` (the same format Claude Desktop uses), and their tools show up in the app next to your own tools.

## Keys

Keys are like passwords for services. They are saved in the `.env` file in this folder. The app creates that file the first time it starts.

- **Your AI key:** set it in the app under **Settings**. Paste it and click **Save**.
- **Keys for other services:** add them under **Settings**, **Keys for other services**: a name like `SLACK_WEBHOOK_URL` and the value.
- The app never shows a saved key again. It only shows whether a key is set.
- A tool only gets the keys it lists under `needs`, not all of them.
- **Never share your `.env` file** and never put it online. If you put this folder in git, `.env` is already excluded.

## Removing Agent Chat

Delete the `agent-chat` folder. That is all: nothing else was installed on your laptop.

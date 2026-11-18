# Troubleshooting

Find the problem you see, then follow the steps. Mac and Windows warnings when you first open the start file are covered in [install-mac.md](install-mac.md) and [install-windows.md](install-windows.md).

## "Could not reach nodejs.org" or the download stops

The first start downloads Node.js from nodejs.org. That needs a working internet connection.

- Check that you are online: open any website.
- Company or venue networks sometimes block downloads. Try your home wifi or a hotspot from your phone.
- No internet at all? Ask the presenter for the USB stick. It has the Node.js folder for Mac and Windows. Copy the folder for your laptop into the `.runtime` folder inside `agent-chat` (create `.runtime` if it does not exist), so you get for example `agent-chat/.runtime/node-v24.x.x-darwin-arm64`. Then double-click the start file again.

## "The downloaded Node.js does not match the official checksum"

The download was damaged or changed on the way, so it was deleted for safety. This is rare and usually caused by the network.

- Double-click the start file again.
- If it happens again, try another network (home wifi or phone hotspot).

## "Could not unpack Node.js"

- Check you have at least 200 MB of free disk space.
- On Windows: make sure you extracted the zip first and are not running from inside it.
- Your antivirus may have blocked it. See the antivirus part in [install-windows.md](install-windows.md).

## The window opens and closes right away

- Mac: start it from Terminal so the message stays visible. See "If the file opens in a text editor, or nothing happens" in [install-mac.md](install-mac.md).
- Windows: right-click the start file, choose **Edit**, and check it was not changed. Then download Agent Chat again.

## "Port in use" or Agent Chat is already running

Agent Chat picks a free port by itself. If you see a message that a port is in use, you may already have Agent Chat running in another window. Close all Terminal or black windows that run Agent Chat, then start it once.

## The browser did not open

Look in the Terminal or black window for a line like:

```
Agent Chat is running at http://127.0.0.1:3210/?token=...
```

Copy the whole link, including the part after `token=`, and paste it into your browser.

## The page says the token is missing or expired

For safety, Agent Chat makes a new secret link every time it starts. Old links and bookmarks stop working.

- Use the link shown in the Terminal or black window from the current start.
- Restarted Agent Chat? Then copy the new link.

## "The provider refused the key"

- Open **Settings** in Agent Chat and paste the key again. Make sure you copied all of it, with no space at the start or end.
- Check you picked the right provider: a Groq key only works with Groq.
- Made a new key? The old one may have been deleted. Use the new one.

## "Free limit reached" (error 429)

Free AI services limit how much you can ask per minute and per day.

- Wait a minute and try again.
- Ask shorter questions, and attach smaller files.
- Switch to another provider in **Settings**, for example Gemini or OpenRouter.

## My company laptop blocks everything

Company laptops often block downloaded programs and scripts. Please do not change security settings yourself.

- Pair up with your neighbour for the workshop.
- Or use the browser-only version: open the `fallback` folder and double-click `agent-chat-browser-only.html`. It needs no install.
- Try Agent Chat at home on a personal laptop.

## Start fresh

If things got into a strange state:

1. Close Agent Chat.
2. Delete the `.runtime` folder inside `agent-chat`. It is hidden: on a Mac press Cmd + Shift + . in Finder, on Windows choose View, Show, Hidden items in File Explorer.
3. Double-click the start file again. It downloads Node.js once more.

Your tools, skills and keys are not affected by this.

## Remove Agent Chat completely

Delete the `agent-chat` folder. Nothing else was installed on your laptop: the private copy of Node.js lives inside that folder.

Before you delete it, copy anything you want to keep: your own tools in `tools/`, skills in `skills/`, and files in `output/`.

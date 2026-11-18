# Installing Agent Chat on a Mac

This page walks you through the first start and the warnings macOS may show. They look scary, but they only mean the file was downloaded from the internet and is not signed by a paid Apple developer account.

## 1. Unzip and move the folder

1. Double-click the downloaded `agent-chat.zip`. You get a folder called `agent-chat`.
2. Move that folder to your **Documents** folder (or another place you will find again).

Starting it from the Downloads folder also works, but some Macs then ask for extra permission (see step 4).

## 2. Start it

Open the `agent-chat` folder and double-click **Start Agent Chat (Mac).command**.

## 3. If macOS says it cannot check the developer

You may see a message like:

> "Start Agent Chat (Mac).command" cannot be opened because Apple cannot check it for malicious software.

or

> Apple could not verify "Start Agent Chat (Mac).command" is free of malware.

[Screenshot: macOS warning dialog with only "Done" or "Move to Trash" buttons]

Click **Done** (not Move to Trash). Then use one of these two ways:

**Way A: right-click**

1. Right-click (or Control-click) **Start Agent Chat (Mac).command**.
2. Choose **Open**.
3. In the new message, click **Open** again.

[Screenshot: right-click menu with "Open" highlighted]

**Way B: System Settings** (needed on newer macOS versions where Way A shows no Open button)

1. Open the Apple menu, then **System Settings**.
2. Go to **Privacy & Security**.
3. Scroll down to the message about "Start Agent Chat (Mac).command" and click **Open Anyway**.
4. Enter your Mac password if asked, then click **Open** once more.

[Screenshot: Privacy & Security with the "Open Anyway" button]

You only need to do this once. After that, a normal double-click works.

## 4. If Terminal asks for permission to a folder

Terminal may ask:

> "Terminal" would like to access files in your Downloads folder.

Click **Allow**. Agent Chat needs to read its own folder. If you clicked Don't Allow by mistake, move the `agent-chat` folder to Documents and try again, or allow it later in System Settings, Privacy & Security, Files and Folders, Terminal.

## 5. If the file opens in a text editor, or nothing happens

Some unzip tools lose the setting that makes the file startable. Fix it like this:

1. Open **Terminal** (press Cmd + Space, type `Terminal`, press Enter).
2. Type `chmod +x ` (with a space at the end). Do not press Enter yet.
3. Drag **Start Agent Chat (Mac).command** from Finder into the Terminal window. Its location appears after what you typed.
4. Press Enter. Nothing is shown, which is fine.
5. Double-click the start file again.

Another way that always works:

1. Open **Terminal**.
2. Type `bash ` (with a space at the end).
3. Drag the file `setup.sh` from the `scripts` folder inside `agent-chat` into the Terminal window.
4. Press Enter.

## 6. What you should see

A Terminal window opens and shows what it is doing. The first time, it downloads a private copy of Node.js (about 50 MB):

```
Starting Agent Chat...
Node.js is needed. Downloading a private copy into this folder (about 50 MB, one time only).
Checking the download is genuine...
Unpacking...
Agent Chat is starting. Keep this window open while you use it.
```

Then your browser opens Agent Chat. Keep the Terminal window open while you use it. Closing it stops Agent Chat.

## Apple Silicon or Intel?

You do not need to know. The start file checks which kind of Mac you have and downloads the right version.

## Still stuck?

See [troubleshooting.md](troubleshooting.md). If nothing works on your laptop, use the browser-only version in the `fallback` folder (see the main README).

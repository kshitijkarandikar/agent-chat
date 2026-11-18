# Installing Agent Chat on Windows

This page walks you through the first start and the warnings Windows may show. They look scary, but they only mean the file was downloaded from the internet and is not signed with a paid certificate.

## 1. Extract the zip first

Windows lets you open a zip file like a folder, but programs do not work properly from inside it.

1. Right-click the downloaded `agent-chat.zip` and choose **Extract All...**
2. Pick a place you will find again, for example your **Documents** folder, and click **Extract**.
3. Open the extracted `agent-chat` folder.

[Screenshot: right-click menu with "Extract All..." highlighted]

If you see a message like "Could not create the folder .runtime", you are probably still inside the zip. Extract it first.

## 2. Start it

Double-click **Start Agent Chat (Windows).bat**.

Windows may hide the `.bat` ending. The file then shows as **Start Agent Chat (Windows)** with a gear or window icon.

## 3. If Windows says "Windows protected your PC"

This is Microsoft Defender SmartScreen.

[Screenshot: blue SmartScreen window with only a "Don't run" button]

1. Click **More info**.
2. Click **Run anyway**.

[Screenshot: SmartScreen after "More info", showing the "Run anyway" button]

You only need to do this once.

## 4. If Windows says "This file came from another computer"

You can unblock the file so Windows stops asking:

1. Right-click **Start Agent Chat (Windows).bat** and choose **Properties**.
2. At the bottom of the General tab, tick **Unblock**.
3. Click **OK**.

[Screenshot: Properties window with the "Unblock" tick box]

Tip: you can also unblock the zip file itself the same way before you extract it. Then nothing inside it gets blocked.

## 5. If PowerShell scripts are blocked

The start file runs one PowerShell script (`scripts\setup.ps1`). It already asks Windows to allow just that one script, so on a normal laptop you should not have to do anything.

Company laptops can have stricter rules. If you see a message about "running scripts is disabled on this system" or "blocked by group policy":

- Try it on a personal laptop, or
- Pair up with your neighbour for the workshop, or
- Use the browser-only version in the `fallback` folder (see the main README).

Please do not change company security settings yourself.

## 6. If your antivirus complains

Some antivirus programs are suspicious of new downloads. Agent Chat downloads Node.js, a widely used program, from its official website (nodejs.org) and checks it is genuine.

If your antivirus moved files to quarantine:

1. Delete the `.runtime` folder inside `agent-chat` (it may be hidden: in File Explorer choose View, Show, Hidden items).
2. Double-click the start file again.
3. If it is blocked again, ask your IT department, or use the browser-only version in the `fallback` folder.

## 7. What you should see

A black window opens and shows what it is doing. The first time, it downloads a private copy of Node.js (about 30 MB):

```
Starting Agent Chat...
Node.js is needed. Downloading a private copy into this folder (about 30 MB, one time only).
Checking the download is genuine...
Unpacking (this can take a minute)...
Agent Chat is starting. Keep this window open while you use it.
```

Then your browser opens Agent Chat. Keep the black window open while you use it. Closing it stops Agent Chat.

## Windows on ARM

Laptops with an ARM processor (for example Snapdragon based) are supported. The start file checks this and downloads the right version.

## Still stuck?

See [troubleshooting.md](troubleshooting.md).

# Installing Astali

Astali is free and works on Windows, macOS and Linux. Download it from the
[latest release](https://github.com/WinterWind33/astali/releases/latest): scroll down to **Assets** and pick the file
for your computer.

- [Windows](#windows)
- [macOS](#macos)
- [Linux](#linux)
- [Updates](#updates)
- [Use it with AI (MCP)](#use-it-with-ai-mcp)

## Windows

Download **`Astali_<version>_x64-setup.exe`**. This is the one most people want. (The `.msi` does the same job, for
schools and offices that install software for everyone.)

1. Open the file you downloaded.
2. Windows may show a blue box saying *"Windows protected your PC"*. That's because the installer isn't signed yet,
   not because something is wrong. Click **More info**, then **Run anyway**.
3. Keep the suggested folder and click through. You don't need to be an administrator.

Astali is now in the Start menu.

## macOS

Download **`Astali_<version>_universal.dmg`**. It works on every Mac, Intel or Apple silicon.

1. Open the `.dmg` and drag **Astali** onto **Applications**.
2. Open Astali from Applications. The first time, macOS says it can't check the app for malware, because Astali
   isn't notarized by Apple (that costs money every year, and Astali is free). Click **Done**.
3. Open **System Settings → Privacy & Security**, scroll down to the message about Astali and click **Open Anyway**.
   Confirm with your password.

You only do this once. If it doesn't work, open Terminal and run:

```
xattr -cr /Applications/Astali.app
```

## Linux

There are three files. Pick one:

| File | Best for | Updates |
|------|----------|---------|
| **`.AppImage`** | Any distribution, no install needed | Astali updates itself |
| **`.deb`** | Ubuntu, Debian, Linux Mint, Pop!_OS | Download and install the new `.deb` |
| **`.rpm`** | Fedora, openSUSE | Download and install the new `.rpm` |

**AppImage**: save it somewhere it can stay (for example a folder called `Applications` in your home folder), then
make it runnable and start it:

```
chmod +x Astali_*_amd64.AppImage
./Astali_*_amd64.AppImage
```

On Ubuntu 22.04 and newer, AppImages need FUSE: if it doesn't start, install `libfuse2` (`libfuse2t64` on 24.04).

**.deb**: `sudo apt install ./Astali_<version>_amd64.deb`

**.rpm**: `sudo dnf install ./Astali-<version>-1.x86_64.rpm`

## Updates

When a new version is out, an **Update to …** button appears in the title bar. Click it to see what's new, then
**Update and restart**. Nothing is downloaded until you do.

In **Settings → Updates** you can check right away, or turn off **Check for updates when Astali starts**.

On Linux, only the AppImage updates itself. With the `.deb` or `.rpm`, download the new package from the releases
page and install it the same way as the first time: your vaults and settings stay as they are.

## Use it with AI (MCP)

Astali has a built-in MCP server, so Claude (or another AI assistant) can read and change your boards. The easiest
way to set it up: open **Settings → AI integration** in Astali and copy the command shown there. It already has the
right path for your computer.

To do it by hand, the command for **Claude Code** depends on where Astali is installed:

| System | Command |
|--------|---------|
| Windows (PowerShell) | `claude mcp add astali --scope user "--" "$env:LOCALAPPDATA\Astali\astali.exe" mcp` |
| Windows (Command Prompt) | `claude mcp add astali --scope user -- "%LOCALAPPDATA%\Astali\astali.exe" mcp` |
| macOS | `claude mcp add astali --scope user -- /Applications/Astali.app/Contents/MacOS/astali mcp` |
| Linux, `.deb` / `.rpm` | `claude mcp add astali --scope user -- /usr/bin/astali mcp` |
| Linux, AppImage | `claude mcp add astali --scope user -- ~/Applications/Astali_<version>_amd64.AppImage mcp` |

On Windows, if you installed Astali for all users, the path is `C:\Program Files\Astali\astali.exe` instead. In
PowerShell keep the quotes around `"--"`: PowerShell drops it otherwise.

Add `--vault "<folder>"` at the end to always use one vault. Without it, Claude uses the vault in the repository it
runs in, or else the vault open in Astali.

For **Claude Desktop**, open its **Settings → Developer → Edit config** and add Astali to the
`claude_desktop_config.json` file (use the path from the table above):

```json
{
  "mcpServers": {
    "astali": { "command": "C:\\Users\\you\\AppData\\Local\\Astali\\astali.exe", "args": ["mcp"] }
  }
}
```

The file is in `%APPDATA%\Claude\` on Windows and in `~/Library/Application Support/Claude/` on macOS. Claude
Desktop isn't available on Linux.

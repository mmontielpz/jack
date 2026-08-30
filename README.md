# jack

`jack` lets you securely jump from your Mac into your Linux workstation.

```text
Mac → Tailscale → Tailscale SSH → Workstation
```

## Install on Mac

```bash
git clone https://github.com/mmontielpz/jack
cd jack
./scripts/setup-macos.sh
```

## Check

```bash
jack --status
```

## Connect

```bash
jack
```

## Requirements

- macOS
- Homebrew
- A Tailscale account and tailnet
- The workstation provisioned for Tailscale SSH

## Uninstall

```bash
./scripts/setup-macos.sh --uninstall
```

Removes only what `jack` installed (the `~/.local/bin/jack` symlink and its
PATH entry). Homebrew, Tailscale, and SSH configuration are left untouched.

## Principles

- Secure by default
- No public SSH exposure
- Minimal dependencies
- Bash / native OS tooling
- Simple setup
- Simple removal

## Layout

```text
bin/jack                     - the jack CLI
scripts/setup-macos.sh       - prepares the Mac client
scripts/setup-workstation.sh - future: prepare the Linux workstation
```

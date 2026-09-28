# jack

`jack` lets you securely jump between your Mac and your Linux workstation.

```text
Mac         → jack     → Tailscale → Tailscale SSH           → Workstation
Workstation → jack mac → Tailscale → macOS Remote Login (SSH) → Mac
```

## Usage

```bash
jack           # connect to the workstation
jack mac       # connect to the Mac
jack --status  # show status
```

## Install on Mac

```bash
git clone https://github.com/mmontielpz/jack
cd jack
./scripts/setup-macos.sh
```

## Install on the workstation (Arch / CachyOS)

```bash
git clone https://github.com/mmontielpz/jack
cd jack
./scripts/setup-workstation.sh
```

Installs Tailscale if missing, enables `tailscaled`, enables Tailscale SSH,
and links `jack` into `~/.local/bin`. It never enables system `sshd` or
touches the firewall. If Tailscale is not logged in yet, it tells you to run
`sudo tailscale up --ssh`.

## Reverse access: workstation → Mac

`jack mac` uses standard OpenSSH over Tailscale to `mlopez@100.76.175.55`.
On the Mac, once:

1. System Settings → General → Sharing → **Remote Login** → On.
   Under "Allow access for", choose **Only these users** → `mlopez`.
2. Authorize the workstation's public key. On the workstation:

   ```bash
   ssh-copy-id -i ~/.ssh/id_ed25519.pub mlopez@100.76.175.55
   ```

   This asks for the Mac password once; afterwards `jack mac` uses the key.

Do not forward port 22 on your router. The Mac is only reached over Tailscale.

## Uninstall

```bash
./scripts/setup-macos.sh --uninstall        # on the Mac
./scripts/setup-workstation.sh --uninstall  # on the workstation
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
scripts/setup-workstation.sh - prepares the Linux workstation
```

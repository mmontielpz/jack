# JACK

![JACK — J-shaped audio cable symbol and wordmark](assets/brand/logo.svg)

JACK is a minimal CLI for reaching your own devices over SSH, with optional Tailscale transport.

Stable release: [v0.1.0](https://github.com/mmontielpz/jack/releases/tag/v0.1.0) (v0.2.0 device-centric features are active on `main`).

- Register and connect to any named device (`jack add <alias>`, `jack connect <alias>`, `jack devices`).
- Set a default destination for bare `jack` (`jack default <alias>`), or use legacy `jack` / `jack mac`.
- Configure destinations with guided `jack setup` (direct SSH or optional Tailscale), `jack add <alias>`, or a plain configuration file.
- Diagnose prerequisites and reachability with `jack doctor`, `jack diagnose`, and `jack status [alias]`.

Supported client installation targets for v0.2.0: **Arch Linux / CachyOS** and **Ubuntu Linux (including Ubuntu on WSL2)**.
**macOS** native remains deferred and unqualified for v0.2.0; native Windows and other Linux distributions are not supported client installation paths (Windows hosts can be registered as remote SSH/Tailscale destinations).
JACK provides terminal access, not remote desktop. It relies on your existing
OpenSSH and optional Tailscale authentication and authorization.

## Quick Start (Arch / CachyOS)

Install Bash, Git, and an OpenSSH client through your normal platform workflow (`pacman -S bash git openssh`), and optionally Tailscale if you connect over a tailnet. Python 3 is optional for Tailscale peer discovery; manual setup and direct SSH work without it.

```bash
# 1. Clone and install user-level symlink (~/.local/bin/jack)
git clone https://github.com/mmontielpz/jack
cd jack
./scripts/setup-workstation.sh
export PATH="$HOME/.local/bin:$PATH"

# 2. Verify CLI and prerequisites
jack --version
jack doctor

# 3. Register your first device (direct SSH or Tailscale) and set default
jack add lab                  # interactive preview + confirmation
# or non-interactive: jack add lab --non-interactive --yes --user <user> --host <host>
jack devices
jack default lab --yes

# 4. Check status and connect
jack status lab
jack                          # connects to default device (or: jack connect lab)

# 5. Uninstall only the CLI symlink (preserves config, keys, known_hosts, backups)
jack uninstall
```

Keep the checkout in place while installed: `~/.local/bin/jack` is a symlink to `bin/jack`. Installers ask for `yes` before creating or removing the symlink; they do not install packages, enable services, or modify SSH keys/profiles. **Uninstall** removes only the `~/.local/bin/jack` symlink for this checkout and leaves `$HOME/.config/jack/config`, `~/.ssh/known_hosts`, SSH keys, and backups untouched.

Setup lets you configure either destination or both, shows a preview, and saves
only with explicit consent. Optional discovery recommends Linux peers for the
workstation and macOS peers for the Mac; **Show all devices** and manual entry
remain available. Discovery and reachability do not prove SSH authorization.
The receiving device must already allow your SSH account. Status exits non-zero
when a destination is unused or unreachable, even if the other is usable.

## Documentation

- [User guide](docs/guide.md): installation prerequisites, PATH, setup and automation,
  discovery limits, manual configuration, migration, diagnosis, upgrade and uninstall.
- [Security policy](SECURITY.md): trust boundaries and private vulnerability reporting.
- [Contributing](CONTRIBUTING.md): offline checks, bugs, proposals and pull requests.
- [Release policy](docs/releases.md): exact released source, versioning and acceptance.
- [v0.1.0 release notes](docs/release-notes-0.1.0.md): evidence and accepted limitations.
- [Brand guidelines](docs/branding.md): vector assets, palette, provenance and usage.

## License

JACK is open source under the [MIT license](LICENSE).

# JACK

![JACK — J-shaped audio cable symbol and wordmark](assets/brand/logo.svg)

JACK is a minimal CLI for reaching your own devices over Tailscale and SSH.

- Connect to a primary remote destination with `jack`, or a Mac with `jack mac`.
- Configure destinations with guided setup, optional device discovery, or a plain configuration file.
- Diagnose prerequisites with `jack doctor` and check reachability with `jack --status`.

Supported installation targets: **macOS** (primary) and **Arch Linux / CachyOS**.
Other Linux distributions and Windows are not supported installation paths.
JACK provides terminal access, not remote desktop. It relies on your existing
Tailscale and OpenSSH authentication and authorization.

## Quick Start

Install Bash, an SSH client, and Tailscale through your normal platform workflow;
connect Tailscale yourself. Git is needed for the source checkout. Python 3 is
optional for device discovery; manual setup works without it.

```bash
git clone https://github.com/mmontielpz/jack
cd jack
./bin/jack doctor
./scripts/setup-macos.sh        # macOS: consented user-level CLI link
# On Arch/CachyOS, use ./scripts/setup-workstation.sh instead.
export PATH="$HOME/.local/bin:$PATH"  # current Bash/zsh session
jack doctor
jack setup
jack --status
jack       # primary remote destination (workstation)
jack mac   # configured Mac
```

Keep the checkout: the installed command links to its `bin/jack`. Installers ask
before creating the link; they do not install packages, enable services, edit
profiles, or configure SSH. Doctor reports missing prerequisites and configuration
with next steps; an initial failure before setup is expected.

Setup lets you configure either destination or both, shows a preview, and saves
only with explicit consent. Optional discovery recommends Linux peers for the
workstation and macOS peers for the Mac; **Show all devices** and manual entry
remain available. Discovery and reachability do not prove SSH authorization.
The receiving device must already allow your SSH account. Status exits non-zero
when a destination is unused or unreachable, even if the other is usable.

## Documentation

- [User guide](docs/guide.md): installation prerequisites, PATH, setup and automation,
  discovery limits, manual configuration, migration, diagnosis, upgrade and uninstall.
- [Security policy](SECURITY.md): trust boundaries and current reporting limitations.
- [Contributing](CONTRIBUTING.md): offline checks, bugs, proposals and pull requests.
- [Planned release policy](docs/releases.md): versioning and acceptance checklist;
  no published release or package distribution is provided.
- [Brand guidelines](docs/branding.md): vector assets, palette, provenance and usage.

## License

JACK is open source under the [MIT license](LICENSE).

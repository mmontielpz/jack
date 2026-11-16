# JACK

![JACK — J-shaped audio cable symbol and wordmark](assets/brand/logo.svg)

JACK is a minimal CLI for reaching your own devices over SSH, with optional Tailscale transport.

Stable release: [v0.1.0](https://github.com/mmontielpz/jack/releases/tag/v0.1.0) (v0.2.0 device-centric features are active on `main`).

- Register and connect to any named device (`jack add <alias>`, `jack connect <alias>`, `jack devices`).
- Set a default destination for bare `jack` (`jack default <alias>`), or use legacy `jack` / `jack mac`.
- Configure destinations with guided `jack setup` (direct SSH or optional Tailscale), `jack add <alias>`, or a plain configuration file.
- Diagnose prerequisites and reachability with `jack doctor`, `jack diagnose`, and `jack status [alias]`.

Supported client installation targets: **macOS** (primary) and **Arch Linux / CachyOS**.
Other Linux distributions and Windows are not supported client installation paths (Windows hosts can be registered as remote SSH/Tailscale destinations).
JACK provides terminal access, not remote desktop. It relies on your existing
OpenSSH and optional Tailscale authentication and authorization.

## Quick Start

Install Bash and an OpenSSH client through your normal platform workflow (and
optionally Tailscale if you connect over a tailnet). Git is needed for the source
checkout. Python 3 is optional for Tailscale device discovery; manual setup and
direct SSH work without it.

```bash
git clone --branch v0.1.0 --single-branch https://github.com/mmontielpz/jack
cd jack
./bin/jack doctor
./scripts/setup-macos.sh        # macOS: consented user-level CLI link
# On Arch/CachyOS, use ./scripts/setup-workstation.sh instead.
export PATH="$HOME/.local/bin:$PATH"  # current Bash/zsh session
jack --version
jack doctor
jack setup
jack --status
jack       # primary remote destination (workstation)
jack mac   # configured Mac
```

This clones the published tag in detached HEAD state. Later development on `main`
is separate from the release. Keep the checkout: the installed command links to
its `bin/jack`. Installers ask
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
- [Security policy](SECURITY.md): trust boundaries and private vulnerability reporting.
- [Contributing](CONTRIBUTING.md): offline checks, bugs, proposals and pull requests.
- [Release policy](docs/releases.md): exact released source, versioning and acceptance.
- [v0.1.0 release notes](docs/release-notes-0.1.0.md): evidence and accepted limitations.
- [Brand guidelines](docs/branding.md): vector assets, palette, provenance and usage.

## License

JACK is open source under the [MIT license](LICENSE).

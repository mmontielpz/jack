# jack

`jack` lets you securely jump between your Mac and your Linux workstation.

```text
Mac         → jack     → Tailscale → Tailscale SSH           → Workstation
Workstation → jack mac → Tailscale → macOS Remote Login (SSH) → Mac
```

## Quick Start

After [installing JACK](#install-on-mac) on macOS or
[Arch/CachyOS](#install-on-the-workstation-arch--cachyos), run:

```bash
jack setup
jack --status
jack          # workstation
jack mac      # Mac
```

Setup asks whether to configure the workstation, Mac, or both; enter each
selected device's tailnet IPv4/hostname and SSH account. It previews the result
and saves only when you type `yes`. No existing destination is silently reused
as the target you are editing. Updating one destination preserves the other.
Use the other device's address, not this computer's address.

### Setup options and automation

```bash
jack setup --help
jack setup --non-interactive --yes \
  --workstation-user alex --workstation-host workstation.example.ts.net
```

For a Mac, use `--mac-user` and `--mac-host`. Supply both pairs to configure both
at once. Automation requires at least one complete pair, `--non-interactive`,
and `--yes`, which explicitly authorizes creation or replacement of the config.
It never prompts or contacts Tailscale. Missing values, duplicate options,
unknown options, and invalid identities fail without saving. Destination options
and `--yes` require `--non-interactive`; there are no implicit target defaults.

Interactive setup reads answers from standard input. Declining confirmation or
ending input cancels with a non-zero exit and leaves configuration unchanged.
`jack setup --help` does not read or write configuration.

### Discovery and Tailscale status

This version uses a **manual discovery fallback**: Bash and the baseline native
tools do not provide a general JSON parser, and setup adds no parser dependency.
It does not parse JSON or select peers from `tailscale status --json`. Find the
other device in the Tailscale app/admin console, then enter its IPv4 address or
MagicDNS hostname. No peers are automatically trusted, selected, or contacted.

Interactive setup checks for the Tailscale CLI and runs
`tailscale status --peers=false --self=false`, discarding all output. Success
means Tailscale reports running or starting; it does not verify a completed
connection. Failure reports unavailable/disconnected status. Manual setup still
works when Tailscale is missing, stopped, or unavailable; install/connect it
separately before using remote access. Discovery/reachability never proves SSH
authorization, and setup does not label a device READY or test SSH authentication.

### Saving safely

Setup uses the existing four-key config and identity rules below. It refuses
invalid existing configuration rather than discarding it; fix that file manually
before retrying. It rewrites configuration in canonical key order, preserving
other device entries but removing comments. Every interactive save requires an
explicit `yes`, including replacements; automation's `--yes` provides that consent.

Saves use a private same-directory temporary file, mode `600`, and atomic rename;
the JACK configuration directory is restricted to mode `700`. A setup lock and
content recheck guard against overlapping saves. Failed writes preserve an
existing config and clean up temporary files. After an abrupt process kill, a
`.setup-lock` directory may remain; inspect it and ensure no setup is running
before removing it manually. Setup refuses symlink configuration paths, non-owned
paths, and group/other-writable configuration directories (including HOME).
Users with symlink-managed config can use the manual alternative below.

Setup stores no secrets and performs no installation, service changes, sudo,
SSH connections, key creation/upload, ACL changes, or SSH-policy changes.

## Usage

```bash
jack           # connect to the workstation
jack mac       # connect to the Mac
jack --status  # show configured devices and reachability
jack --help    # show usage and configuration guidance
```

## Manual configuration alternative

JACK reads `$HOME/.config/jack/config`. From the repository checkout:

```bash
mkdir -p "$HOME/.config/jack"
cp config.example "$HOME/.config/jack/config"
```

If you already have a config, edit it rather than overwriting it. Replace the
illustrative values with your own destination accounts and tailnet addresses:

```text
WORKSTATION_USER=alex
WORKSTATION_HOST=100.101.102.103
MAC_USER=alex
MAC_HOST=100.104.105.106
```

On each destination, find its Tailscale IPv4 address in the Tailscale app or
admin console, or with `tailscale ip -4`. A Tailscale DNS/MagicDNS hostname is
also accepted. Use the SSH account on that destination, not your local account.
`jack` selects WORKSTATION; `jack mac` selects MAC. Set both USER and HOST keys
for each destination you use; omit both keys for an unused destination.
An incomplete destination cannot connect, but the other complete one can.

The format is literal `KEY=VALUE`: no spaces around `=`, quotes, expansions,
inline comments, or executable shell syntax. Blank lines and full-line comments
are allowed. Duplicate/unsupported keys, empty values, and malformed identities
are errors and prevent all connections. Configuration is never executed.
Usernames start with an ASCII letter or underscore and contain only ASCII
letters, digits, underscores, dots, or hyphens (maximum 64 characters).
Hosts accept canonical IPv4 or DNS labels (letters/digits with internal hyphens,
maximum 63 characters per label and 253 overall). IPv6, ports, trailing dots,
SSH options, and shell metacharacters are unsupported. Store no credentials or
private keys in this file. Use your SSH agent and normal SSH authentication.

`jack --help` works without configuration. To validate syntax and identities,
run `jack --status`: it rejects invalid configuration before network operations.
With valid configuration it queries Tailscale and probes configured devices.
Status distinguishes configured/unconfigured and reachable/unreachable/unknown;
it exits non-zero if either device is unconfigured, either is not reachable,
or a required client is unavailable. Reachability does not prove SSH access or
authentication; only a real SSH session can do that. SSH host verification
continues to use your existing OpenSSH policy. Use tailnet addresses only;
JACK does not verify that a configured hostname belongs to your tailnet.

### Migrating from earlier versions

Previous versions embedded the original developer's destinations. Those defaults
are removed with no fallback. Run `jack setup` on each machine (or create the
file manually) and explicitly enter your own accounts and addresses before using `jack` or
`jack mac`. Installers do not create or migrate configuration. Uninstall leaves
your configuration in place. Missing configuration never connects anywhere.

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

`jack mac` uses standard OpenSSH over Tailscale to your configured Mac.
On the Mac, once:

1. System Settings → General → Sharing → **Remote Login** → On.
   Under "Allow access for", choose **Only these users** → your configured Mac account.
2. Authorize the workstation's public key. On the workstation:

   ```bash
   ssh-copy-id -i ~/.ssh/id_ed25519.pub alex@mac.example.ts.net
   ```

   Replace the example destination with your configured Mac account and tailnet
   host. This may ask for the Mac password; afterwards `jack mac` uses the key.

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

## Contributing

To work on the code, see [CONTRIBUTING.md](CONTRIBUTING.md) (validate with
`./scripts/dev-check.sh`; the setup scripts above are for installing jack, not
for validating changes) and the workflow in [.ai/WORKFLOW.md](.ai/WORKFLOW.md).

## Layout

```text
bin/jack                     - the jack CLI
scripts/dev-check.sh         - read-only contributor validation
scripts/setup-macos.sh       - prepares the Mac client
scripts/setup-workstation.sh - prepares the Linux workstation
```

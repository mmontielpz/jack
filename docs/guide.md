# JACK user guide

[Project overview and Quick Start](../README.md)

## Guided setup and automation

After source installation, run `jack doctor`, then `jack setup`. Choose workstation,
Mac, or both; select a peer or enter the other device's tailnet address, then its
SSH username. Setup previews the result and requires `yes` to save. It does not
silently reuse the destination being edited; updating one preserves the other.


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

Interactive setup uses `tailscale status --json` when the Tailscale CLI and a
working **optional Python 3** interpreter are already available. Python's standard
`json` and `ipaddress` libraries parse and validate data structurally. JACK does
not install Python, jq, or other packages; Python is not required for manual
setup, automation, or the existing connection/status commands. On macOS without
Python, manual setup remains fully available. A missing/broken interpreter,
missing CLI, disconnected daemon, malformed/unsupported response, or no usable
peers produces a short explanation and a manual-entry prompt.

With discovery, each choice shows a short device name, reported OS, and IPv4
address. Setup first recommends Linux devices for **workstation**, and macOS
devices for **Mac**. Workstation is your primary remote destination, commonly
Linux; recommendations are advisory. The Mac destination represents a Mac.
Choose `a) Show all devices` to access every discovered peer, or
`0) Enter an address manually` at either view. If no devices report the
recommended OS, both options remain available. The same prompt shows the full
list after `a`; there are no nested menus or default device selections.
Numbers follow numeric IPv4 order within the displayed list. Choose each role
independently when configuring both destinations.

Selecting a device with a known OS that differs from the role's recommendation
shows a warning and requires an explicit `yes` before continuing. Declining or
ending input cancels without saving. Unknown OS displays **Unknown** and explains
that compatibility is unverified; it does not trigger a mismatch warning.
Exact manually entered discovered IPv4 addresses receive the same OS advice;
manual hostnames/aliases are not resolved to infer OS. Final configuration
preview and save consent are still required. If both host strings match, the
separate duplicate-destination confirmation also remains. Non-interactive setup
is unchanged: no discovery, OS prompts, or new arguments; `--yes` authorizes the
explicitly supplied configuration.

Only canonical Tailscale IPv4 addresses (`100.64.0.0/10`) are selectable. The
local device remains excluded by its addresses and identity metadata; responses
without usable local IPv4 identity fall back to manual entry. Duplicate
addresses produce one “Multiple peers sharing address” entry with OS **Unknown**;
identical names are distinguished by address. Display names prefer `HostName`,
fall back to `DNSName`, and use the first dot-separated component, at most 80
characters. Characters outside ASCII letters, digits, spaces, dots, underscores,
and hyphens become `?`. Missing names show “Unnamed peer”. Only addresses are saved.

OS labels recognize the exact Tailscale/Go identifiers `linux`, `macOS`, `darwin`,
`windows`, `android`, `iOS`, `tvOS`, `freebsd`, and `openbsd`; `darwin` maps to
macOS. Missing, malformed, or unrecognized values become **Unknown**. OS is
self-reported metadata, not a compatibility guarantee; distro names, substrings,
and device names are never used to guess an OS. Display metadata is never used
in commands or written to configuration.

Discovery requires `BackendState` to be `Running`. It does not test peer
reachability, SSH support, or SSH authorization, and never labels peers READY or
connects to them. Peer online flags are not used. Tailscale's
[JSON fields](https://github.com/tailscale/tailscale/blob/main/ipn/ipnstate/ipnstate.go)
can change; unsupported responses fall back safely. Responses over 1 MiB, more
than 4096 peer records, duplicate JSON keys, and invalid JSON are rejected.
Python runs in isolated mode with bytecode writes disabled; peer data is never
executed or interpolated into code.

For manual setup, find the other device in your Tailscale app/admin console and
enter its IPv4 or MagicDNS hostname. Install/connect Tailscale separately before
remote access. Manual entries retain the configuration validation rules below; JACK does not resolve
hostnames to detect aliases or verify tailnet membership.

### Saving safely

Setup uses the four-key config and identity rules below. It refuses
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
jack --version # report source version without configuration or network access
```

## Direction and self-targeting

Commands select a configured role, regardless of which machine runs JACK:

| Typical source | Command | Configured destination |
| --- | --- | --- |
| Mac | `jack` | WORKSTATION (commonly the Linux workstation) |
| CachyOS workstation | `jack mac` | MAC |

`jack` always selects WORKSTATION; it does not automatically choose the other
machine. If WORKSTATION points to the CachyOS machine you are using, running
`jack` there attempts a self-connection. Discovery excludes the current device,
but manual configuration accepts its address. This is a known limitation, not
a direction-switching feature.

A `Connection refused` error means the connection was rejected; it does not prove
SSH authentication failed. Check that the configured destination is the intended
remote machine and that its owner has enabled the appropriate receiving SSH
service and access policy. Reachability alone does not establish a listening SSH
service or authorization. JACK does not enable services or repair policies.

## Manual configuration alternative

JACK reads `$HOME/.config/jack/config`. From the repository checkout, copy the
example only if no configuration exists; otherwise edit the existing file:

```bash
mkdir -p "$HOME/.config/jack"
cp config.example "$HOME/.config/jack/config"
```

Replace the
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
run `jack doctor` for read-only diagnosis without peer probes. You can also run
`jack --status`: it rejects invalid configuration before network operations.
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

## Install from a source checkout

Required for remote connections: Bash (macOS system Bash 3.2 supported), an
OpenSSH client, and the Tailscale CLI with an authenticated, running daemon.
Git is needed to obtain/update the checkout. Python 3 is optional for discovery;
manual configuration works without it. Homebrew is not required by JACK's installer.

The [v0.1.0 release](https://github.com/mmontielpz/jack/releases/tag/v0.1.0) is published from
`e2d16a21c810e9addcc65c2b5412795aa1d44422`. The commands below clone that tag in
detached HEAD state; future development on `main` is separate. Keep the checkout
in place: installation links to its `bin/jack`. No package registry or binary
release installer is provided.

## Install on Mac

```bash
git clone --branch v0.1.0 --single-branch https://github.com/mmontielpz/jack
cd jack
./bin/jack doctor
./scripts/setup-macos.sh
```

Install Tailscale separately using its official macOS application/CLI and
complete login/approval yourself. An optional package manager is your choice;
JACK never installs Homebrew or runs remote installation scripts. macOS normally
includes an SSH client. To receive SSH, enable Remote Login explicitly as below;
JACK does not enable it.

## Install on the workstation (Arch / CachyOS)

```bash
git clone --branch v0.1.0 --single-branch https://github.com/mmontielpz/jack
cd jack
./bin/jack doctor
./scripts/setup-workstation.sh
```

The Linux installer verifies Arch/CachyOS through `/etc/os-release` and requires
the existing `pacman` command. Install
missing `openssh` and `tailscale` packages yourself through your normal admin
workflow. If needed, explicitly enable/start `tailscaled` and authenticate
Tailscale outside JACK. Receiving connections through Tailscale SSH also requires
explicit authorization and enablement by the device owner. These are separate
admin decisions: JACK no longer invokes pacman, sudo, systemctl, or
`tailscale set --ssh`. It never enables system sshd or changes the firewall.

Both scripts explain prerequisites, then require exact `yes` before creating
`$HOME/.local/bin/jack`. Declining or EOF cancels. Repeating installation of the
same checkout is a no-op; unrelated files or symlinks are refused, never replaced.
The installer refuses symlinked/non-owned or group/other-writable installation
directories. It preserves your JACK configuration, SSH keys, and shell profiles.
No package installation, service changes, SSH policy changes, or profile edits
are performed. A failed/declined installation may be retried after inspecting its
error; directories created just before a failed link operation may remain.

### Lifecycle CLI in development checkouts (planned v0.1.1)

The published v0.1.0 tag continues to use the scripts above. Development
checkouts containing the lifecycle commands also support:

```bash
./bin/jack install
jack uninstall
# Or, without PATH: "$HOME/.local/bin/jack" uninstall
```

These commands delegate to the same platform scripts. `--help` explains each
command. They show the source CLI and installation link before requiring exact
`yes` for a change. Repeat installation and already-absent removal are no-ops;
other files, directories and unrelated/dangling links are refused. Uninstall
removes only the matching link, never its source checkout or user data.

Direct invocation and the installed symlink support paths containing spaces.
The CLI resolves at most 16 symlinks and refuses missing, symlinked or unsafe
helpers and non-owned/group-or-other-writable checkout directories or helper
files. Installation directories retain the existing safety checks. Legacy
setup scripts remain supported. No automatic update or rollback is provided.

Keep the source checkout in place. If it moved or disappeared, run `doctor` from
an intact checkout to diagnose the broken installed link; a broken command cannot
diagnose itself. Inspect the old link manually before any removal. `doctor` also
warns about user-managed paths or links to another checkout, without repairing
them. Its exit codes remain 0 pass, 1 failure and 2 warnings only.

EOF or cancellation refuses the change. Failed filesystem operations report
which step failed; newly created directories may remain and are never removed
automatically. Config, SSH keys, services and profiles stay untouched. Path
checks do not guarantee protection against every hostile same-user race.
Native macOS acceptance of these development commands remains pending.

### Verify installation and PATH

```bash
"$HOME/.local/bin/jack" doctor
```

If `jack` is not found, use that full path. For the current Bash/zsh session:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

For a permanent entry, inspect and edit your own shell profile. Fish users can
choose `fish_add_path ~/.local/bin`. Installers never edit shell files, including
entries from older JACK versions. Then follow `jack doctor` → `jack setup` →
`jack --status` → `jack` / `jack mac`. With one destination intentionally unused,
`--status` still exits non-zero for that unconfigured destination.

### Read-only diagnosis

`jack doctor` reports PASS/WARN/FAIL for the running CLI (using the same version
identity as `jack --version`), supported OS, Tailscale CLI/daemon state, SSH client, optional
Python discovery capability, and configuration. It provides next actions without
displaying configured identities or raw daemon output. Linux detection reads
`ID=arch`/`ID=cachyos` from `/etc/os-release`; other/unknown distributions fail the
supported-platform check. No profile is sourced to detect the OS.

Exit codes: **0** all checks pass; **1** at least one failure; **2** warnings only
(for example optional Python unavailable or one unused destination). Missing or
invalid config fails with next steps. Without Python, daemon status can only be
reported as running/starting or unavailable: the exact state remains unverified.
Doctor performs no peer pings, SSH sessions, installation, sudo, or system changes.
PASS never proves peer reachability, Tailscale SSH authorization, or authentication.

### Upgrade

A release-tag checkout is pinned and detached: do not use `git pull` there.
For a later published release, first inspect `git status` and preserve local work,
fetch its tag, verify the release's documented source commit, and explicitly switch
to that reviewed tag. No later release is assumed here, and no forced checkout or
tag replacement is needed. The installed link then follows that selected source.

For an explicitly chosen development checkout on a clean branch tracking `main`,
`git pull --ff-only` remains the source-upgrade workflow. This follows development,
not the fixed v0.1.0 release. Run `./scripts/dev-check.sh` and `jack doctor` after
an approved update. Existing configuration and keys are not migrated or overwritten.
If the checkout moved, inspect/remove its old symlink yourself before installing
from the new location; JACK refuses to replace links to other checkouts.

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

Requires exact `yes` to remove only the symlink pointing to this checkout.
Unrelated commands/links are refused. Configuration, keys, packages, services,
and profiles stay untouched. If an older installer added PATH lines, inspect
and remove those lines manually; uninstall does not rewrite your profile.


## Security and contribution

See the [security policy](../SECURITY.md) for trust boundaries and reporting
limitations, and [CONTRIBUTING](../CONTRIBUTING.md) for offline development checks.

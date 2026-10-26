# JACK v0.1.1 — candidate notes (unpublished)

This is release preparation, not a published release. No v0.1.1 tag or release
is created by this change. The published stable release remains
[v0.1.0](https://github.com/mmontielpz/jack/releases/tag/v0.1.0), fixed at
`e2d16a21c810e9addcc65c2b5412795aa1d44422`. Its notes and historical acceptance
remain unchanged. Final preparation SHA and CI results belong to the review PR;
`0.1.1` alone is not proof of a frozen or accepted build.

## Changes since v0.1.0

- `jack install` and `jack uninstall` reuse the existing platform scripts, show
  affected paths and require exact consent for changes. Matching installation
  and already-absent removal are no-ops; unknown files and links are refused.
- `jack update` provides an offline, read-only plan from local source/Git state.
  It does not fetch, select an update, switch source, install or perform rollback.
- Installer hardening refuses destinations occupied during the consent window,
  including directories and directory symlinks, without creating nested links.
  This is not a guarantee against every hostile same-user filesystem race.
- Portable offline lifecycle tests canonicalize temporary paths, retain the native
  `readlink` executable name and verify that fault injections are actually reached.
- Version preparation updates the authoritative CLI constant and matching test
  expectations. It changes no connection, configuration or installer behavior.

The functional baseline is `f184158c7ea269d75393c2d0d5f39809937562d6`.
The validated harness commit `6712685925f138e4e7087cc19f04676c59b2ecd0` is its
direct child and changes only `scripts/dev-check.sh`. This preparation starts
from that exact commit; the only subsequent production-file change is version
metadata in `bin/jack`.

## Platforms, installation and migration

Source installation targets remain **macOS** (primary) and **Arch Linux / CachyOS**.
Ubuntu CI does not establish Ubuntu product support. Windows, other Linux
distributions, GUI and remote desktop are not supported installation paths/features.
Connections require Bash, an OpenSSH client and connected Tailscale. Git obtains
the source; Python 3 discovery is optional. No mandatory dependency is added.

The [Quick Start](../README.md#quick-start) intentionally installs published
v0.1.0. Evaluate this unpublished candidate only from an explicitly reviewed
source revision; inspect its full commit and clean-tree state before execution.
Do not assume `git clone --branch v0.1.1` is available. From a reviewed candidate
checkout, `./bin/jack install` offers the same consented user-level link workflow;
legacy setup scripts remain available. Existing unrelated installations are
refused rather than replaced. See the [guide](guide.md#lifecycle-cli-in-the-v011-candidate-unpublished).

Existing four-key configuration at `$HOME/.config/jack/config` needs no syntax
migration. Install/uninstall do not modify configuration, SSH keys, profiles,
Tailscale state or services. Retain the source checkout: the installed symlink
follows it, so source changes affect the installed command immediately.

Upgrades remain [explicit owner-operated source changes](guide.md#upgrade),
not an action performed by `jack update`. Never use generic `git pull` on a
detached release checkout. Record the prior commit and preserve local changes
before any separately authorized update. There is **no automatic rollback**.
Manual recovery tested below applies only to fixture-owned links.

## Acceptance evidence and provenance

Results distinguish the validated functional code from this version-preparation
revision. No new remote session, real installation transition or setup save is
performed by this preparation. No v0.1.0 acceptance waiver is inherited.

| Check | Evidence | Scope / limitation |
| --- | --- | --- |
| Linux functional baseline plus harness | Agent-observed 15D11: 21/21 groups PASS; standalone ShellCheck exit 0, zero findings | Native CachyOS, Bash 5.3.20; disposable fixtures |
| Linux version-preparation regression/lint | Agent-observed 15D12: 21/21 groups PASS, exit 0; standalone ShellCheck exit 0, zero findings | Native CachyOS, Bash 5.3.20; updated version and doctor assertions passed; no real-user lifecycle operations |
| Native macOS candidate provenance | Agent-observed 15D10 Phase B/C: 15 archived files matched the baseline plus exact harness correction before/after execution | macOS 15.7.7 ARM64, Bash 3.2.57; archive subset, not a native Git HEAD verification |
| Native macOS isolated lifecycle | PASS: install, repeat install, uninstall, reinstall, foreign-file/link refusal and synthetic data preservation | Real native installer code; disposable HOME; existing user installation preserved |
| Native macOS recovery and cleanup | PASS: manual stale fixture-link recovery and verified test-owned cleanup | Does not demonstrate automatic product rollback or real-user recovery |
| Native macOS regressions | PASS: 21/21 groups, no group skips; changed-link and failing-operation injections reached | Native tools/system Bash; functional baseline plus harness, version then reported 0.1.0 |
| Native macOS ShellCheck | SKIP: not installed | Optional; Linux lint is reported separately |
| Linux-to-Mac JACK access | Agent-observed guarded JACK sessions PASS in 15D7/15D10 | Existing strict host-key verification and public-key authentication; not rerun here |
| Mac-to-Linux JACK access | Owner-reported successful JACK CLI connection | Not independently agent-observed in this preparation |
| New 0.1.1 metadata on native macOS | NOT_RUN | Prior native version/help results were 0.1.0; do not relabel them as new execution |
| Real-user v0.1.0-to-v0.1.1 installation/source upgrade | NOT_RUN on either platform for this preparation | Disposable lifecycle acceptance does not prove upgrade of an existing real installation |
| Required PR CI for this preparation | PENDING / unverified until a PR and its checks exist | Required job is `checks`; no CI success is predicted |

The exact local/remote command evidence is retained outside the source checkout
in the engineering acceptance records; private accounts, hostnames, tailnet
addresses and raw diagnostics are intentionally excluded from public notes.

## Remaining release gates and limitations

- Complete review and required PR `checks`, then freeze and record the final
  accepted source SHA. No merge, tag or publication is authorized by these notes.
- Attribute the [per-platform release checklist](releases.md#release-checklist),
  including real-machine doctor/setup/status, to current evidence or obtain an
  explicit owner disposition. Offline fixtures do not establish all real-device
  onboarding cases. New macOS version-metadata execution remains NOT_RUN.
- Obtain owner disposition for unverified real installation upgrades and any
  remaining platform/connectivity gaps; no pending item is silently waived.
- Discovery/reachability does not establish SSH authorization. Workstation/Mac
  routing remains explicit and can self-target; use the intended direction.
- Ownership checks and consent reduce accidental damage, but do not defend against
  a compromised account or every same-user race. A failed operation can leave
  newly created directories; inspect them before recovery rather than deleting
  unknown data. Missing/moved sources can break installed symlinks.

JACK retains the user's Tailscale/OpenSSH trust boundary and host-key policy. It
does not enroll keys, grant SSH access, install packages or harden endpoints.
Report vulnerabilities privately through [SECURITY.md](../SECURITY.md). No new
security audit, support SLA, platform guarantee or automatic rollback is claimed.

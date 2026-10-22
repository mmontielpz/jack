# JACK v0.1.0 — unpublished release preparation

The prepared CLI identity is `0.1.0`, intended for a future `v0.1.0` tag.
No tag, GitHub release, publication date or package is created by this preparation.
The PR is for review only; merging and publishing require separate authorization.
Open acceptance items below remain requirements, not implicit waivers.

## Product and changes

JACK is a minimal Bash CLI for reaching configured devices over Tailscale and
OpenSSH. Supported source installation targets are macOS (primary) and
Arch Linux / CachyOS. There is no GUI, remote desktop, Windows implementation,
universal Linux installer or package distribution.

The source provides explicit four-key configuration, guided setup, optional
Tailscale device discovery with OS advice, doctor, status, and consented
user-level link installers. Stable preparation changes only the authoritative
version and its expected test output, and updates current release documentation.
It adds no transport, authentication, installation or configuration behavior.

See the [user guide](guide.md) for installation, setup, upgrade and uninstall,
and [release policy](releases.md) for versioning and release gates. The
[original RC notes](release-notes-0.1.0-rc.1.md) are preserved as historical material.

## Dependencies and migration

Connections require Bash (macOS system Bash 3.2 supported), an SSH client and
connected Tailscale. Git obtains the source checkout. Python 3 is optional for
discovery; manual setup remains available. No new mandatory dependency is added.

Existing valid configuration at `$HOME/.config/jack/config` needs no migration
from the reviewed RC. It retains WORKSTATION_USER, WORKSTATION_HOST, MAC_USER and
MAC_HOST. Older hardcoded-destination users must explicitly configure their own
accounts and addresses; follow the [migration guide](guide.md#migrating-from-earlier-versions).
Installers do not create config or modify keys, packages, services or profiles.
An installed link follows its checkout, so updating source changes the command.

## Acceptance evidence and provenance

The reviewed RC baseline is **8f2e9ad9e4e0f181bab55c1dd4079c81e2051a45**,
version `0.1.0-rc.1`. Historical results below apply to that RC; a stable version
string alone does not transfer acceptance to a new build. Record the final
reviewed/merged SHA and owner acceptance decision before any release. This file
does not invent a future stable SHA or infer macOS HEAD from version output.

| Check | Evidence and provenance | Scope / limitation |
| --- | --- | --- |
| RC required GitHub CI | GitHub-verified [PR #14](https://github.com/mmontielpz/jack/pull/14), [checks run](https://github.com/mmontielpz/jack/actions/runs/39737584827); SUCCESS | Final PR head was squash-merged to the exact RC baseline; Ubuntu only |
| RC Linux audit | Agent-observed Slice 14D: 18 offline groups PASS, ShellCheck 0.11.0 zero findings, docs/links reviewed | CachyOS/Linux, not native macOS |
| RC CachyOS installation | Agent-observed Slice 14C2: consented installation exit 0; repeated installer exit 0/no-op; original legacy link preserved | Actual user-level link; no uninstall or simulated upgrade executed |
| RC local config audit | Agent-observed Slice 14D: parser exit 0; directory 700/file 600; no private values disclosed | Does not establish SSH authentication |
| RC macOS checks | Owner-reported version `0.1.0-rc.1`, offline checks PASS, doctor/status PASS | Not independently verified; exact Mac commit, OS/Bash versions and exit-code transcript not supplied |
| Native macOS ShellCheck | NOT_RUN; owner reported ShellCheck unavailable | Linux lint results do not replace native Mac lint; ShellCheck is optional |
| RC CachyOS runtime acceptance | Owner-reported doctor/status PASS and candidate version | Kept distinct from earlier agent-observed missing-config results |
| RC Mac to Linux session | Owner-reported successful `jack` session and clean closure | No independent agent verification; identities withheld |
| RC Linux to Mac session | Owner-reported successful `jack mac` session and clean closure | No independent agent verification; identities withheld |
| Stable preparation checks | Local offline/lint/consistency results recorded in [Slice 14E](../.ai/history/14E.md); required CI evidence belongs to the associated PR | No stable-build real SSH, installation or native macOS runtime tests performed in this slice |

No additional SSH, installation or system changes were performed to prepare
these notes. Preserve historical RC/slice evidence rather than rewriting its
pre-merge facts or turning owner reports into agent-verified results.

## Open release checklist

| Item | Status / required disposition before publication |
| --- | --- |
| Stable source version and expected assertions | Prepared as 0.1.0; final commit must pass local checks and required PR CI |
| Final release SHA / merge authorization | Not assigned by these notes; review PR, separately approve merge, then record exact final SHA |
| Real macOS install/repeat/uninstall preservation | NOT_RUN in agent records; full current-candidate owner evidence not supplied; complete or obtain explicit owner-approved policy disposition |
| Real CachyOS uninstall/reinstall preservation | NOT_RUN; only install/repeat independently supported; complete or obtain explicit owner-approved policy disposition |
| Manual upgrade behavior on supported platforms | NOT_RUN; no checkout update was performed for acceptance |
| Full per-platform setup checklist | Offline fixtures PASS; actual discovery/manual, noninteractive, cancellation and preservation cases are not individually documented for both machines; owner must supply results or explicit disposition |
| Precise platform/build record | Owner must record actual macOS SHA, OS/Bash/dependency versions and final stable-build acceptance scope; RC version equality is insufficient |
| Final brand visual acceptance | Not established by supplied evidence; owner review remains separate |
| Release authorization | NOT_GRANTED by this preparation; no tags or publishing allowed |

Unverified checklist items are not silently waived. Stable publication remains
conditional on resolving them through evidence or an explicit owner decision
consistent with the [release policy](releases.md).

## Security and known limitations

Report suspected vulnerabilities through [GitHub private reporting](../SECURITY.md).
Keep credentials, keys, tokens and private tailnet diagnostics out of public issues.
JACK retains the user's Tailscale/OpenSSH authorization and host-key policies;
it does not harden endpoints or certify SSH access. Configuration validates
syntax, not tailnet membership. Discovery metadata is advisory. Setup uses private
files, a lock and atomic replacement; hostile same-user races and abrupt-kill
stale locks remain documented limitations. No security audit or response SLA is claimed.

`jack` always selects WORKSTATION and `jack mac` always selects MAC, regardless
of the source computer. On the configured workstation, `jack` can target itself;
a refusal is not proof of SSH authentication failure. This is a non-blocking
limitation, not an automatic direction-selection feature. Use `jack` from the Mac
to the workstation and `jack mac` from the workstation to the Mac as configured.
See [direction and troubleshooting guidance](guide.md#direction-and-self-targeting).

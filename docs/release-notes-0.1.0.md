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

## Stable acceptance evidence — Slice 14J

The stable acceptance subject is **1c20cf59f11873e397e5e47cd6a30d5c3fe29a4f**,
version `0.1.0`. Results below supplement the preserved historical RC evidence;
they do not retroactively change it. This documentation update changes no runtime
behavior. The final merged release SHA must still be recorded after authorization.

Status meanings: **PASS** is scoped successful evidence with provenance;
**PARTIAL** means some required coverage remains; **NOT_TESTED** includes
unverified/unconfirmed cases, not assumed success; **WAIVED** requires a specific
explicit owner decision. **No waivers have been granted by this record.**

| Acceptance item | Status | Provenance and exact scope |
| --- | --- | --- |
| CachyOS native CLI and offline checks | PASS | Agent-observed and owner-reported: CLI 0.1.0, 18/18 groups; native CachyOS, Bash 5.3.20 |
| CachyOS ShellCheck | PASS | Agent-observed ShellCheck 0.11.0, zero findings |
| Stable candidate CI | PASS | GitHub-verified [PR #15](https://github.com/mmontielpz/jack/pull/15) [checks run](https://github.com/mmontielpz/jack/actions/runs/39742366276) at the stable acceptance SHA; a new documentation commit requires its own PR checks |
| CachyOS doctor/status | PASS | Owner-reported stable runtime results; no fresh live probes performed for this documentation |
| CachyOS isolated install/repeat/uninstall/reinstall | PASS | Agent-observed native Slice 14G2; all four operations exit 0; isolated installed CLI reports 0.1.0 |
| CachyOS refusal and fixture preservation | PASS | Slice 14G2: declined/EOF consent and occupied file, unrelated/dangling symlink and directory refused with expected exit 1; synthetic config, keys, profile and unrelated files preserved; disposable environment removed |
| macOS stable SHA, CLI and offline checks | PASS | Owner-reported exact stable acceptance SHA, version 0.1.0, clean candidate tree and 18/18 native checks; not independently verified by agent |
| macOS ShellCheck | NOT_TESTED | Owner-reported SKIP because not installed; optional tool, not a silent waiver of another gate |
| macOS doctor/status | PASS | Owner-reported native stable results; not independently verified |
| macOS isolated basic lifecycle | PASS | Owner-reported native install/repeat/uninstall/reinstall; scope is basic lifecycle only |
| macOS original installation preservation | PASS | Owner-reported original installed RC and its symlink remained unchanged; does not establish synthetic fixture preservation |
| macOS synthetic fixture preservation | NOT_TESTED | NOT VERIFIED; config/key/profile/unrelated-fixture preservation not established by supplied evidence |
| macOS refusal edge cases | NOT_TESTED | Native edge cases not reported tested; existing offline cases do not become independently observed native results |
| macOS temporary sandbox cleanup | NOT_TESTED | NOT CONFIRMED; must identify the test-owned sandbox and confirm safe cleanup separately |
| CachyOS isolated RC-to-stable source upgrade | PASS | Agent-observed Slice 14I: installed RC 0.1.0-rc.1 at 8f2e9ad9e4e0f181bab55c1dd4079c81e2051a45; clean disposable checkout upgraded by `git pull --ff-only`, exit 0, to stable acceptance SHA/version 0.1.0 |
| Upgrade preservation/linkage | PASS | Slice 14I retained config/key/profile/unrelated bytes and modes, installation symlink target and inode; post-upgrade help/version exit 0, 18/18 checks PASS, zero lint findings; disposable resources removed; monitored real paths unchanged |
| Isolated post-upgrade doctor | PARTIAL | Slice 14I intentionally omitted Tailscale from diagnostic PATH; exit 1 is the expected missing-prerequisite diagnostic. Platform/config checks PASS; this is not full connectivity acceptance or a JACK defect |
| macOS source upgrade | NOT_TESTED | No native Mac RC-to-stable source-upgrade evidence supplied |
| Bidirectional RC interactive SSH | PASS | Owner-reported successful sessions and closure in both directions; identities omitted; no independent agent verification |
| Subsequent interactive access/stable code execution | PASS | Owner-reported interactive access to the Mac and stable candidate execution inside that session; this does not prove stable JACK initiated SSH |
| Stable candidate initiating SSH | NOT_TESTED | NOT VERIFIED; do not infer from RC sessions or running candidate code inside an existing session |
| Agent noninteractive SSH transport | PARTIAL | Slice 14G3: one BatchMode attempt, exit 255, AUTH_REQUIRED. Remote test script never executed; no product defect established or authentication changes made |

Slice 14I used a local filesystem upstream, not GitHub, and a disposable branch
tracking the stable candidate rather than public main. The documented pull command
performed a fast-forward to the existing commit; no merge commit was created.
This proves the isolated native CachyOS source-upgrade path, not native Mac upgrade
or network/authentication behavior. No additional real-system acceptance tests or
live connections were performed for this update; existing offline checks were rerun.

## Open release checklist and owner decisions

| Item | Status | Required disposition before publication |
| --- | --- | --- |
| Stable identity and automated checks | PASS for recorded stable SHA | Documentation-only updates must pass current required PR CI; freeze final reviewed SHA |
| CachyOS isolated lifecycle and preservation | PASS | Evidence scope is disposable HOME; no destructive real-installation cycle claimed |
| macOS lifecycle/preservation/cleanup | PARTIAL | Basic lifecycle/original RC preservation owner-reported PASS; confirm fixture preservation and sandbox cleanup or explicitly disposition unresolved coverage |
| Source upgrade | PARTIAL | Native CachyOS isolated path PASS; macOS NOT_TESTED. Owner must supply native Mac evidence or explicitly decide whether Linux coverage suffices |
| Full per-platform setup checklist | PARTIAL | Offline fixtures PASS; actual discovery/manual, noninteractive, cancellation and preservation cases are not individually documented for both machines. Owner supplies evidence or explicit coverage decision |
| Stable-initiated SSH | NOT_TESTED | Owner must authorize any additional connection-specific test or explicitly accept RC evidence given the version-only CLI change; existing sessions do not imply this approval |
| Precise platform/build record | PARTIAL | Exact Mac stable SHA now owner-reported; actual macOS/Bash/dependency version details and final release acceptance record remain to be supplied |
| Final brand visual acceptance | NOT_TESTED | Explicit owner approval or documented deferral decision remains outstanding |
| Final SHA / merge / release authorization | NOT_TESTED | PR remains review-only; owner must separately authorize merge/publication and verify synchronized final main |

No pending item is marked WAIVED. The optional native Mac ShellCheck SKIP is not
a failed product test. AUTH_REQUIRED blocks the agent's unattended transport,
not normal owner-operated SSH; changing credentials is not a release requirement.
Historical slice facts remain unchanged. No private accounts, device names,
addresses, filesystem locations or raw tailnet diagnostics are included here.

### Post-v0.1.0 follow-up

Additional native lifecycle/refusal automation is a post-v0.1.0 improvement, not
a new release prerequisite. It does not close unverified preservation/cleanup
gates or replace explicit owner acceptance decisions under the [release policy](releases.md).

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

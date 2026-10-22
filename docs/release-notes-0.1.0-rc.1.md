# JACK 0.1.0-rc.1 — draft candidate notes

**Unpublished; validation pending.** This document is preparation, not a release
announcement. No release tag, date, downloadable package or immutable candidate
commit has been assigned by these notes. Record the exact merged commit when
freezing candidate validation; `jack --version` alone does not prove the build.

## Scope and changes

JACK provides terminal access to configured devices through existing Tailscale
and OpenSSH. Supported source installation targets are macOS (primary) and
Arch Linux / CachyOS; no Windows, universal Linux or remote-desktop support.

The source includes guided configuration, optional Tailscale peer discovery,
OS-advisory selection, read-only doctor, status, and consented user-level link
installers from earlier slices. Slice 14B adds deterministic `jack --version`,
uses that identity in doctor, and aligns the security policy with enabled GitHub
private reporting. It does not change SSH transport/flags, configuration syntax,
authentication, discovery or installation behavior.

## Installation, migration and dependencies

Use the [source-checkout guide](guide.md). Bash (including macOS system Bash 3.2),
an SSH client and connected Tailscale are connection prerequisites; Git obtains
the checkout. Python 3 is optional for discovery; manual setup remains available.
No new mandatory dependency, executable package or release installer is added.

Existing four-key configuration at `$HOME/.config/jack/config` is unchanged;
no new migration is needed for existing valid configurations. Users migrating
from the historical hardcoded defaults must explicitly configure their own
destinations as described in the [migration guide](guide.md#migrating-from-earlier-versions).
Never copy another user's identities or store credentials in configuration.

## Security and known limitations

Use [GitHub private reporting](../SECURITY.md) for suspected vulnerabilities;
keep sensitive details out of public issues. Tailscale and OpenSSH retain their
own authentication, authorization and host-key policies. Discovery/reachability
is not SSH authorization. See the policy for the full trust boundary.

The optional parser may be absent; manual setup remains available. Configuration
validates syntax, not tailnet membership. Source-linked installations change as
the checkout changes. Pre-1.0 compatibility and release gates follow the
[release policy](releases.md); no security audit or completed release acceptance
is claimed.

## Validation status

- Real macOS current-candidate install/doctor/setup/status acceptance: NOT_RUN.
- Real Arch/CachyOS current-candidate installation acceptance: NOT_RUN.
- Authorized real SSH in either direction: NOT_RUN for this candidate.
- Product Owner final brand visual acceptance: not established by these notes.
- Offline and CI outcomes belong to the candidate's verified PR/Actions evidence;
  this pre-merge draft does not predict them. Slice-specific local evidence is
  recorded in [14B history](../.ai/history/14B.md).

Do not treat earlier bootstrap/partial Mac discovery acceptance or Linux-hosted
platform simulations as current candidate runtime acceptance. Publication and
any exceptions require a separate Product Owner decision after validation.

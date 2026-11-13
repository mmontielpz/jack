# JACK 0.1.1-rc.1 — local release candidate notes

Unpublished local candidate on top of the stable `v0.1.0` tag (unchanged).
Not a stable release. Manual dogfood (gate G4) is **PENDING**; stable release
is **NOT APPROVED**.

## Changes since v0.1.0

- `--json` machine-readable output for `status`, `doctor` and `diagnose`.
- Governed repair: read-only by default, with post-repair verification.
- `status` distinguishes Tailscale reachability from SSH availability
  (`reachable; SSH available` / `reachable; SSH unavailable`; JSON `ssh`
  field: `available`, `unavailable`, `unknown`). Probe is a TCP connect to the
  SSH port (`JACK_SSH_PORT` overrides 22); the port is probed only when the
  peer is reachable. Unavailable SSH yields a non-zero exit/`DEGRADED`.
- RESTORE section in `docs/guide.md`.
- Version constant set to `0.1.1-rc.1`.

## Known limitations

- SSH availability is a port check; authentication is never tested.
- Running `jack` on the machine configured as WORKSTATION is a self-connection.
- Branches `integration/jack-v0.1.1-candidate` and `candidate/jack-v0.1.2-rc1`
  are not included; the latter conflicts with this line in `bin/jack`.
- Live macOS and cross-machine checks are pending owner dogfood; the Mac was
  unreachable during CachyOS qualification.

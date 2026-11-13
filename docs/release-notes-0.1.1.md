# JACK v0.1.1

Stable release following `v0.1.1-rc.2` (c28b4e9). Version-only changes since
the RC. `v0.1.0` and the RC history are unchanged.

## What's new since v0.1.0

- **Lifecycle CLI:** `jack setup`, `jack install`, `jack uninstall` with consent.
- **Read-only update planning:** `jack update` inspects local Git metadata and
  changes nothing.
- **Installer hardening:** protection against consent-window destination races.
- **Diagnostics:** `--json` output for `status`, `doctor` and `diagnose`.
- **Governed repair:** read-only by default, with post-repair verification.
- **SSH status:** `status` reports `reachable; SSH available` or
  `SSH unavailable` (TCP check of the SSH port; `JACK_SSH_PORT` overrides 22).
  The JSON `ssh` field is `available`, `unavailable` or `unknown`.
  Authentication is never tested.
- **Docs:** RESTORE section in `docs/guide.md`; CI also runs for `develop`.

## Qualification

- Linux offline suite (`scripts/dev-check.sh`), governed-repair tests,
  ShellCheck, and GitHub CI: PASS.
- Real bidirectional dogfood between CachyOS and macOS under `v0.1.1-rc.2`:
  command execution and exit codes 0, 1 and 7 verified in both directions;
  interactive sessions confirmed by the owner.

## Operational notes and limitations

- **sshd persistence:** JACK does not manage services. On Linux, ensure the SSH
  server starts at boot (for example `systemctl enable sshd`); a running but
  disabled `sshd` stops answering after a reboot, and `jack` will report
  `SSH unavailable`.
- **macOS non-interactive PATH:** Homebrew (`/opt/homebrew/bin`) is typically
  absent from the PATH of non-interactive SSH sessions, so `jack` may report
  "Tailscale is not installed". Use an interactive shell or add the directory
  to that session's PATH. JACK does not change your PATH.
- **Host keys:** if a machine's SSH host key changes, strict checking refuses
  the connection. Verify the new fingerprint independently before updating
  `known_hosts`.
- SSH availability is a port check; authentication is not tested.
- Running `jack` on the machine configured as WORKSTATION is a self-connection.
- `candidate/jack-v0.1.2-rc1` and `chore/15d11-release-preparation` are not part
  of this release.

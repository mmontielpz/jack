# JACK 0.1.1-rc.2 — release candidate notes

Unpublished candidate on `release/v0.1.1`, cut from `develop` (merge of PR #21,
3de44bc). The stable `v0.1.0` release and tag are unchanged. Manual dogfood
(gate G4) is **PENDING**; stable release is **NOT APPROVED**.

## Capabilities in this line (since v0.1.0)

- **Lifecycle CLI:** `jack setup`, `jack install`, `jack uninstall`, with
  consent prompts.
- **Read-only update planning:** `jack update` inspects local Git metadata only
  and performs no update.
- **Installer hardening:** consent-window destination race protection.
- **Diagnostics:** `--json` output for `status`, `doctor` and `diagnose`.
- **Governed repair:** read-only by default, with post-repair verification.
- **SSH status:** `status` reports `reachable; SSH available` or
  `SSH unavailable` (TCP check of the SSH port; `JACK_SSH_PORT` overrides 22);
  JSON `ssh` field is `available`, `unavailable` or `unknown`. Authentication
  is never tested.
- **Docs:** RESTORE section in `docs/guide.md`.
- **CI:** pull request checks also run for `develop`.

## Release line

`chore/15d11-release-preparation` (version `0.1.1`) is superseded by this
release line. That branch is neither modified nor deleted. The earlier local tag
`v0.1.1-rc.1` (a70910f) is historical.

## Qualification and limitations

- Offline qualification only: `scripts/dev-check.sh`, governed-repair tests and
  ShellCheck, plus live CachyOS CLI status.
- macOS and cross-machine E2E are **untested**.
- Running `jack` on the machine configured as WORKSTATION is a self-connection.
- `candidate/jack-v0.1.2-rc1` is not included (conflicts in `bin/jack`).

# Contributing to JACK

JACK is a minimal Bash CLI using Tailscale and SSH. Keep proposals focused on
that product; discuss changes to transport, dependencies or platform support
before implementing them.

## Validate a checkout

Contributor environments are macOS (including system Bash 3.2) and Linux.
Supported product installation targets are macOS and Arch Linux / CachyOS;
running offline checks elsewhere does not establish platform support.
Bash and Git are required. ShellCheck and GitHub CLI are optional. An available
Python 3 interpreter exercises optional discovery parsing; without it the checks
test fallback behavior, so report that limitation.

```bash
git clone https://github.com/mmontielpz/jack
cd jack
./scripts/dev-check.sh
```

The check exits non-zero on failure. It uses temporary HOME directories, command
stubs and fixtures: no live tailnet, real SSH, package installation or system
configuration changes. ShellCheck findings are reported but non-blocking.
Do not run installers against your real HOME to validate a change; installation
is documented in the [user guide](docs/guide.md).

## Bugs and proposals

Use the bug template for platform, reproduction steps, expected/actual behavior,
and sanitized output. Use the feature template to explain the user problem and
proposed outcome. Search existing issues first. Never attach secrets or full
unredacted Tailscale diagnostics. Suspected vulnerabilities follow
[SECURITY.md](SECURITY.md) through GitHub private vulnerability reporting;
do not describe them in public issues.

## Pull requests

1. Branch from clean, updated `main` using `feat/`, `fix/`, `docs/` or `chore/`.
2. Keep changes focused; update relevant docs and run `./scripts/dev-check.sh`.
3. Open a PR to `main` with a conventional-commit title and test evidence,
   security implications, and actual platform validation.
4. Required CI job `checks` runs the same script on Ubuntu and must pass.
   PRs are squash-merged; never bypass CI or protection.

Offline tests include simulated platforms, not real macOS execution or SSH E2E.
For platform-sensitive changes, macOS acceptance requires running the checks on
a Mac and manually checking affected behavior. Label untested platforms and live
SSH explicitly; do not infer them from Ubuntu CI. The [release checklist](docs/releases.md)
describes broader acceptance before a future release.

Maintainers and engineering agents use [.ai/WORKFLOW.md](.ai/WORKFLOW.md) for
execution authority, delivery, cleanup and slice evidence. It is the canonical
internal engineering contract, not an additional end-user installation procedure.

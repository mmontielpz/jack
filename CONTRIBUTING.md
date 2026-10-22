# Contributing to jack

`jack` is a minimal, open-source Bash utility for reaching your machines over Tailscale + SSH. Product scope is set by the maintainer; see [.ai/WORKFLOW.md](.ai/WORKFLOW.md) for the full engineering workflow.

## Contributor bootstrap (validate source)

Contributor environments: macOS (system Bash 3.2 is supported) and Linux. Windows is not supported.

- Required: Bash, Git.
- Optional: `gh` (pull requests), `shellcheck` (reported, non-blocking).

```bash
git clone https://github.com/mmontielpz/jack
cd jack
./scripts/dev-check.sh
```

`dev-check.sh` is read-only and offline. It uses stubs, so it needs no Tailscale, SSH, sudo, or Homebrew and changes nothing on your machine. It exits non-zero if any check fails.

**Do not run `setup-macos.sh` or `setup-workstation.sh` to validate code.** Those manage the end-user CLI symlink and require consent. `dev-check.sh` tests them only with isolated temporary HOME directories and command stubs. Installation and Tailscale setup are described in the [README](README.md).

## Making a change

1. Branch from a clean, up-to-date `main` (`feat/…`, `fix/…`, `docs/…`, `chore/…`).
2. Run `./scripts/dev-check.sh`.
3. Open a pull request to `main` with a conventional-commit title (it becomes the squash commit).
4. The required CI check `checks` runs the same `dev-check.sh` on Ubuntu; it must pass. PRs are squash-merged. Do not bypass CI.

CI does not run on macOS, so macOS behavior is verified by contributors locally.

## Security

Never commit credentials, tokens, or private keys. Do not weaken SSH host verification or expose services publicly. Report vulnerabilities privately to the maintainer rather than in a public issue.

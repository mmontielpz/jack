# JACK engineering workflow

Canonical, lightweight workflow for humans and AI agents working on JACK. Contributor setup: [CONTRIBUTING.md](../CONTRIBUTING.md). Slice records: [history/](history/).

## 1. Product identity

- JACK is an open-source remote-access tool. Simplicity first.
- Audience: technical and nontechnical users.
- Long-term goals: terminal and graphical access, cross-platform.
- **Today** JACK is a minimal Bash + Tailscale + SSH utility (`bin/jack`, `scripts/`), with guided setup and optional Tailscale peer discovery. Graphical access and Windows are roadmap, not implemented. Docs and reports must never present roadmap as current behavior.

## 2. Authority

- Product approves scope, priorities, UX, and acceptance.
- Engineering implements approved slices, owns verification, Git, PRs, and CI.
- No autonomous roadmap expansion. A recommendation is not authorization.
- No architecture changes (transport, language, new runtime dependencies) without approval.

## 2A. Autonomous Execution Policy

An approved slice authorizes routine end-to-end execution within its scope, acceptance criteria, and security boundaries. The Product Owner retains those decisions; the agent owns routine implementation, testing, documentation, and authorized delivery. This policy applies equally to Claude Code, Codex, and other engineering agents; all existing workflow rules still apply.

### A. AUTONOMOUS — no Product Owner confirmation

- Read files and inspect repository history; make reversible implementation choices within approved scope.
- Create feature branches and edit authorized repository files.
- Run offline checks, fix ordinary test failures, and update documentation and slice history.
- Commit and push the approved slice; create its PR, monitor required CI, and resolve routine failures on the same branch.
- Enable auto-merge and squash-merge after required checks PASS, only when explicitly authorized by the approved slice and permitted by repository policy. Never use admin privileges to bypass gates.
- Clean up merged feature branches using the verification and branch-tip checks in section 4.

### B. ASK OR STOP — Product Owner decision required

- Material changes to scope, architecture, or acceptance criteria; unresolved ambiguity that materially changes product behavior.
- Authentication, permissions, credentials, or security-posture changes outside the approved slice.
- Destructive operations or risk of losing existing user work; unexpected infrastructure changes or production actions.
- Irreversible actions not explicitly authorized; required CI or authorization gates that cannot be satisfied.

### C. NEVER

- Bypass required CI, branch protection, or security controls; disable security mechanisms to avoid approval prompts.
- Expose secrets or private credentials; claim PASS without verification.
- Force-push protected branches; delete unmerged work; silently expand scope.

Prefer safe defaults and reversible decisions. Do not interrupt for implementation details already delegated. Fix routine failures independently within reasonable bounds; ask one focused question only when genuinely blocked on a Product Owner decision. Report PARTIAL with evidence rather than guessing; retain the existing failure, stopping, and completion rules.

Codex permission prompts are controlled by its own sandbox and approval settings, not this repository workflow. Repository authorization does not override those controls. Do not edit global user settings (including `~/.codex/config.toml`), recommend unrestricted access, or bypass approvals to implement this policy.

## 3. Slice contract

Each slice has: one focused goal; explicit scope and exclusions; acceptance criteria; required verification evidence; stopping conditions. Pass only when the active slice's acceptance is demonstrated. Work outside scope is reported as a follow-up, not done. Stop after the final report; do not start the next slice.

## 4. GitHub flow

1. Preflight: correct repo, `main` fetched and fast-forwarded, working tree clean.
2. Short-lived branch from `main` (`feat/…`, `fix/…`, `docs/…`, `chore/…`, `ci/…`). Never commit to `main`.
3. Run `./scripts/dev-check.sh` (section 6).
4. Conventional commit; push; open PR to `main`. The PR title becomes the squash commit title.
5. Required check `checks` (which runs `dev-check.sh`) must pass. CI runs on pull requests only.
6. Enable squash auto-merge. The repo allows squash only and deletes the remote branch on merge.
7. Cleanup after merge:
   - Verify the PR state is `MERGED` and CI passed.
   - `git fetch`, fast-forward local `main`, confirm it equals `origin/main`.
   - Squash merges rewrite history, so `git branch -d` will refuse. Do not use `-D` blindly, and do not infer safety from an empty `git diff` alone: the branch may hold commits that never reached the PR.
   - Check `git log main..<branch>` and compare the PR's final head SHA (`gh pr view --json headRefOid`) with the branch tip. Delete (`-D`) only if the tip equals the merged PR head, or the maintainer authorizes it.
   - Confirm a clean tree.

## 5. Security boundaries

- No credentials, tokens, or private keys in source, history records, or logs.
- Do not weaken SSH host verification.
- No unnecessary public network exposure; JACK stays reachable only over Tailscale unless approved.
- No firewall, sshd, or system configuration changes outside slice scope.
- Authentication and authorization stay explicit; no silent trust or auto-accept.
- Never claim security verification without evidence.

## 6. Validation

- Canonical local check: `./scripts/dev-check.sh`. It is read-only, offline, deterministic, and runs on macOS (Bash 3.2) and Linux with no Tailscale, SSH, sudo, or Homebrew. It is also what CI runs.
- Never run `scripts/setup-*.sh` to validate code (they install software, use sudo, edit shell files). Never run a live `jack --status`, `jack`, or `jack mac` as a required check: they touch the real tailnet and results depend on the machine.
- Do not validate with `bash -n a b c`: Bash checks only the first file.
- Keep checks deterministic; preserve backwards compatibility of commands and install/uninstall behavior.
- Boundaries: CI is Ubuntu only. macOS behavior is verified by running `dev-check.sh` on a Mac and must be reported as such; do not claim macOS PASS without that run. Live end-to-end (real SSH over Tailscale) is separate from static checks; without it, state "no E2E". Report blocked and unverified items as such.

## 7. Failure and recovery

- Unexpected dirty tree, HEAD, or branch: stop and report; never reset, clean, or discard work.
- Failed CI: fix on the same branch with a new commit, push, and wait for the check again. Keep the failing run ID as evidence.
- Interrupted PR flow: inspect `git status`, the branch, and `gh pr view` before acting; resume from the first incomplete step.
- Never force-push `main`. Never bypass required CI or branch protection (admins included; branch protection does not enforce this for admins, so it is a rule).
- Revert a bad squash merge through a new branch and PR (`git revert <squash-sha>`), not a direct push to `main`.
- Avoid destructive cleanup; preserve evidence. If rules block completion, report BLOCKED.

## 8. Evidence and history

- Each slice gets a concise record `.ai/history/<slice>.md`, written before merge with only what exists then: mission, baseline SHA, scope, files changed, local validation, known risks.
- Post-merge facts (PR, CI run, merge SHA, final HEAD) live in the GitHub PR, the Actions run, and the final report. Do not predict them in the file, and do not open a documentation-only PR just to back-fill them.
- The next slice records the previous merge SHA as its baseline.
- Use exact SHAs. Never fabricate verification.

## 9. Token efficiency

Read only relevant files; avoid repeated repo-wide scans; reuse prior evidence; keep reports concise; no unnecessary frameworks or abstractions.

## 10. Completion contract

A slice is complete only when: implementation done; local validation done; CI green; PR merged; local `main` synchronized and equal to `origin/main`; working tree clean; final evidence reported.

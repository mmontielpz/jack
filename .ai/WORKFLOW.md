# JACK engineering workflow

Canonical, lightweight workflow for humans and AI agents working on JACK. Slice records live in [history/](history/).

## 1. Product identity

- JACK is an open-source remote-access tool. Simplicity first.
- Audience: technical and nontechnical users.
- Long-term goals: terminal and graphical access, cross-platform.
- **Today** JACK is a minimal Bash + Tailscale + SSH utility (`bin/jack`, `scripts/`). Graphical access, Windows, and device discovery are roadmap, not implemented. Docs and reports must never present roadmap as current behavior.

## 2. Authority

- Product approves scope, priorities, UX, and acceptance.
- Engineering implements approved slices, owns verification, Git, PRs, and CI.
- No autonomous roadmap expansion. A recommendation is not authorization.
- No architecture changes (transport, language, new runtime dependencies) without approval.

## 3. Slice contract

Each slice has: one focused goal; explicit scope and exclusions; acceptance criteria; required verification evidence; stopping conditions. Pass only when the active slice's acceptance is demonstrated. Work outside scope is reported as a follow-up, not done. Stop after the final report; do not start the next slice.

## 4. GitHub flow

1. Preflight: correct repo, `main` fetched and fast-forwarded, working tree clean.
2. Short-lived branch from `main` (`feat/…`, `fix/…`, `docs/…`, `ci/…`). Never commit to `main`.
3. Run local checks (section 6).
4. Conventional commit; push; open PR to `main`.
5. Required check `checks` must pass (CI runs on pull requests).
6. Enable squash auto-merge. The repo allows squash only and deletes the branch on merge.
7. Verify the PR merged; fast-forward local `main`; delete the merged local branch (`git branch -d`); confirm clean tree.

## 5. Security boundaries

- No credentials, tokens, or private keys in source, history records, or logs.
- Do not weaken SSH host verification.
- No unnecessary public network exposure; JACK stays reachable only over Tailscale unless approved.
- No firewall, sshd, or system configuration changes outside slice scope.
- Authentication and authorization stay explicit; no silent trust or auto-accept.
- Never claim security verification without evidence.

## 6. Validation

- Test before commit. Keep checks deterministic and non-mutating (no live SSH, no running setup scripts).
- Baseline checks (mirror CI): `bash -n bin/jack scripts/*.sh`; executable bits; `./bin/jack --help`; `./bin/jack --status` and `./bin/jack bogus` exit non-zero; `shellcheck` when available.
- Preserve backwards compatibility of commands and install/uninstall behavior.
- Report static checks and live end-to-end checks separately. Without a real E2E run, state "no E2E". Report blocked and unverified items as such.

## 7. Failure and recovery

- Stop on unexpected dirty trees or unexpected HEAD.
- Never force-push `main`; never bypass required CI or branch protection.
- No destructive cleanup (`reset --hard`, `clean`, branch deletion of unmerged work) without approval.
- Preserve evidence (logs, failing run IDs).
- Fix forward with a follow-up PR or an approved revert PR. If rules block completion, report BLOCKED.

## 8. Evidence and history

- Each slice gets a concise record `.ai/history/<slice>.md`: mission, baseline SHA, scope, files changed, validation, PR/CI outcome, final HEAD, remaining risks.
- Use exact SHAs. Fill only values that exist; mark others `not recorded`. Never fabricate or predict verification.

## 9. Token efficiency

Read only relevant files; avoid repeated repo-wide scans; reuse prior evidence; keep reports concise; no unnecessary frameworks or abstractions.

## 10. Completion contract

A slice is complete only when: implementation done; local validation done; CI green; PR merged; local `main` synchronized; working tree clean; final evidence reported.

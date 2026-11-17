# JACK Release-Readiness Campaign (`JACK-RELEASE-READINESS-CAMPAIGN-009`)

## 1. Repository, Branch, PR & Worktree Audit (`009A`)

### 1.1 Protected Baselines & Tags
| Ref | Commit | Status |
|---|---|---|
| `tag: v0.1.0` | `e2d16a21c810e9addcc65c2b5412795aa1d44422` | Published stable release (preserved) |
| `tag: v0.1.1-rc.2` | `c28b4e9` | Published pre-release (preserved) |
| `tag: v0.1.1` | `960b295` (`release/v0.1.1`: `600bf2d`) | Published latest stable CLI release (preserved) |
| `origin/main` | `eccdc25` | Active main branch (`v0.2.0` CLI device registry PRs `#23`–`#28` merged) |
| `origin/develop` | `702101f` | Active integration branch (merges `origin/main` + PRs `#29`–`#31`) |

### 1.2 Stacked PR Ancestry (`#32`–`#44`)
Every branch in the Easy Pairing / JACK Desktop stack is a strict linear ancestor of `f81e71a5cae0f60f9cb7489f5cee8d394d950c57` (`git merge-base --is-ancestor <branch> f81e71a` verified `0` for all 14 branches):

```text
origin/main (eccdc25)
 └─► origin/develop (702101f) [PRs #29, #30, #31 merged]
      ├─► feat/jack-desktop-v01 (a812ff8) [PR #32] ──────────────┐
      └─► docs/easy-pairing-ep-001 (789e362) [PR #33]            │
           └─► feat/easy-pairing-ep-002 (50579bb) [PR #34]       │
                └─► feat/easy-pairing-ep-003 (de5050f) [PR #35]  │
                     └─► feat/easy-pairing-ep-004 (c5a4d0e) ◄────┘ [PR #36, merge 877d030]
                          └─► feat/easy-pairing-ep-004h-fix-001 (302ada3) [PR #37]
                               └─► feat/easy-pairing-ep-005 (8f3b74e) [PR #38]
                                    └─► feat/easy-pairing-ep-005-win-stab (846f226) [PR #39]
                                         └─► fix/ep-005-lab-qual-005 (96a6f45) [PR #40]
                                              └─► feat/ep-005-automated-dogfood-006 (97c0f75) [PR #41]
                                                   └─► feat/ep-005-macos-installer-007a (71a4bd1) [PR #42]
                                                        └─► fix/ep-005-macos-dmg-007b (ab43205) [PR #43]
                                                             └─► fix/ep-005-macos-ux-008 (f81e71a) [PR #44]
                                                                  └─► candidate/jack-v0.2.0-rc1-009 [This Campaign]
```

### 1.3 Safe Cleanup Proposal (Requires Explicit Owner Approval — Nothing Deleted Automatically)
1. **Already Merged into `origin/main` or `origin/develop` (Safe to delete remote/local branches & worktrees after owner approval)**:
   - `ci/push-main-develop` (`dc71280`, merged in PR `#29`)
   - `feat/j07-s1-linux-compat` (`529ef1b`, merged in PR `#30`)
   - `feat/j08-s1-oss-readiness` (`3eaf8f2`, merged in PR `#31`)
   - `experiment/jack-v02-add-device` (`ba99396`), `experiment/jack-v02-j02-s1` (`3dfed58`), `experiment/jack-v02-j02-s2` (`cc7fddc`), `experiment/jack-v02-j02-s3` (`0a25c3f`), `experiment/jack-v02-j04-s1` (`0894a9a`), `experiment/jack-v02-j05-s1` (`b91f09c`) (all merged in PRs `#23`–`#28`)
   - `feat/15b-safe-lifecycle-cli`, `feat/15c-readonly-update-planning`, `fix/15e-installer-consent-race` (merged in `v0.1.1`)
2. **Stale Local-Only Automation Branches (`t-exec/*`, `task-jack-*`, `dogfood-072-p002`, `/tmp/audit-jack`)**:
   - 44 local-only `t-exec/*` branches and `git worktree prune` for `/tmp/audit-jack` (safe to prune after owner review).
3. **Stacked Draft PR Chain (`#32`–`#44`)**:
   - **Keep open as historical evidence** until the consolidated `candidate/jack-v0.2.0-rc1-009` PR is reviewed and merged into `develop`, then close superseded intermediate Draft PRs `#32`–`#44` with a link to the consolidated commit.

---

## 2. Consolidation & Technical Debt Triage (`009B`)

### 2.1 Consolidation Summary
- Created isolated worktree `/home/mike/repos/jack-worktrees/candidate-jack-v0.2.0-rc1-009` on branch `candidate/jack-v0.2.0-rc1-009` from `f81e71a5cae0f60f9cb7489f5cee8d394d950c57`.
- Verified zero conflicting fixes across `bin/jack`, `easy-pairing/`, `desktop/`, and `scripts/dogfood/`.
- Resolved `.gitignore` hygiene (`P2`: added `__pycache__/`, `*.py[cod]`, `dist-artifacts/`).

### 2.2 Technical Debt Inventory (`P0`–`P3`)

| ID | Priority | Component | Description | Status / Disposition |
|---|---|---|---|---|
| `TD-001` | **P0** | Security / Easy Pairing | Any bypass of SPAKE2, TLS 1.3 exporter binding, 6-digit SAS, Host approval, or `status.read`-only scope | **0 open (PASS)** — Enforced by 12 Rust + 12 Vitest + 13 Python tests |
| `TD-002` | **P1** | macOS Packaging | Bare `linker-signed` Mach-O binary without `_CodeSignature/CodeResources` caused Gatekeeper "damaged" dialog (`007B`) | **Resolved (`ab43205`)** — `codesign --force --deep --sign -` + `--verify --deep --strict` enforced in CI |
| `TD-003` | **P1** | Desktop UX | Host `Approve` flashed back to Step 1 (`Share This Device`) when TLS completion exceeded 30ms; Host `Peer Authorized` lacked explicit status details (`008`) | **Resolved (`f81e71a`)** — 500ms poll + Step 2 `Authorizing Device...` + `Authorized` sidebar & `role="status"` card |
| `TD-004` | **P2** | Keystore (`macOS` / `Linux`) | `platform_keystore()` uses `WindowsDpapiKeystore` on Windows and `InMemoryTestKeystore` (ephemeral per-session RAM identity) on non-Windows (`easy-pairing/src/identity.rs:286`) | **Documented for V0.2 Experimental RC** — Safe (no plaintext disk keys, no unsigned Keychain ACL prompts); persistent `libsecret` / Keychain scheduled for V0.3 |
| `TD-005` | **P2** | macOS Signing & Notarization | macOS `.dmg` is ad-hoc bundle-signed (`flags=0x2(adhoc)`), not Apple Developer ID signed or notarized | **Documented for V0.2 Experimental RC** — Requires `System Settings -> Privacy & Security -> Open Anyway` on first launch; Developer ID + notarization scheduled for V0.3 |
| `TD-006` | **P2** | Cross-OS Native E2E Gaps | `Linux Host -> macOS Client` (requires temporary LAN `ufw` rule on `enp39s0`), live macOS negative UI clicks over SSH (blocked by TCC `-1728`), and physical Windows 11 hardware (qualified in KVM VM `jack-win11-dogfood`) | **Tracked Honestly (`PARTIAL`)** — Covered by automated Rust/Vitest tests + VM dogfood; never claimed as physical PASS without execution |
| `TD-007` | **P2** | Dogfood Net Helper Setup | `jack-dogfood-net-helper` requires optional one-time owner `sudoers` installation for passwordless `virbr0` rule (`docs/JACK-VM-GRANT-001.md`) | **By Design (`G1`)** — Agent never auto-edits `/etc/sudoers.d` |
| `TD-008` | **P3** | GitHub Actions Node 20 Warning | Upstream `actions/checkout@v4`, `actions/setup-node@v4`, `actions/upload-artifact@v4` emit Node 20->24 deprecation notices on runners | **Non-blocking** — Actions run on Node 24 automatically; upgrade to `@v5` when upstream releases |
| `TD-009` | **P3** | Repo Hygiene | Python `__pycache__/` and `*.pyc` were untracked in dogfood worktrees | **Resolved in `009B`** — Added to `.gitignore` |

---

## 3. CI Consolidation & Optimization (`009D`)

### 3.1 Workflow Architecture
1. **`.github/workflows/ci.yml` (Fast PR & Push Gate)**:
   - Explicit matrix across **`ubuntu-24.04`** and **`ubuntu-26.04`** (replacing ambiguous `ubuntu-latest`), running `./scripts/dev-check.sh`, `JACK-VM-GRANT-001` & dogfood unit tests (`13/13`), and isolated Ubuntu CLI smoke tests.
   - Dedicated `rust-and-frontend-checks` job on `ubuntu-24.04` with `Swatinem/rust-cache@v2` and npm caching (`cargo fmt --check`, `cargo clippy`, `cargo test`, `npm run lint`, `npm run build`, `vitest`).
2. **`.github/workflows/macos-preview.yml` (macOS ARM64 Default + Optional Intel)**:
   - Removed `x86_64-apple-darwin` from the default PR matrix (saving ~8m of macOS runner quota per PR) while preserving it via `workflow_dispatch` input `include_x64: true`.
   - Added `Swatinem/rust-cache@v2` for `desktop/src-tauri` and `easy-pairing`.
3. **`.github/workflows/ep005-crossplatform-preview.yml` (Unified Cross-Platform RC Builder)**:
   - `linux-preview` builds `.AppImage` and `.deb` on explicit **`ubuntu-24.04`** (glibc 2.39 for compatibility across both Ubuntu 24.04 and 26.04) with `Swatinem/rust-cache@v2`.
   - `ubuntu-26-04-verify` downloads the `ubuntu-24.04`-built artifacts onto explicit **`ubuntu-26.04`**, verifies SHA-256 checksums, inspects `.deb`/`.AppImage` metadata, and runs an isolated `xvfb-run` startup smoke test on Ubuntu 26.04.
   - `windows-preview` builds the Windows 11 NSIS installer on `windows-latest` with `Swatinem/rust-cache@v2` and runs isolated NSIS install/cold/warm/uninstall smoke tests.

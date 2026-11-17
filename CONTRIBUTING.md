# Contributing to JACK

Thank you for contributing to **JACK**! Please review our [Code of Conduct](CODE_OF_CONDUCT.md) and [Security Policy](SECURITY.md) before opening issues or pull requests.

JACK consists of two complementary layers:
1. **JACK CLI (`bin/jack`)**: A zero-daemon Bash CLI for device registration, diagnostics, and SSH/Tailscale connectivity.
2. **JACK Desktop & Easy Pairing (`desktop/` + `easy-pairing/`)**: An experimental Tauri 2 + React + Rust desktop application providing Auth Code-first local/LAN pairing (`status.read` scope only) alongside a guided Manual SSH setup wizard.

Keep proposals focused on these layers; discuss changes to cryptographic protocols, transport boundaries, dependencies, or platform support before implementing them.

---

## 1. Prerequisites by Subsystem

### A. JACK CLI & Dogfood Unit Tests (`bin/jack`, `scripts/`)
- **Required**: `bash`, `git`, `python3` (used by optional discovery parsing and `scripts/dogfood/test_*.py` unit tests)
- **Optional**: `shellcheck` (reported by `./scripts/dev-check.sh`), `gh` (GitHub CLI)

### B. Easy Pairing Rust Crate & JACK Desktop (`easy-pairing/`, `desktop/`)
- **Rust**: Stable toolchain (`rustc`, `cargo`, `rustfmt`, `clippy`)
- **Node.js**: Node.js 20+ (Node 22 LTS recommended) and `npm`
- **OS System Libraries for Tauri 2**:
  - **Ubuntu 24.04 / 26.04**: `sudo apt-get install -y libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev`
  - **Arch Linux / CachyOS**: `sudo pacman -S --needed webkit2gtk-4.1 base-devel curl wget file openssl appmenu-gtk-module libappindicator-gtk3 librsvg`
  - **macOS (Apple Silicon `arm64`)**: Xcode Command Line Tools (`xcode-select --install`)
  - **Windows 11 (`x86_64`)**: Microsoft Visual C++ Build Tools and WebView2 Runtime

---

## 2. Validating a Checkout Offline

All automated test suites use isolated temporary directories (`/tmp`), command stubs, and `127.0.0.1` loopback sockets. They never touch your real `$HOME/.config/jack/config`, `~/.ssh/known_hosts`, live tailnet, or host firewall.

```bash
# 1. CLI & installer offline contract suite (30 test sections)
./scripts/dev-check.sh

# 2. JACK-VM-GRANT-001 & dogfood harness unit tests (13 tests)
python3 -m unittest discover -s scripts/dogfood -p "test_*.py" -v

# 3. Easy Pairing Rust cryptographic & protocol suite (12 tests)
cargo fmt --manifest-path easy-pairing/Cargo.toml -- --check
cargo clippy --manifest-path easy-pairing/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path easy-pairing/Cargo.toml

# 4. JACK Desktop Tauri Rust backend suite (7 tests)
cargo fmt --manifest-path desktop/src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path desktop/src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path desktop/src-tauri/Cargo.toml

# 5. JACK Desktop React/TypeScript frontend lint, build & Vitest suite (12 tests)
npm --prefix desktop ci
npm --prefix desktop run lint
npm --prefix desktop run build
npm --prefix desktop test -- --run
```

> **Safety Rule**: Never run installers (`./scripts/setup-*.sh`) or unverified destructive commands against your real `$HOME` to test a change. User installation is documented in the [User Guide](docs/guide.md) and [Desktop Guide](desktop/README.md).

---

## 3. Reporting Bugs and Proposals

- Use the **Bug Report** template for reproducible defects and the **Feature Request** template for user problems and proposed outcomes.
- **Never attach sensitive data**: Do not paste passwords, private SSH keys, `JACK-VM-GRANT-001` tokens, live 8-character Auth Codes, 6-digit SAS codes from active sessions, or unredacted `tailscale status` output.
- **Vulnerability Disclosure**: Suspected security vulnerabilities must be reported privately through [GitHub Private Vulnerability Reporting](https://github.com/mmontielpz/jack/security/advisories/new) per [SECURITY.md](SECURITY.md) — never in public issues or pull requests.

---

## 4. Pull Request Workflow & Evidence Standards

1. Branch from a clean, updated `develop` checkout using `feat/`, `fix/`, `docs/`, or `chore/`.
2. Keep changes scoped; update relevant documentation and run the validation commands in Section 2 for all touched subsystems.
3. Open a Pull Request targeting `develop` with a conventional-commit title and complete test evidence.
4. **Required CI Gate**: The `CI / checks` aggregator job must pass (enforcing `./scripts/dev-check.sh`, `JACK-VM-GRANT-001` unit tests, and isolated Ubuntu CLI smoke across both `ubuntu-24.04` and `ubuntu-26.04`).
5. **Truthful Platform & E2E Reporting**:
   - Explicitly distinguish **offline unit/stub checks**, **CI headless smoke (`xvfb-run` / NSIS smoke)**, **local KVM VM E2E**, and **physical hardware E2E**.
   - Mark any platform or cross-machine path you did not exercise as `NOT_TESTED` — never infer native macOS, Windows, or SSH E2E success from Linux simulations.
   - See the [Release and Version Policy](docs/releases.md) and [Engineering Case Study](docs/ENGINEERING-CASE-STUDY.md) for qualification gates.

Maintainers and engineering agents also use [`.ai/WORKFLOW.md`](.ai/WORKFLOW.md) as the internal engineering execution contract.

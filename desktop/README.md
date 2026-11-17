# JACK Desktop (`v0.2.0-rc.1` Experimental Preview — Bundle `0.1.0`)

Native desktop application for **JACK** built with **Tauri 2 + React 18 + TypeScript + Rust**, providing:
1. **Auth Code-First Easy Pairing (`easy-pairing/` + `desktop/src-tauri/src/easy_pairing_ipc.rs`)**: Pair two local or LAN devices using an 8-character Crockford Base32 code (`XXXX-XXXX`), SPAKE2, TLS 1.3 (`RFC 9266` exporter channel binding), 6-digit SAS verification, explicit Host human approval (`Approve`/`Deny`), and instant revocation (`status.read` scope only, session-only duration).
2. **Guided Manual SSH & Tailscale Setup (`desktop/src-tauri/src/lib.rs`)**: 4-stage onboarding wizard, preflight diagnostics, and device dashboard connected to `bin/jack` through typed IPC commands with strict `argv` validation.

---

## 1. Build Prerequisites

- **Node.js**: Node.js 20+ (Node 22 LTS recommended) and `npm`
- **Rust**: Stable toolchain (`rustc`, `cargo`, `rustfmt`, `clippy`)
- **Platform Libraries**:
  - **Ubuntu 24.04 / 26.04**: `sudo apt-get install -y libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev`
  - **Arch Linux / CachyOS**: `sudo pacman -S --needed webkit2gtk-4.1 base-devel curl wget file openssl appmenu-gtk-module libappindicator-gtk3 librsvg`
  - **macOS (`arm64` Apple Silicon)**: Xcode Command Line Tools (`xcode-select --install`)
  - **Windows 11 (`x86_64`)**: Microsoft Visual C++ Build Tools + WebView2 Runtime

---

## 2. Development & Automated Tests

From the repository root:

```bash
# 1. Easy Pairing Rust crate tests (12 unit, integration, and negative tests)
cargo test --manifest-path easy-pairing/Cargo.toml

# 2. Tauri Rust backend & IPC tests (7 tests)
cargo test --manifest-path desktop/src-tauri/Cargo.toml

# 3. Frontend lint, production bundle build, and Vitest UI state-machine tests (12 tests)
npm --prefix desktop ci
npm --prefix desktop run lint
npm --prefix desktop run build
npm --prefix desktop test -- --run
```

---

## 3. Native Packaging by Platform

```bash
cd desktop
npx tauri build
```

- **Linux (`x86_64`)**: Produces `desktop/src-tauri/target/release/bundle/appimage/JACK Desktop_0.1.0_amd64.AppImage` and `bundle/deb/JACK Desktop_0.1.0_amd64.deb`.
- **macOS (`arm64` Apple Silicon)**: Produces `JACK Desktop.app`. For local or preview DMG distribution on macOS Sequoia, apply bundle-level ad-hoc signing (`codesign --force --deep --sign - "JACK Desktop.app"`) and verify with `codesign --verify --deep --strict --verbose=2` ([`ADR-010`](../docs/product/easy-pairing/ADR.md)).
- **Windows 11 (`x86_64`)**: Produces `desktop/src-tauri/target/release/bundle/nsis/JACK Desktop_0.1.0_x64-setup.exe`.

---

## 4. Security, Keystore & Data Retention

- **Zero Shell Interpolation**: All CLI invocations pass discrete `argv` elements; `-` prefixes and shell metacharacters are rejected.
- **Strict Network Binding**: Easy Pairing binds to `127.0.0.1` by default; `Listen Network` permits only RFC1918 private LAN, virtual bridge, link-local, or CGNAT (`100.64.0.0/10`) addresses and rejects `0.0.0.0` and public IPs.
- **Keystore Behavior (`TD-004`)**: Windows uses per-user DPAPI (`CryptProtectData` in `%LOCALAPPDATA%\jack\easy-pairing\keystore`). Linux and macOS V0.2 preview builds hold device identities in memory for the active session (`InMemoryTestKeystore`) and never write plaintext private keys to disk.
- **Reset JACK Configuration (in Settings)**: Creates a `0600` timestamped backup (`config.bak.<ts>`) and removes only `$HOME/.config/jack/config` (and an empty `.setup-lock` if present), preserving `~/.ssh`, `known_hosts`, and Tailscale state.

---

## 5. Uninstalling JACK Desktop

Uninstalling the desktop application preserves your JACK CLI symlink, `$HOME/.config/jack/config`, backups, `~/.ssh/known_hosts`, and Tailscale state:

- **Linux (`.AppImage` / `.deb`)**: Delete the `.AppImage` file or run `sudo apt remove jack-desktop`.
- **macOS (`arm64` `.dmg`)**: Remove `/Applications/JACK Desktop.app`.
- **Windows 11 (NSIS `.exe`)**: Run `%LOCALAPPDATA%\JACK Desktop\uninstall.exe` or uninstall via **Windows Settings → Installed Apps**.
- **Optional Manual Data Cleanup**: Only if you want to remove Easy Pairing trust records or CLI config manually, delete `$HOME/.config/jack/` (or `%LOCALAPPDATA%\jack\`). Never delete `~/.ssh/` or `~/.ssh/known_hosts` unless you manage those separately.

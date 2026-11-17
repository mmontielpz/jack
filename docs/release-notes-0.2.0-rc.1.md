# JACK v0.2.0-rc.1 — Experimental Release Candidate Notes (Draft)

> **Status**: `EXPERIMENTAL_RC` (`RC_PUBLICATION=NOT_AUTHORIZED` — Draft candidate prepared for owner review; do **not** tag or publish as a stable release without explicit owner authorization).

## 1. Candidate Identity & Scope

- **Candidate Branch**: `candidate/jack-v0.2.0-rc1-009`
- **Reference Baseline**: `f81e71a5cae0f60f9cb7489f5cee8d394d950c57` (consolidating `origin/main` `eccdc25`, `origin/develop` `702101f`, and stacked PRs `#32`–`#44`)
- **CLI Authoritative Constant**: `bin/jack` (`JACK_VERSION='0.1.1'`, preserved for existing CLI contract tests until owner authorizes final version constant bump)
- **Desktop & Easy Pairing Crate Version**: `0.1.0` (Experimental Preview)

### Key Capabilities Included
1. **Device-Centric CLI (`bin/jack`)**:
   - Multi-device registry (`jack add <alias>`, `jack devices`, `jack default <alias>`, `jack connect <alias>`, `jack status [alias]`).
   - Machine-readable JSON diagnostics (`jack status --json`, `jack doctor --json`, `jack diagnose --json`).
   - Governed read-only update planning and consent-window race protection.
   - Arch/CachyOS, Ubuntu 24.04 LTS (including WSL2), and macOS CLI support.
2. **JACK Desktop & Easy Pairing (`desktop/` + `easy-pairing/`, Experimental Preview)**:
   - Auth Code-first Home (`XXXX-XXXX` 8-char Crockford Base32, 300s TTL) with **Advanced: Manual SSH** fallback preserved.
   - Cryptographic pairing over local loopback (`127.0.0.1`), RFC1918 LAN, virtual bridges (`virbr0`), or CGNAT (`100.64.0.0/10`) using SPAKE2 + TLS 1.3 (`RFC 9266` exporter channel binding) + 6-digit SAS comparison.
   - Explicit Host human approval (`Approve` / `Deny`), `Authorizing Device...` -> `Peer Authorized` (`status.read`-only scope, session-only duration), instant Host `Revoke Access`, and bounded 2.5s Client revocation reconciliation.
   - Windows DPAPI keystore (`WindowsDpapiKeystore`) and non-Windows session-only in-memory keystore (`InMemoryTestKeystore`).
3. **Autonomous Dogfood & Security Boundary (`scripts/dogfood/`, `docs/JACK-VM-GRANT-001.md`)**:
   - `JACK-VM-GRANT-001` HMAC-SHA256 signed capability grants + fixed-operation `jack-dogfood-net-helper` + repeatable cross-OS dogfood runner.

---

## 2. Qualification & Platform Support Matrix

| Target Platform | Artifact / Path | Compile & Package | Automated / CI Smoke | Native GUI Launch | Cross-Machine Native E2E | Overall Gate |
|---|---|---|---|---|---|---|
| **macOS 15.7.7 (`arm64` Apple Silicon)** | `JACK Desktop_0.1.0_arm64.dmg` | **PASS** (`macos-15`) | **PASS** (`codesign --verify --deep --strict`) | **PASS** (Physical M-series Mac) | **PARTIAL** (`macOS Host -> Linux Client` **PASS**; `Linux -> macOS` `NOT_TESTED` without LAN `ufw` rule) | **PARTIAL (Experimental Preview)** |
| **Ubuntu 24.04 LTS (`x86_64`)** | `JACK Desktop_0.1.0_amd64.AppImage`, `.deb`, `bin/jack` | **PASS** (`ubuntu-24.04`) | **PASS** (CLI + `xvfb-run` Desktop smoke) | **PASS** (CachyOS native Wayland + Ubuntu Xvfb) | **PASS** (Linux <-> Windows 11 VM & Mac -> Linux on CachyOS) | **PASS (CLI) / Experimental RC (Desktop)** |
| **Ubuntu 26.04 LTS (`x86_64`)** | `ubuntu-24.04`-built `.AppImage` / `.deb`, `bin/jack` | **PASS** | **PASS** (`ubuntu-26.04` CLI + `xvfb-run` Desktop smoke) | **NOT_TESTED** (Headless CI `xvfb-run` only) | **NOT_TESTED** (Evaluated via CI runtime verification) | **PARTIAL (Experimental Preview)** |
| **Windows 11 (`x86_64` 26300)** | `JACK Desktop_0.1.0_x64-setup.exe` (NSIS) | **PASS** (`windows-latest`) | **PASS** (NSIS install + cold/warm smoke) | **PASS** (`jack-win11-dogfood` KVM VM) | **PASS** (Bidirectional `Linux <-> Windows 11` VM E2E) | **PARTIAL (VM PASS; Physical HW Pending)** |

---

## 3. Known Limitations & Residual Debt

1. **macOS Code Signing & Notarization (`TD-005`)**: `JACK Desktop.app` inside `JACK Desktop_0.1.0_arm64.dmg` is ad-hoc bundle-signed (`flags=0x2(adhoc)`, passes `codesign --verify --deep --strict`), **not** Apple Developer ID signed or notarized. First launch under `com.apple.quarantine` requires **System Settings → Privacy & Security → Open Anyway**.
2. **Non-Windows Ephemeral Keystore (`TD-004`)**: On macOS and Linux, Easy Pairing device identities are held in memory for the active session (`InMemoryTestKeystore`). Windows uses persistent per-user DPAPI (`CryptProtectData`).
3. **Host Firewall Rules (`TD-006`)**: JACK Desktop never edits host firewalls (`ufw`, Windows Defender, macOS Application Firewall). Hosting Easy Pairing on a non-loopback LAN/bridge interface requires the host firewall to permit incoming TCP connections from the peer to the displayed ephemeral port.
4. **macOS Intel (`x86_64`)**: Removed from default PR CI matrix; available via manual `workflow_dispatch` (`include_x64=true`) only and unqualified on physical Intel hardware.

---

## 4. Installation & Rollback Instructions

### 4.1 CLI (`bin/jack` — Linux & macOS)
- **Install**: `./scripts/setup-workstation.sh` (Linux) or `./scripts/setup-macos.sh` (macOS), then confirm with `yes`.
- **Rollback / Uninstall**: Run `jack uninstall` (removes only `~/.local/bin/jack` symlink; preserves `~/.config/jack/config` and `~/.ssh/known_hosts`), or `git checkout v0.1.1`.

### 4.2 JACK Desktop Preview
- **Linux (`.AppImage` / `.deb`)**:
  - Verify `sha256sum -c SHA256SUMS-linux.txt`, `chmod +x JACK\ Desktop_0.1.0_amd64.AppImage`, and run.
  - Rollback: Remove the `.AppImage` (or `sudo apt remove jack-desktop`) and optional `~/.config/jack/easy-pairing` directory.
- **macOS (`arm64` `.dmg`)**:
  - Verify `shasum -a 256 -c SHA256SUMS-macos-arm64.txt`, mount `JACK Desktop_0.1.0_arm64.dmg`, drag `JACK Desktop.app` to `/Applications`, and approve via **System Settings → Privacy & Security → Open Anyway** if prompted.
  - Rollback: Delete `/Applications/JACK Desktop.app` and optional `~/.config/jack/easy-pairing`.
- **Windows 11 (NSIS `.exe`)**:
  - Verify `Get-FileHash .\JACK*setup.exe -Algorithm SHA256`, run `JACK Desktop_0.1.0_x64-setup.exe`.
  - Rollback: Run `%LOCALAPPDATA%\JACK Desktop\uninstall.exe` (or Uninstall via Windows Settings → Installed Apps).

---

## 5. Publication Gate Evaluation (`009F`)

| Gate | Requirement | Status | Remediation / Next Step |
|---|---|---|---|
| `G-SEC` | Zero open P0/P1 security findings; `status.read`-only enforced | **PASS** | None |
| `G-CI` | Ubuntu 24.04, Ubuntu 26.04, Windows 11, and macOS ARM64 CI green from single commit | **PASS** (Verified in 009E CI run) | None |
| `G-WIN` | Bidirectional Linux <-> Windows 11 native E2E | **PARTIAL** (VM **PASS**; physical Windows HW `NOT_TESTED`) | Optional owner test on physical Windows 11 machine |
| `G-MAC` | Bidirectional Linux <-> macOS ARM64 native E2E | **PARTIAL** (`macOS -> Linux` **PASS**; `Linux -> macOS` `NOT_TESTED`) | Run `Linux -> macOS` with temporary `enp39s0` `ufw` rule when desired |
| `G-SIGN` | Apple Developer ID + Notarization / Windows Authenticode | **DEFERRED (V0.3)** | Maintain `EXPERIMENTAL_RC` / preview label for V0.2 |

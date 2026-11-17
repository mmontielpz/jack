# JACK Product Vision, Support Policy & Roadmap

## 1. Product Vision & Value Proposition

**JACK** provides fast, verifiable, least-privilege device connectivity for developers, lab operators, and multi-OS workstation users who work across Linux, macOS, and Windows machines.

JACK combines two complementary layers:
1. **JACK CLI (`bin/jack`, Stable Foundation)**: A zero-daemon Bash CLI for registering, diagnosing, and connecting to your own devices over OpenSSH and optional Tailscale (`jack add`, `jack connect`, `jack devices`, `jack status`, `jack doctor`, `jack diagnose`).
2. **JACK Desktop & Easy Pairing (`desktop/` + `easy-pairing/`, Experimental Preview in V0.2)**: A native Tauri 2 desktop application featuring **Auth Code-First Easy Pairing** — pairing two local/LAN devices using a short-lived 8-character Crockford Base32 code (`XXXX-XXXX`), SPAKE2 password-authenticated key exchange, TLS 1.3 mutual authentication (`RFC 9266` exporter channel binding), independent 6-digit SAS verification, explicit Host human approval, and instant session revocation, with **zero SSH key/username setup** required on the primary path.

---

## 2. Target Users & Non-Goals

### Target Users
- Developers and researchers operating hybrid **Linux (Arch/CachyOS, Ubuntu)**, **macOS (Apple Silicon)**, and **Windows 11** workstations or local VMs.
- Users who want an immediate, cryptographically verified local pairing flow for read-only device status checks (`status.read`), alongside an explicit **Advanced: Manual SSH** path for full terminal workflows.

### Explicit Non-Goals
- **No silent or unrestricted remote shell**: Easy Pairing in V0.2 is strictly scoped to `status.read` (session-only). It never grants remote command execution, file transfer, or unattended root access.
- **No cloud account lock-in**: Local Easy Pairing operates directly over loopback (`127.0.0.1`), RFC1918 LAN, virtual bridges (`virbr0`), or CGNAT (`100.64.0.0/10`) without requiring a central cloud account or Tailscale login.
- **No automatic firewall or OS security weakening**: JACK never disables host firewalls (`ufw`, Windows Defender Firewall, macOS Application Firewall), Gatekeeper, or TCC automatically.

---

## 3. Platform Support Policy (V0.2 Experimental RC)

| Platform | Subsystem | Tier | Qualification Evidence | Known Limitations |
|---|---|---|---|---|
| **Arch Linux / CachyOS (`x86_64`)** | CLI (`bin/jack`) + Desktop (`.AppImage`) | **Supported (CLI) / Experimental RC (Desktop)** | Full CLI suite + bidirectional native Desktop E2E vs Windows 11 VM & `macOS -> Linux` E2E | Incoming LAN/bridge Host connections require explicit narrow `ufw` rule if `ufw` is active |
| **Ubuntu 24.04 LTS (`x86_64`, incl. WSL2)** | CLI (`bin/jack`) + Desktop (`.AppImage` / `.deb`) | **Supported (CLI) / Experimental RC (Desktop)** | CI `ubuntu-24.04` build, CLI smoke, Rust/Vitest suites, `xvfb-run` Desktop startup smoke | Cross-machine GUI E2E verified on CachyOS host |
| **Ubuntu 26.04 LTS (`x86_64`)** | CLI (`bin/jack`) + Desktop (`.AppImage` / `.deb`) | **Experimental RC** | CI `ubuntu-26.04` CLI smoke + `ubuntu-24.04`-built `.AppImage`/`.deb` runtime compatibility verification | Uses `ubuntu-24.04`-built bundle for glibc compatibility |
| **macOS 15.7.7 (`arm64` Apple Silicon)** | CLI (`bin/jack`) + Desktop (`.dmg`) | **Experimental RC** | Physical Apple Silicon Mac native GUI launch + `macOS Host -> Linux Client` LAN E2E + `codesign --verify --deep --strict` | Ad-hoc bundle-signed (not Apple notarized); `Linux -> macOS` E2E & SSH TCC UI automation require manual owner session |
| **Windows 11 (`x86_64`)** | Desktop (NSIS `.exe`) + SSH Target | **Experimental RC (VM Qualified)** | Bidirectional native Desktop E2E (`Linux <-> Windows 11`) in KVM/QEMU VM (`jack-win11-dogfood`) + CI NSIS cold/warm smoke | Physical Windows 11 hardware acceptance pending; `bin/jack` Bash CLI is not a native Windows client |
| **macOS Intel (`x86_64`)** | Desktop (`.dmg`) | **Unqualified (Manual Build Only)** | Optional CI `workflow_dispatch` (`include_x64=true`) build & `codesign` check | No physical Intel Mac runtime qualification; removed from default PR matrix |

---

## 4. Milestones: V0.2 RC → V0.3 → V1.0

### Milestone V0.2 — Experimental Release Candidate (Current)
- **CLI**: Unified device registry (`jack add`, `jack devices`, `jack default`, `jack status`, `jack doctor --json`, `jack diagnose --json`), governed read-only update planning, Ubuntu/WSL2 compatibility.
- **Easy Pairing Core (`easy-pairing/`)**: 8-char Base32 code + SPAKE2 + TLS 1.3 (`RFC 9266` exporter binding) + 6-digit SAS + explicit Host `Approve`/`Deny` + `status.read`-only capability + instant revocation.
- **Desktop (`desktop/`)**: Auth Code-first Home, `Listen Network` selector (`127.0.0.1` default + RFC1918/bridge/CGNAT enumeration, public IPs rejected), Host `Authorizing Device...` -> `Peer Authorized` (`status.read` only) UX, Client bounded 2.5s revocation reconciliation, Windows DPAPI keystore.
- **Dogfood & Security (`scripts/dogfood/`)**: `JACK-VM-GRANT-001` least-privilege authorization boundary and repeatable cross-OS harness.

### Milestone V0.3 — Persistent Keystores, Signed Installers & Scoped Workspace Read
- **OS Keystores**: Native macOS Keychain (`Security.framework`) and Linux Secret Service (`libsecret` + fail-closed Argon2id/ChaCha20-Poly1305 opt-in fallback per `ADR-005`) replacing the non-Windows in-memory preview keystore.
- **Code Signing & Notarization**: Apple Developer ID signing + Apple notarization (`xcrun notarytool` + `stapler`) and Windows Authenticode signing.
- **Discovery & QR**: Optional mDNS/Bonjour local peer discovery (`_jack-pair._tcp.local.`) and QR code display/camera import (`ADR-006`) alongside manual code entry.
- **Scoped Capabilities**: Add explicit opt-in `workspace.read` capability with per-request path/scope confirmation and audit trail (`EP-003`).

### Milestone V1.0 — Cryptographic Audit, Cross-NAT Relay & Stable Contract
- **External Cryptographic Review**: Independent audit of the SPAKE2 + TLS 1.3 `RFC 9266` exporter binding and keystore implementations (`ADR-009`).
- **Cross-Network Connectivity (`EP-006`)**: Optional end-to-end encrypted relay/coordination for separate-NAT devices without requiring Tailscale (`ADR-007`).
- **Full 3-OS Physical Hardware Certification**: Bidirectional physical-hardware acceptance across Linux, macOS (`arm64`), and Windows 11, establishing the long-term 1.x compatibility contract.

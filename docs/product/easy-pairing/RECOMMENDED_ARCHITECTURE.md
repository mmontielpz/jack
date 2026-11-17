# JACK Easy Pairing — Recommended Architecture (`JACK-EP-001`)

> **Classification:** `PROPOSAL` (Recommendation for MVP)

## Recommendation: Option C — Hybrid Architecture

Adopt **Option C**: a user-space **JACK Host & Client Pairing Subsystem** built on established cryptographic and transport standards (**TLS 1.3 mutual authentication with Ed25519 device keys** + **SPAKE2 / SAS** pairing), paired with **scoped capability execution**, while preserving existing `bin/jack` + OpenSSH as the **Manual SSH** advanced/recovery path.

## Rationale

1. **Solves the Brother-on-Windows Friction:** Eliminates the requirement for the brother to install/configure Windows OpenSSH Server, create/discover a Windows SSH username, manage `authorized_keys`, or configure Tailscale manually before pairing.
2. **Least Privilege by Default:** Pairing grants narrowly scoped capabilities (e.g., `status.read`, `workspace.list`, `exec.approved_command`) rather than an unrestricted remote shell.
3. **No Custom Crypto or Custom Transport Security:** Uses standard TLS 1.3 (`rustls`) with Ed25519 device certificates, standard SPAKE2 / HKDF-SHA256 for pairing key confirmation, and OS-native keystores.
4. **Incremental & Reversible:** Existing CLI (`bin/jack` `0.1.1`) and Manual SSH desktop flows remain untouched as the fallback path.

## Component Boundaries

### Reused (`FACT`)
- Tauri 2 + React + TypeScript desktop shell (`desktop/`).
- Existing `bin/jack` CLI (`0.1.1`) for Manual SSH, `doctor`, `diagnose`, and `repair`.
- Existing Tailscale read-only detection (`tailscale status --json`) and peer discovery.
- Existing input validation rules (`validate_host`, `validate_device_alias`, `validate_user`) for Manual SSH.

### Must Be Implemented (EP-002 .. EP-005) (`PROPOSAL`)
- **Identity Store (`EP-002`):** Per-installation Ed25519 keypair + OS keystore integration + device fingerprint (`SHA-256` of SPKI).
- **Pairing Engine (`EP-002`):** Invitation generator (QR payload + 8-char Base32/Crockford code), SPAKE2 / SAS verifier, single-use TTL & rate-limiter.
- **Host Service & Authorization (`EP-003`):** TLS 1.3 mTLS listener, human approval prompt, scoped capability & session token store, instant revocation.
- **Easy Pairing UI (`EP-004`):** 9-screen minimal UI replacing the technical onboarding wizard as the primary flow.
- **LAN + Tailscale Transport (`EP-005`):** mDNS discovery + Tailscale IP binding for Linux Client <-> Windows Host qualification.

### Experimental / Deferred (`PROPOSAL`)
- **Cross-Network Relay / Coordination Service (`EP-006`):** Deferred until local/Tailscale vertical slice is qualified; only needed when neither LAN nor Tailscale connects the two peers.
- **Unattended Background Access & macOS Host (`EP-007+`):** Deferred with explicit opt-in and OS service packaging requirements.

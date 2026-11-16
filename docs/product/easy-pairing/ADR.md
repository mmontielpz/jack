# JACK Easy Pairing — Architecture Decision Records (`JACK-EP-001`)

> **Classification:** `PROPOSAL`

## ADR-001: Hybrid Architecture (JACK Pairing/Authorization Service + Manual SSH Fallback)
- **Status:** Proposed
- **Decision:** Use a user-space JACK Host service (TLS 1.3 mTLS + Ed25519 + SPAKE2) for Easy Pairing and scoped capabilities, while preserving `bin/jack` + OpenSSH as **Manual SSH** fallback.
- **Rationale:** Eliminates Windows OpenSSH Server setup friction and enforces least privilege without losing CLI `0.1.1` compatibility.

## ADR-002: Per-Installation Ed25519 Identity + OS Keystore
- **Status:** Proposed
- **Decision:** Generate one Ed25519 keypair per JACK installation stored in OS keystore (`libsecret` on Linux, DPAPI on Windows, Keychain future macOS).
- **Rationale:** Standard, fast, zero custom crypto, clean revocation/reinstallation semantics.

## ADR-003: 8-Char Crockford Base32 Code + SPAKE2 + 6-Digit SAS (No TOTP, No Secrets in QR)
- **Status:** Proposed
- **Decision:** Use 8-char Base32 codes (40-bit) + SPAKE2 (max 5 attempts) + 6-digit SAS comparison for manual code pairing; QR embeds only `host_pk` + ephemeral 128-bit `pake` nonce (5-min TTL, single-use).
- **Rationale:** Prevents offline brute-force and MITM without requiring clock sync or long-lived shared secrets.

## ADR-004: Least-Privilege Default Scopes (No Default Shell)
- **Status:** Proposed
- **Decision:** Initial pairing grants `status.read` / `workspace.read` only, bound to explicit duration (`This session`, `1h`, `24h`, `Remember`).
- **Rationale:** Aligns with human approval and future Agentic Remote Workspace safety.

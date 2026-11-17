# JACK Easy Pairing — Architecture Decision Records (`JACK-EP-001A`)

> **Classification:** `PROPOSAL` (Closed design decisions for EP-002..EP-007; pending external crypto audit where noted)

## ADR-001: Hybrid Architecture (JACK Pairing/Authorization Service + Manual SSH Fallback)
- **Status:** Closed for MVP Design (`PROPOSAL`)
- **Decision:** User-space JACK Host service (TLS 1.3 mTLS + Ed25519 + SPAKE2) for Easy Pairing, preserving `bin/jack` + OpenSSH as **Manual SSH** fallback.

## ADR-002: Per-Installation Ed25519 Identity + OS Keystore
- **Status:** Closed for MVP Design (`PROPOSAL`)
- **Decision:** Per-installation Ed25519 keypair stored in `libsecret` (Linux), DPAPI (Windows), Keychain (future macOS).

## ADR-003: 8-Char Crockford Base32 Code + SPAKE2 + 6-Digit SAS
- **Status:** Closed for MVP Design (`PROPOSAL`)
- **Decision:** 8-char Base32 code (`XXXX-XXXX`, 40-bit) + SPAKE2 (max 5 attempts) + 6-digit SAS comparison; QR payload carries `host_pk` + ephemeral 128-bit `pake` secret (300s TTL, single-use, never logged).

## ADR-004: Least-Privilege Default Scopes & Explicit Durations
- **Status:** Closed for MVP Design (`PROPOSAL`)
- **Decision:** No default unrestricted shell; explicit duration grants (`This session`, `1h`, `24h`, `Remember`).

## ADR-005: Linux Headless Keystore Fallback (Fail-Closed, No Silent Plaintext)
- **Status:** Closed (`PROPOSAL` — G5/G8)
- **Decision:** If Secret Service (`libsecret`) is unavailable on Linux, fail closed (`ERR_KEYSTORE_UNAVAILABLE`). Support optional explicit opt-in passphrase-encrypted keyfile (**Argon2id + ChaCha20-Poly1305**); never write silent plaintext private keys.

## ADR-006: Code-First UX for MVP, QR as Alternate Representation
- **Status:** Closed (`PROPOSAL` — G8)
- **Decision:** `EP-004` prioritizes the 8-char Crockford Base32 pairing code (`XXXX-XXXX`) for zero-hardware desktop pairing, with QR code display/import as an alternate representation of the same invitation.

## ADR-007: Cross-NAT Relay Deferred to EP-006
- **Status:** Closed (`PROPOSAL` — G6/G8)
- **Decision:** `EP-002`–`EP-005` cover LAN/mDNS, Tailscale, and direct endpoints; separate-NAT relay/coordination is explicitly deferred to `EP-006`.

## ADR-008: EP-002 Capability Strictly Limited to `status.read`
- **Status:** Closed (`PROPOSAL` — G4/G8)
- **Decision:** `EP-002` exposes only `status.read` (read-only Host health/OS/version). `workspace.read` and remote execution are deferred to `EP-003+`.

## ADR-009: Cryptographic Composition & External Audit Requirement
- **Status:** Provisional (`PROPOSAL` — G1/G8)
- **Decision:** Select `rustls` (TLS 1.3) + `RFC 9266` `tls-exporter` + `spake2` + `HKDF-SHA256` + `HMAC-SHA256` + `ed25519-dalek` + `zeroize`. External cryptographic expert review is required before production release.

## ADR-010: Bundle-Level Ad-Hoc Signing (`codesign --force --deep --sign -`) for macOS Experimental Previews
- **Status:** Accepted (`007B`)
- **Decision:** Bare `linker-signed` Mach-O executables inside `.app` bundles lack `_CodeSignature/CodeResources` and fail `codesign --verify --deep --strict` under `com.apple.quarantine` on macOS Sequoia ("is damaged and can't be opened"). Until Apple Developer ID + notarization secrets are provisioned in V0.3, CI must run `codesign --force --deep --sign -` on `JACK Desktop.app` and enforce `codesign --verify --deep --strict` before and after DMG packaging.

## ADR-011: Least-Privilege Dogfood Boundary (`JACK-VM-GRANT-001`)
- **Status:** Accepted (`006`)
- **Decision:** Keep all `qemu:///session` VM lifecycle, VNC, ISO swap, and Linux AppImage dogfooding unprivileged. Gate the only host-privileged operation (temporary `virbr0` UFW rule for `Linux Host -> Windows Client`) behind a fixed-operation helper (`jack-dogfood-net-helper`) requiring an owner-signed, time-bounded, non-replayable, revocable `JACK-VM-GRANT-001` JSON token.

## ADR-012: Linux `/proc/net/fib_trie` Local IP Enumeration & Bounded Client Revocation Reconciliation
- **Status:** Accepted (`005` / `008`)
- **Decision:** On Linux, supplement UDP route-probing with `/proc/net/fib_trie` (`/32 host LOCAL`) parsing filtered through `is_lan_or_loopback_ip()` so RFC1918 virtual bridges (`virbr0`) appear in `Listen Network` while keeping `127.0.0.1` as default and rejecting public IPs. On the Client, run a bounded 2.5s `status.read` reconciliation loop with an in-flight guard while `Connected` so Host revocation or stop transitions the Client out of `Connected` fail-closed.

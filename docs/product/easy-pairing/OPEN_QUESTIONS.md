# JACK Easy Pairing — Open Questions & Design Decisions (`JACK-EP-001A`)

> **Classification:** `DECISION_REQUIRED` / `NOT_TESTED` / `ASSUMPTION`

## Closed Decisions (See `ADR.md`)
- **Linux Keystore Fallback (`ADR-005`):** Closed — fail closed by default; explicit passphrase-encrypted Argon2id+ChaCha20-Poly1305 opt-in only.
- **Code-First MVP UX (`ADR-006`):** Closed — 8-char Crockford Base32 primary, QR alternate.
- **Relay Hosting Timing (`ADR-007`):** Closed for MVP — deferred to `EP-006`.
- **EP-002 Capability Scope (`ADR-008`):** Closed — `status.read` only.

## Open Questions (`DECISION_REQUIRED` / `NOT_TESTED`)

1. **`DECISION_REQUIRED` — External Cryptographic Audit Scope:** Confirm timing and reviewer for the `ADR-009` (`rustls` + `RFC 9266` + `spake2`) composition before any public Easy Pairing release.
2. **`DECISION_REQUIRED` — QR Camera vs Image/URI Paste in `EP-004`:** Decide whether `EP-004` includes webcam QR scanning or only QR display + URI/image import alongside the primary 8-char code input.
3. **`DECISION_REQUIRED` — `EP-006` Relay Architecture:** Self-hosted relay vs managed JACK relay (deferred until `EP-005` passes).
4. **`NOT_TESTED` — Windows Defender Firewall Prompt UX:** Exact Windows 11 Home/Pro prompt behavior when JACK Desktop binds an ephemeral LAN TCP port in user space (`EP-005`).
5. **`ASSUMPTION` — Same-LAN mDNS Availability:** Guest/corporate Wi-Fi with AP isolation blocks mDNS, requiring Tailscale or `EP-006` relay.

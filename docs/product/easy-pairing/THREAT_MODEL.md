# JACK Easy Pairing — Threat Model (`JACK-EP-001A`)

> **Classification:** `PROPOSAL` (26 threats evaluated; external cryptographic audit required before claiming production qualification)

| # | Threat | Preconditions | Impact | Mitigation | Residual Risk | Test Strategy | Qualification Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | **Stolen pairing code** | Active invite before TTL/use. | Unauthorized pairing attempt. | 5-min TTL, single-use, SPAKE2, 6-digit SAS + mandatory Host approval. | Low | Protocol & Host approval tests. | `PROVISIONAL_MITIGATED` |
| 2 | **QR interception** | Physical/screen visibility of QR. | Attacker scans before Owner. | Single-use consume + Host approval showing Client Device ID. | Low | 2nd-scan `ERR_INVITE_CONSUMED` test. | `PROVISIONAL_MITIGATED` |
| 3 | **Brute-force attempts** | Reachable Host pairing port. | Guess 8-char code. | SPAKE2 online-only, max 5 attempts, backoff, hard lock -> `FAILED`. | Low | Rate-limiter & lockout tests. | `PROVISIONAL_MITIGATED` |
| 4 | **Replay attacks** | LAN packet capture. | Duplicate pairing/session. | TLS 1.3 ECDHE + `RFC 9266` `tls_cb` + single-use `invite_id`. | Negligible | Replay fixture rejecting reused invite. | `PROVISIONAL_MITIGATED` |
| 5 | **Man-in-the-middle (MITM)** | Active MITM on LAN. | Key substitution. | `tls_cb` (`RFC 9266`) + `host_pk`/`client_pk` bound in SPAKE2 MAC + 6-digit SAS. | Low (human SAS) | MITM proxy fixture failing MAC/SAS. | `PROVISIONAL_MITIGATED` |
| 6 | **Malicious Host** | Client connects to rogue Host. | Client RPC exposure. | Client exposes zero Host capabilities by default; strict schema validation. | Low | Client refusal tests. | `PROVISIONAL_MITIGATED` |
| 7 | **Malicious Client** | Paired Client compromised. | Unauthorized Host actions. | EP-002 limited to `status.read`; server-side scope allowlist. | Low | `ERR_SCOPE_DENIED` negative tests. | `PROVISIONAL_MITIGATED` |
| 8 | **Compromised trusted device** | Malware on Client OS. | Abuse of active grant. | OS keystore + time-bound grants + instant Host revocation. | Medium | Active-session termination test. | `PARTIAL_RESIDUAL_RISK` |
| 9 | **Device impersonation** | Attacker spoofs display name. | Social-engineered approval. | `Device ID` derived from Ed25519 pubkey; mTLS pins pubkey. | Low | mTLS SPKI pinning test. | `PROVISIONAL_MITIGATED` |
| 10 | **Unauthorized reconnection** | Expired/revoked grant. | Post-expiry access. | Host checks `trusted_peers` + `expires_at` + `!revoked` on handshake & RPC. | Low | Expiry & revocation tests. | `PROVISIONAL_MITIGATED` |
| 11 | **Privilege escalation** | Valid mTLS session. | Requesting shell on `status.read`. | Server-side scope enforcement; no shell in EP-002. | Low | Scope escalation negative tests. | `PROVISIONAL_MITIGATED` |
| 12 | **Session hijacking** | Network eavesdropping. | Hijacked stream. | TLS 1.3 mTLS; grants bound to mTLS `Device ID` (no bearer tokens). | Negligible | TLS 1.3 mTLS binding test. | `PROVISIONAL_MITIGATED` |
| 13 | **Token / key leakage** | Bug in logging/crash handler. | Key or `pake` exposure. | `Zeroize` on secrets; strict log redaction; `0600` files; QR URI never logged. | Low | Log-redaction & file-mode tests. | `PROVISIONAL_MITIGATED` |
| 14 | **Insecure local storage** | Shared host / symlink attack. | Trust store tampering. | Refuse symlinks, verify owner UID, atomic `0600` writes. | Low | Symlink & wrong-UID tests. | `PROVISIONAL_MITIGATED` |
| 15 | **Relay/coord compromise** | Future `EP-006` relay compromised. | Metadata or DoS. | E2E TLS 1.3 mTLS inside relay; relay holds no keys. | Low (metadata) | Deferred to `EP-006`. | `DEFERRED_EP006` |
| 16 | **Denial of service** | Pairing port flood. | Pairing unavailable. | Per-IP rate limit, 5s handshake timeout, 1 active attempt lock. | Low | Concurrency & timeout tests. | `PROVISIONAL_MITIGATED` |
| 17 | **Unintended unattended access** | User leaves Host sharing on. | Unexpected future access. | Foreground sharing, explicit duration, visible active indicator. | Low | Session-close termination test. | `PROVISIONAL_MITIGATED` |
| 18 | **PAKE/mTLS binding failure** | Relay between two TLS sessions. | MITM splits TLS + relays SPAKE2. | `RFC 9266` `tls-exporter` (`tls_cb`) + `host_pk`/`client_pk` in HKDF & HMAC. | Negligible | Dual-TLS MITM test fails MAC. | `PROVISIONAL_MITIGATED` |
| 19 | **Invitation substitution** | Attacker swaps QR/mDNS hint. | Client connects to wrong Host. | QR pins `host_pk`; Code flow binds `tls_cb` + `host_pk` into SAS. | Low | Substituted-endpoint test fails. | `PROVISIONAL_MITIGATED` |
| 20 | **Identity confusion** | Two peers share hostname. | Approving wrong machine. | Display cryptographic `Device ID` alongside hostname; pin SPKI. | Low | Duplicate-name fixture test. | `PROVISIONAL_MITIGATED` |
| 21 | **Cross-protocol downgrade** | Attacker forces older TLS/proto. | Weak cipher or unauthenticated mode. | `rustls` TLS 1.3-only, ALPN `"jack-pair/1"`, `"jack-pair-v1"` in MACed transcript. | Negligible | TLS 1.2 / bad-ALPN reject test. | `PROVISIONAL_MITIGATED` |
| 22 | **Concurrent pairing races** | Two Clients pair simultaneously. | State corruption / TOCTOU. | Single `active_attempt_lock`; 2nd Client gets `ERR_PAIRING_BUSY`. | Low | Concurrent-client race test. | `PROVISIONAL_MITIGATED` |
| 23 | **Host approval spoofing** | Attacker crafts fake UI/RPC approval. | Bypassing human approval. | Approval only accepted from local trusted UI IPC; Host state machine rejects skip. | Low | State-machine invalid-transition test. | `PROVISIONAL_MITIGATED` |
| 24 | **Revocation during active session** | Revoke clicked mid-session. | Stale session stays open. | Immediate in-memory `revoked` flag + TLS stream shutdown + `ERR_TRUST_REVOKED`. | Low | Mid-session revoke integration test. | `PROVISIONAL_MITIGATED` |
| 25 | **Keystore unavailable** | Headless Linux without Secret Service. | Plaintext key exposure. | Fail closed (`ERR_KEYSTORE_UNAVAILABLE`); optional Argon2id+ChaCha20-Poly1305 passphrase keyfile. | Low | Missing-keystore fail-closed test. | `PROVISIONAL_MITIGATED` |
| 26 | **Device cloning** | VM/disk cloned with keypair. | Duplicate `Device ID` collisions. | Per-installation keygen; manual revocation & re-pair if cloned; documented operational boundary. | Medium | Operational runbook + revoke test. | `PARTIAL_RESIDUAL_RISK` |

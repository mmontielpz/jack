# EP-002 Implementation Contract (`JACK-EP-001A`)

> **Classification:** `PROPOSAL` (G9 Binding Contract for `EP-002` — NO implementation authorized in `EP-001A`)

## 1. Scope & Execution Environment
- **Vertical Slice:** Two **isolated local processes** (`jack-host-fixture` and `jack-client-fixture`) communicating over `127.0.0.1` loopback using disposable `$JACK_HOME` / temp directories.
- **Only Capability Permitted:** `status.read` (returns `{ os, jack_version, host_device_id, uptime_seconds }`).
- **Prohibited in EP-002:** Real remote SSH execution, shell access, filesystem read/write (`workspace.read`), Tailscale/firewall mutation, or touching real `~/.config/jack` or `~/.ssh`.

## 2. Exact Module Boundaries (`desktop/src-tauri/src/easy_pairing/`)

| Module | Responsibility | Forbidden |
| --- | --- | --- |
| `identity.rs` | Ed25519 keygen, `DeviceId`, OS keystore (`libsecret`/DPAPI) + explicit Argon2id/ChaCha20-Poly1305 opt-in fallback | Silent plaintext key fallback |
| `pairing.rs` | Invitation struct (`Zeroize`), 8-char Crockford Base32 + QR URI codec, 11-state machine, SPAKE2 + `RFC 9266` `tls_cb` + HKDF + HMAC + 6-digit SAS, 5-attempt lockout, `active_attempt_lock` | Skipping `VERIFYING_IDENTITY` or `WAITING_FOR_APPROVAL`; logging `pake` secrets |
| `transport.rs` | `rustls` TLS 1.3-only server/client, ALPN `"jack-pair/1"`, pre-trust pairing SPKI extractor, post-pairing pinned-SPKI mTLS verifier | TLS < 1.3, WebPKI CA trust, unauthenticated plaintext fallback |
| `auth.rs` | `trusted_peers.json` + `grants.json` atomic `0600` store (symlink/UID-checked), `status.read`-only allowlist, expiry & revocation enforcement | Granting `workspace.read` or shell; failing open on corrupt store |
| `status_cap.rs` | Read-only `status.read` handler | Any filesystem/process mutation |

## 3. Core I/O Types (Contract)
- `DeviceId(String)`: `"jack:ed25519:<base32_16bytes>"`
- `PairingInvitation { invite_id: [u8; 16], code: Zeroizing<String>, pake_secret: Zeroizing<[u8; 16]>, expires_at: u64, attempts: u8, locked: bool }`
- `PairingState`: `Ready | InvitationCreated | WaitingForRequest | VerifyingIdentity | WaitingForApproval | Authorized | Connected | Denied | Expired | Failed | Revoked`
- `CapabilityScope`: `StatusRead` (`"status.read"` only in EP-002)
- `Grant { grant_id: String, peer_id: DeviceId, scopes: Vec<CapabilityScope>, expires_at: Option<u64>, revoked: bool }`

## 4. Error Taxonomy
`ERR_PROTOCOL_VERSION`, `ERR_INVITE_EXPIRED`, `ERR_INVITE_CONSUMED`, `ERR_PAIRING_BUSY`, `ERR_PAIRING_LOCKED`, `ERR_PAKE_BINDING_FAILED`, `ERR_APPROVAL_DENIED`, `ERR_TRUST_REVOKED`, `ERR_GRANT_EXPIRED`, `ERR_SCOPE_DENIED`, `ERR_AUTH_STATE_UNAVAILABLE`, `ERR_KEYSTORE_UNAVAILABLE`, `ERR_HOST_UNREACHABLE`.

## 5. Security Invariants & Required Negative Tests
1. **Channel-Binding MITM Test:** Dual-TLS relay between Client and Host produces mismatched `tls_cb` and fails `ERR_PAKE_BINDING_FAILED`.
2. **Brute-Force Lockout Test:** 5 invalid codes lock invitation (`ERR_PAIRING_LOCKED` -> `Failed`).
3. **Concurrent Race Test:** 2nd simultaneous `PairHello` receives `ERR_PAIRING_BUSY`.
4. **Invalid State-Transition Tests:** Direct `WaitingForRequest -> Authorized` or `Denied/Expired/Revoked -> Connected` rejected.
5. **Scope Escalation Test:** Requesting `"workspace.read"` or `"exec.shell"` returns `ERR_SCOPE_DENIED`.
6. **Active-Session Revocation Test:** Revoking peer mid-session terminates TLS stream and rejects reconnect (`ERR_TRUST_REVOKED`).
7. **Fail-Closed Storage Tests:** Symlinked/corrupt `trusted_peers.json` or missing Linux Secret Service returns `ERR_AUTH_STATE_UNAVAILABLE` / `ERR_KEYSTORE_UNAVAILABLE` (zero plaintext key written).
8. **Secret Redaction Test:** Logs and error strings contain zero `pake_secret`, private key bytes, or `jack://pair` URIs.

## 6. Acceptance Gates & STOP Conditions
- **Gates:** All unit, protocol, negative, and two-process loopback integration tests PASS; `cargo test` & `scripts/dev-check.sh` PASS; independent security review PASS.
- **STOP Conditions:** Any plaintext private-key fallback, any unauthenticated capability execution, any skipped human approval, or any mutation of production `~/.config/jack` / `~/.ssh`.

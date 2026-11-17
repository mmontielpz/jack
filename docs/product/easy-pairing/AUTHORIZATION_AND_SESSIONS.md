# JACK Easy Pairing — Authorization & Session Lifecycle (`JACK-EP-001A`)

> **Classification:** `PROPOSAL` (G4 Session & Revocation Hardening)

## 1. Four-Layer Boundary Model

1. **Device Identity:** Ed25519 keypair (`Device ID`). Authenticates machine identity only.
2. **Device Trust:** Explicit peer public-key entry in `trusted_peers.json` (`0600`, symlink-refused, owner-UID verified).
3. **Capability Grant:** Least-privilege scope list + `expires_at` bound to a specific `Device ID` on the Host.
4. **Active Session:** Ephemeral TLS 1.3 mTLS connection bound to a Grant ID, checked before every RPC.

## 2. EP-002 Capability Restriction (G4)

- **EP-002 Strict Scope:** Only **`status.read`** (read-only Host health, OS label, and JACK version) is permitted in `EP-002`!
- **Deferred to EP-003+:** `workspace.read`, file listing, and approved remote command execution are **prohibited** in `EP-002`.

## 3. Expiration, Revocation & Fail-Closed Enforcement

- **Enforcement Points:** Host checks `trusted_peers` + `grant.expires_at` + `!grant.revoked` at:
  1. mTLS handshake acceptance,
  2. Every incoming capability RPC,
  3. Periodic session-expiry sweep (every 10s on active streams).
- **Active-Session Termination:** Revoking a peer or grant immediately sets `revoked = true` in memory and on disk, sends `ERR_TRUST_REVOKED`, and closes the TLS stream.
- **Offline Revocation:** Since grants are enforced locally by the Host, revoking a Client while the Client is offline guarantees immediate rejection if the Client later attempts to reconnect.
- **Fail-Closed Authorization State:** If `trusted_peers.json` or `grants.json` is missing, unreadable, symlinked, wrong-UID, or invalid JSON, Host **denies all connections and RPCs** (`ERR_AUTH_STATE_UNAVAILABLE`).
- **Unattended Access:** Disabled by default; deferred to post-MVP with explicit OS service consent.

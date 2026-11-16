# JACK Easy Pairing — Authorization & Session Lifecycle (`JACK-EP-001`)

> **Classification:** `PROPOSAL`

## 1. Four-Layer Separation (G5)

1. **Device Identity:** Long-lived per-installation Ed25519 keypair (`Device ID`). Proves *who* a machine is. Never grants access by itself.
2. **Device Trust:** Explicit record in `trusted_peers.json` binding a `Device ID` + public key + display name after human-confirmed pairing.
3. **Capability Authorization (Grant):** Scoped, time-bound policy attached to a trusted `Device ID` on the Host (e.g., `["status.read", "workspace.read"]`).
4. **Session Authorization:** Short-lived active mTLS connection bound to a specific Grant ID, monitored against expiration and revocation.

## 2. Least-Privilege Default Capabilities

- Pairing **never** grants unrestricted remote shell, full filesystem write, or unattended background access by default.
- **Default MVP Scopes:**
  - `status.read` (device health/OS info)
  - `workspace.read` (read-only listing/files inside an explicitly shared workspace directory)
  - `exec.approved` (future: run only pre-approved commands, never arbitrary shell on initial pairing)

## 3. User-Facing Duration Options

| Option | Behavior | Trust Retained? | Reconnection |
| --- | --- | --- | --- |
| **This session only** | Grant expires immediately when the active connection closes | Optional (or ephemeral) | Requires fresh Host approval |
| **One hour** | Grant valid for 3600s | Yes (1h) | Automatic reconnect within 1h |
| **Twenty-four hours** | Grant valid for 86400s | Yes (24h) | Automatic reconnect within 24h |
| **Remember this device** | Persistent `Device Trust` with scoped capabilities (still revocable anytime) | Yes | Automatic reconnect while unrevoked |
| **Unattended access (future)** | **Deferred** — requires explicit opt-in, background service, and separate OS consent | Explicit opt-in | Background |

## 4. Expiration, Revocation & Audit

- **Trust & Session Expiration:** Host checks `now < grant.expires_at` on every capability RPC and periodically on active sessions; expired sessions receive `ERR_GRANT_EXPIRED` and close cleanly.
- **Revocation & Active-Session Termination:** Clicking **Revoke** on Host immediately removes the peer from `trusted_peers.json`, marks all grants revoked, and closes all active TLS streams for that `Device ID`.
- **Permission Changes:** Host owner can downgrade or edit scopes in **Device Permissions**; changes take effect immediately on active sessions.
- **Audit Events:** Host logs structured local JSONL events (no secrets/tokens): `PAIR_INVITE_CREATED`, `PAIR_REQUEST_RECEIVED`, `PAIR_APPROVED`, `PAIR_DENIED`, `SESSION_STARTED`, `CAPABILITY_INVOKED`, `SESSION_ENDED`, `TRUST_REVOKED`.

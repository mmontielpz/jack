# JACK Easy Pairing — Identity and Trust Model (`JACK-EP-001`)

> **Classification:** `PROPOSAL` (Standard cryptographic primitives; no custom crypto)

## 1. Per-Installation Device Identity

- Every JACK installation (Client or Host) generates one **Ed25519** signing keypair on first launch.
- **Device ID:** `jack:ed25519:<base32-first-16-bytes-of-SHA256(pubkey)>` (human-readable short ID) paired with the full 32-byte Ed25519 public key.
- **Mutual Authentication:** Every post-pairing TLS 1.3 connection uses mutual TLS (mTLS) with self-signed X.509 certificates wrapping the Ed25519 public key (pinned directly by public key, not public CAs).
- **Ephemeral Session Keys:** Provided by TLS 1.3 (`ECDHE` / `X25519` forward-secret key exchange).
- **Replay Protection:** Pairing messages include a 128-bit random nonce, monotonic sequence/timestamp window, and single-use invitation ID.

## 2. Platform Key Storage (`PROPOSAL`)

| Platform | Primary Storage | Fallback / Caveat (`DECISION_REQUIRED`) |
| --- | --- | --- |
| **Linux** | Secret Service (`libsecret` / GNOME Keyring / KWallet) via `keyring` crate | Headless/minimal Linux without D-Bus Secret Service: file encrypted with user-supplied passphrase or OS-protected `0600` keyfile with explicit risk warning (`ASSUMPTION`). |
| **Windows** | Windows Credential Manager / CNG DPAPI (`CryptProtectData` scoped to current Windows user) | Protected per-user without requiring admin privileges. |
| **macOS (future)** | macOS Keychain (`SecItemAdd` / Secure Enclave where available) | Deferred to post-MVP macOS qualification. |

## 3. Lifecycle & Recovery Scenarios

- **Explicit Trust Establishment:** Trust is never implicit. A peer public key is added to `trusted_peers.json` (integrity-protected, `0600`) ONLY after successful cryptographic pairing AND explicit human confirmation.
- **Key Rotation:** A paired device may present a rotation proof signed by *both* its old and new Ed25519 keys over an already-authenticated mTLS session; otherwise re-pairing is required.
- **Device Revocation:** Removing a peer from `trusted_peers` immediately rejects all new mTLS handshakes and terminates active sessions for that `Device ID`.
- **Stolen Device Key:** Owner revokes the compromised `Device ID` on the surviving peer; Host invalidates all grants bound to that key.
- **Cloned Machine:** Two machines sharing a cloned key will collide or race; if detected or suspected, owner revokes the `Device ID` and re-pairs each physical machine cleanly.
- **JACK Reinstalled:** Reinstallation without key backup generates a **new** Ed25519 identity; old trust entries are no longer valid and the device must be re-paired (prevents silent impersonation).
- **Lost Trusted Device:** Revoke the lost device's `Device ID` on the Host/Client immediately.
- **Corrupted Trust Record:** Fail closed! Refuse connections for corrupted records, preserve a `.corrupt.<ts>` backup for inspection, and prompt the user to re-pair.

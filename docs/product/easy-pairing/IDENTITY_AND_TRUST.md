# JACK Easy Pairing — Identity, Key Storage & Recovery (`JACK-EP-001A`)

> **Classification:** `PROPOSAL` (G5 Key Storage & Recovery Hardening)

## 1. Key Generation & Lifecycle
- **Algorithm:** Ed25519 (`ed25519-dalek` with OS CSPRNG `OsRng`).
- **Device ID:** `jack:ed25519:<base32-first-16-bytes-of-SHA256(spki_der)>`.
- **Rotation:** Initiated only over an existing authenticated mTLS session with a dual-signed `RotateKeyProof` (signed by both `old_sk` and `new_sk`).
- **Destruction:** Explicit key deletion zeroizes in-memory key material and removes the OS keystore entry.

## 2. Platform Key Storage & Fail-Closed Fallbacks (G5)

### Linux
- **Primary:** D-Bus Secret Service (`libsecret` / GNOME Keyring / KWallet) via `keyring` crate.
- **Headless Linux Fallback (Fail-Closed by Default):**
  - **No silent plaintext private-key fallback!** If Secret Service is unavailable, JACK **fails closed** (`ERR_KEYSTORE_UNAVAILABLE`) and explains how to start a keyring or explicitly opt into a passphrase-protected keyfile.
  - **Explicit Opt-In Passphrase Keyfile:** User supplies a passphrase; private key is encrypted with **Argon2id** (memory-hard KDF) + **ChaCha20-Poly1305** (`0600` file, symlink-refused, owner-UID checked). Never uses a blank or hardcoded passphrase.

### Windows
- **Primary:** Windows DPAPI (`CryptProtectData` with `CRYPTPROTECT_UI_FORBIDDEN`) scoped strictly to the current Windows user account (`LOCAL_MACHINE` scope is prohibited).
- **Failure:** If DPAPI fails, fail closed (`ERR_KEYSTORE_UNAVAILABLE`) without writing plaintext keys.

### macOS (Future)
- macOS Keychain (`SecItemAdd`), deferred to post-MVP qualification.

## 3. Recovery Scenarios
- **Reinstallation:** Generates a new Ed25519 identity; old trust records are invalidated; peer must re-pair.
- **Device Cloning:** Cloned keys violate uniqueness; if detected or suspected, owner revokes the `Device ID` on peers and re-pairs each physical machine.
- **Lost Device:** Revoke the lost `Device ID` in **Device Permissions**; all grants terminate immediately.
- **Corrupted Trust / Key State:** Fail closed (`ERR_TRUST_STATE_CORRUPT`), preserve `.corrupt.<ts>` backup, refuse connections until re-paired.

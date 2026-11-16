# JACK Easy Pairing — Open Questions & Unverified Assumptions (`JACK-EP-001`)

> **Classification:** `DECISION_REQUIRED` / `NOT_TESTED` / `ASSUMPTION`

1. **`DECISION_REQUIRED` — Headless Linux Keystore Fallback:** If a minimal Arch/Ubuntu setup has no `libsecret` / D-Bus Secret Service running, should JACK require a user passphrase for keyfile encryption or fail with setup instructions for `gnome-keyring`/`kwallet`?
2. **`DECISION_REQUIRED` — QR Camera Scanning on Linux Desktop:** Should `EP-004` support webcam QR scanning, clipboard/image QR import, or prioritize 8-char pairing code + optional QR image/camera?
3. **`DECISION_REQUIRED` — Relay Hosting (`EP-006`):** Will a future JACK relay be self-hosted, Tailscale-DERP-adjacent, or JACK-operated? (Deferred until `EP-005` passes.)
4. **`NOT_TESTED` — Windows Defender Firewall User Experience:** Exact UAC/firewall prompt behavior on Windows 11 Home vs Pro when JACK Desktop binds an ephemeral LAN TCP port in user space must be validated in `EP-005`.
5. **`ASSUMPTION` — Same-LAN mDNS Reliability:** Corporate or guest Wi-Fi networks with AP isolation enabled will block mDNS/LAN discovery, requiring Tailscale or future `EP-006` relay.

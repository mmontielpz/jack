# JACK Easy Pairing — Minimal UI/UX Specification (`JACK-EP-001`)

> **Classification:** `PROPOSAL` (`No production UI modified in EP-001`)

## UX Principles
- One primary action per screen; zero raw SSH commands, usernames, or IPs in the primary journey; no false `Connected` state; technical diagnostics behind **Troubleshooting** progressive disclosure.

## 9 Required Screens (Wireframes & Interactions)

1. **JACK Home / My Devices**
   - Lists paired devices (`Name`, `OS Icon`, `Status: Connected / Offline / Expired`), primary CTA `+ Add Device`, secondary `Share This Device`.
   ```text
   +-------------------------------------------------------+
   | [JACK]  My Devices          [Share This Device] [+Add]|
   |-------------------------------------------------------|
   |  [Win] Brother-PC    Paired · Last seen 2m   [Connect]|
   |  [Lin] Lab-Box       Online · Remembered     [Connect]|
   +-------------------------------------------------------+
   ```
2. **Add Device (Client)**
   - Primary: `Scan QR Code` / `Enter Pairing Code` input (`XXXX-XXXX`).
   - Secondary link at bottom: `Advanced: Manual SSH setup`.
3. **Share This Device (Host)**
   - Primary CTA: `Generate Pairing Code`. Shows clear status (`Not sharing` -> `Waiting for pairing`).
4. **QR / Pairing Code (Host)**
   - Displays QR code + large readable code (`7K9M-2P4Q`) + countdown (`Expires in 4:58`) + `Cancel`.
5. **Pairing Request (Host)**
   - Incoming Client identity (`Owner-Linux · Device ID: 9F3A...`), 6-digit SAS match confirmation (`Confirm both screens show: 482 910`), `Deny` / `Continue to Approve`.
6. **Approve Access (Host)**
   - Capability checkboxes (default: `Status & Workspace Read`), Duration selector (`This session only`, `1 hour`, `24 hours`, `Remember this device`), primary `Approve Access`, secondary `Deny`.
7. **Connected (Client & Host)**
   - Green confirmation (`Connected to Brother-PC`), active scope & expiry summary, primary `Open Workspace` / `Disconnect`.
8. **Device Permissions**
   - Manage a paired device: edit capabilities, view expiry, `Revoke Access` (red danger button with confirmation).
9. **Recovery / Troubleshooting**
   - Progressive disclosure for expired code, offline host, firewall blocked, or trust mismatch (`Generate New Code`, `Retry`, `View Technical Diagnostics`, `Unpair & Re-pair`).

# JACK Easy Pairing — Product Contract (`JACK-EP-001`)

> **Classification:** `PROPOSAL` (Design & Product Contract — no implementation in EP-001)  
> **North Star:** *"Install JACK, pair a device, approve access, and start working."*

## 1. Existing Baseline (`FACT`)

- Existing JACK CLI (`bin/jack`, `0.1.1`) manages SSH target aliases (`workstation`, `mac`, custom devices), `doctor`/`diagnose`/`repair`, and optional Tailscale peer discovery.
- Existing JACK Desktop (`PR #32`, `feat/jack-desktop-v01` @ `a812ff8`) provides a Tauri 2 + React + TypeScript GUI over `bin/jack`, but requires users to understand Tailscale state, SSH usernames, IP/hostnames, and `known_hosts` trust.
- Manual SSH remains available as an **advanced and recovery option**; it is not removed.

## 2. Minimum Product Contract

### 2.1 JACK Client
- **Initiate pairing:** Start an Add Device flow via QR scan or short temporary pairing code.
- **Verify remote device identity:** Cryptographically verify the Host's device identity and present human-readable identity / Short Authentication String (SAS) confirmation when required.
- **Request access:** Send an authenticated pairing/access request specifying desired scope (or accepting Host-offered scope).
- **Manage paired devices:** View paired devices, trust status, granted scopes, and expiration.
- **Reconnect under valid authorization:** Reconnect seamlessly while trust and authorization remain valid and unrevoked.
- **Revoke local trust:** Remove local trust for any paired Host immediately without affecting other devices.

### 2.2 JACK Host
- **Generate pairing invitations:** Create short-lived, single-use QR and/or pairing code invitations bound to the Host's cryptographic identity.
- **Receive pairing requests:** Listen on authorized transport endpoints for incoming pairing requests.
- **Authenticate requesting devices:** Verify Client cryptographic identity and invitation binding before prompting the human.
- **Present human approval:** Display requesting device identity, requested capabilities, and duration options to the Host owner.
- **Grant scoped permissions:** Issue least-privilege capability grants (never unrestricted shell/filesystem by default).
- **Expire and revoke access:** Enforce time-bound grants and allow immediate revocation of trust or active sessions.
- **Expose authorized capabilities:** Execute only explicitly approved capabilities within the active grant.

## 3. Core User Journeys (`PROPOSAL`)

1. **Primary User Journey (Auth Code-First, Linux Client <-> Windows Host):**
   - Brother installs JACK on Windows, opens **Share This Device**, and generates a temporary **Auth Code** (`XXXX-XXXX`). *(QR code and Android companion app remain optional and deferred.)*
   - Owner installs JACK on Linux, opens **Add Device**, and enters the temporary **Auth Code**.
   - Both verify the 6-digit **SAS**; brother reviews the requesting device identity, capability (`status.read` in EP-003), and duration (default: **This session only**) and taps **Approve**.
   - Client displays **Connected** *only* after session authentication and authorization complete, without the owner ever entering a Windows username, IP address, SSH port, or SSH key.
   - *(Note: An Auth Code does not solve network reachability; separate-NAT devices without LAN or Tailscale require the deferred EP-006 coordination/relay transport.)*
2. **First-Time Installation Journey:**
   - First launch generates a local per-installation Ed25519 device identity in OS-protected storage, with zero remote pairing or background remote access enabled by default.
3. **Returning-User & Reconnection Journey:**
   - Owner opens **My Devices**, selects a previously paired device with valid trust/grant (`Remember this device` or unexpired time-bound grant), and reconnects without re-pairing. If the grant expired, Client requests fresh Host approval.
4. **Rejected Pairing Journey:**
   - Brother taps **Deny** on **Pairing Request**. Host transitions to `DENIED`; Client shows `"Access request was declined"` and cleans up ephemeral state.
5. **Expired Invitation Journey:**
   - Invitation TTL (e.g., 5 minutes) elapses before completion. Host transitions invitation to `EXPIRED`; Client offers `"Generate a new code on the host and try again"`.
6. **Offline-Device Journey:**
   - Target Host is unreachable on available transports. Client shows `"Device is currently offline"` with a retry action and never displays a false `Connected` state.
7. **Lost-Device Recovery Journey:**
   - Owner or brother loses a device -> opens **Device Permissions** on the surviving device -> clicks **Revoke Device**. Existing trust and grants are invalidated immediately; a reinstalled device receives a new identity and must be re-paired.
8. **Manual SSH Recovery Path:**
   - Accessible from **Add Device -> Advanced: Manual SSH** for power users or environments without JACK Host.

## 4. Non-Functional UX Constraints (`PROPOSAL`)

- Normal UI remains minimal; internal diagnostics (`doctor`, raw logs, fingerprints) live behind progressive disclosure (**Troubleshooting**).
- No raw SSH commands, usernames, or IP addresses in the primary Easy Pairing journey.

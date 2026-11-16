# JACK Easy Pairing — MVP Scope & Roadmap (`JACK-EP-001`)

> **Classification:** `PROPOSAL` (`NO IMPLEMENTATION` in EP-001)

## 1. MVP Vertical Slice

- **Participants:** One Linux JACK Client + One Windows JACK Host (or a justified local cross-platform fixture prior to physical Windows validation).
- **Goal:** Pair via QR or 8-char code + 6-digit SAS, approve access on Host with scoped permissions (`status.read` + `workspace.read`) and duration, establish mTLS session, and display `Connected` — with **zero** unrestricted remote shell and **zero** SSH username/IP entry.

## 2. Phased Roadmap & Exit Criteria

| Phase | Scope | Measurable Exit Criteria |
| --- | --- | --- |
| **EP-002** | **Identity & Local Pairing** | Ed25519 keygen + OS keystore (`libsecret`/DPAPI), QR payload + 8-char code + SPAKE2 + 6-digit SAS, 11-state machine, rate limiting, unit & MITM fixture tests PASS. |
| **EP-003** | **Host & Session Authorization** | TLS 1.3 mTLS Host listener, human approval IPC, scoped capability enforcement (`status.read`, `workspace.read`), expiry, and instant revocation tests PASS. |
| **EP-004** | **QR/Code UX** | 9-screen minimal UI in `desktop/` (with Manual SSH under Advanced), keyboard accessibility, zero raw SSH in primary path, Vitest + Chromium screenshot qualification PASS. |
| **EP-005** | **Linux-Windows Qualification** | Real Linux Client <-> Windows Host pairing over LAN & Tailscale; Windows firewall UX documented; `NOT_TESTED` items closed or explicitly tracked. |
| **EP-006** | **Cross-Network Connectivity** | Optional end-to-end encrypted relay / coordination service for separate-NAT peers without Tailscale; relay compromise threat review PASS. |
| **EP-007** | **Onboarding Integration** | Promote Easy Pairing to primary onboarding in JACK Desktop (`feat/jack-desktop-v01` or successor PR); human UX acceptance PASS. |

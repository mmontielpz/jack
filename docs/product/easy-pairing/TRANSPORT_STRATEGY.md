# JACK Easy Pairing — Transport & Connectivity Security (`JACK-EP-001A`)

> **Classification:** `PROPOSAL` (G6 Transport Security Hardening)

## 1. Separation of Concerns

1. **Discovery (`Unauthenticated Hint`):** mDNS (`_jack-pair._tcp.local`) and Tailscale (`tailscale status --json`) locate candidate `ip:port` endpoints. Discovery results are **never** treated as trust or authentication.
2. **Reachability:** Bounded TCP connect check (`<= 3s`).
3. **Authentication & Session Security (`Transport-Independent`):** TLS 1.3 mTLS + Ed25519 + `RFC 9266` channel-bound SPAKE2. Even if an attacker spoofs mDNS or substitutes an endpoint IP, they cannot forge the pinned `host_pk` or `tls_cb`-bound SPAKE2 transcript!

## 2. Supported Transports & Deferred Cross-NAT Relay

- **LAN / mDNS (`EP-002` / `EP-005`):** Works without internet or Tailscale when both devices share a local subnet without AP isolation.
- **Existing Tailscale (`FACT` + `EP-005`):** Works across networks when both devices already share a Tailnet.
- **Direct Endpoint:** Explicit IPv4/IPv6 + port when reachable.
- **Cross-NAT Relay (`EP-006` — Explicitly Deferred):** Separate-NAT pairing without Tailscale or LAN **cannot** work without a relay/coordination service; JACK reports `ERR_HOST_UNREACHABLE` with honest guidance rather than hanging.

## 3. Endpoint Substitution & MITM Defenses
- QR pins `host_pk`; Code flow binds `tls_cb` (`RFC 9266`) + `host_pk` + `client_pk` into SPAKE2 + 6-digit SAS. Substituting an attacker's endpoint fails key confirmation and SAS verification.

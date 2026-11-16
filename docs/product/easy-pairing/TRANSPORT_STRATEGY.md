# JACK Easy Pairing — Transport & Connectivity Strategy (`JACK-EP-001`)

> **Classification:** `PROPOSAL` (`FACT` notes mark existing capabilities)

## 1. Transport Abstraction

Define a `TransportEndpoint` abstraction so pairing and mTLS sessions work identically over any reachable IP/port endpoint:

1. **Tailscale (`FACT` + `PROPOSAL`):** Reuse `tailscale status --json` to advertise and reach `100.x.y.z` Tailnet IPs when both devices share a tailnet.
2. **Local Network / mDNS (`PROPOSAL`):** Advertise `_jack-pair._tcp.local` (invitation ID prefix only, no secrets) on LAN for zero-config same-WiFi pairing.
3. **Direct Authenticated Endpoint (`PROPOSAL`):** Direct IPv4/IPv6 + ephemeral port when reachable.
4. **Future Coordination / Relay (`PROPOSAL` — Deferred `EP-006`):** End-to-end encrypted relay (TLS 1.3 mTLS inside relay stream) for cross-NAT peers that do not share a Tailnet or LAN.

## 2. Feasibility Without Public Infrastructure

| Scenario | Feasible Without Relay/Public Infra? | Mechanism |
| --- | --- | --- |
| Same LAN / Wi-Fi (Linux Client + Windows Host) | **Yes** | mDNS + direct LAN TCP |
| Different networks, both on same Tailnet | **Yes** (`FACT`) | Existing Tailscale mesh |
| Different networks, one/both behind NAT, **no Tailscale** | **No** (`FACT`) | Requires port forwarding OR Tailscale OR future JACK Relay (`EP-006`) |

## 3. Honest Boundaries

- **QR / pairing codes do NOT eliminate network connectivity requirements.** If two devices are on separate NATs without Tailscale or a relay, pairing will fail cleanly with an actionable connectivity message rather than hanging or claiming success.
- A future JACK Coordination/Relay service (`EP-006`) is justified **only** for users on separate networks who do not wish to install Tailscale; it must never hold plaintext keys or bypass mTLS.

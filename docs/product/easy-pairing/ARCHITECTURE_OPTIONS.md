# JACK Easy Pairing — Architecture Options (`JACK-EP-001`)

> **Classification:** `PROPOSAL` (Comparative evaluation; `FACT` annotations mark verified repository capabilities)

## Option A: SSH + Tailscale Abstraction
Wraps the existing `bin/jack` + OpenSSH + Tailscale stack with automated key generation and remote SSH setup.

- **Security:** Relies on OpenSSH (`BatchMode=yes`, `StrictHostKeyChecking=yes`). However, SSH grants full OS shell access by default unless constrained via fragile `ForceCommand` wrappers. Automating `authorized_keys` deployment requires an initial bootstrap channel.
- **Implementation Complexity:** Low on Linux Client; **high on Windows Host** (requires Windows OpenSSH Server installation, Windows `sshd_config` management, admin UAC elevation, and Windows Firewall rules).
- **Cross-Platform Compatibility:** Weak on Windows Home / non-admin Windows environments.
- **Installation Friction:** High — requires Tailscale account + Windows OpenSSH Server + firewall setup.
- **Network / NAT Traversal:** Delegated entirely to Tailscale (excellent when both users have Tailscale; fails when either lacks Tailscale).
- **Revocation:** Requires mutating remote `authorized_keys` (fails if Host is offline or Client is compromised).
- **Future Agent Integration:** Poor — raw shell is too coarse-grained for least-privilege agent tool calls.

## Option B: Pure Custom JACK Host Service (TLS 1.3 mTLS, No SSH)
Replaces SSH completely with a user-space JACK Host daemon speaking TLS 1.3 (mutual Ed25519 authentication) and a scoped JSON-RPC / gRPC capability protocol.

- **Security:** Strong — mutual Ed25519 authentication, capability-based authorization enforced in-process without exposing an OS shell.
- **Implementation Complexity:** Moderate–High — must build and maintain transport, capability runners, and remote terminal/file protocols from scratch, and loses compatibility with standard SSH workflows.
- **Cross-Platform Compatibility:** High — runs in user space on Linux and Windows without OpenSSH Server.
- **Installation Friction:** Low — single JACK installer, no OpenSSH Server or admin elevation needed for LAN/Tailscale.
- **Revocation:** Instant — Host checks local trust store and active session table on every request.
- **Future Agent Integration:** Excellent — native capability-scoped endpoints.

## Option C: Hybrid Architecture (JACK Pairing/Authorization Service + Scoped Execution & Manual SSH Fallback)
Uses a lightweight user-space **JACK Host service** (standard **TLS 1.3 with Ed25519 mutual authentication** + **SPAKE2 / SAS** pairing) for device identity, pairing, human approval, and scoped capability execution, while preserving existing `bin/jack` + OpenSSH as the **Manual SSH** advanced/recovery path.

- **Security:** High — no OS shell exposed by Easy Pairing; capabilities are explicitly scoped and time-bound; existing SSH security invariants (`StrictHostKeyChecking=yes`, no password storage) remain intact for Manual SSH.
- **Implementation Complexity:** Moderate — reuses existing Tauri 2 + React + Rust codebase (`desktop/`), existing `bin/jack` for Manual SSH, and standard Rust crates (`rustls`, `ed25519-dalek`, `spake2` or `x25519-dalek` / `ring`).
- **Cross-Platform Compatibility:** High — Windows Host runs as a normal user-space process without requiring Windows OpenSSH Server.
- **Installation Friction:** Low for Easy Pairing (no SSH username/IP/key required).
- **Network & NAT Traversal:** Transport-agnostic (`Tailscale` when present, `mDNS/LAN` out of the box, `Direct IP`, and future `Relay` as an explicit later phase).
- **Revocation & Offline/Local Operation:** Works 100% offline on LAN without any cloud coordination server; revocation is local and immediate on the Host.
- **Future Agent Integration:** Strong — agent actions map directly to scoped JACK Host capabilities with human approval.

## Comparison Matrix

| Criterion | Option A (SSH+Tailscale) | Option B (Pure JACK Service) | Option C (Hybrid) |
| --- | --- | --- | --- |
| Zero Windows OpenSSH Server friction | No | Yes | Yes |
| Least-privilege (no default shell) | No | Yes | Yes |
| Preserves existing `bin/jack` Manual SSH | Yes | No | Yes |
| Works on LAN without Tailscale/cloud | Partial | Yes | Yes |
| Instant Host-side revocation | No | Yes | Yes |
| Future Agentic Workspace fit | Weak | Strong | Strong |

# JACK Easy Pairing — Cross-Platform Host Readiness (`JACK-EP-001`)

> **Classification:** `PROPOSAL`

## 1. Safety Boundary Classification

- **Read-Only Detection:** OS/arch, Tailscale presence, LAN interfaces, local JACK identity presence. Runs automatically with zero mutation.
- **User-Level Setup (Automatic on First Launch):** Generate Ed25519 identity in OS keystore, initialize `$JACK_HOME/trusted_peers.json` (`0600`), bind JACK Host listener on user-space ephemeral port when user clicks **Share This Device**.
- **Privileged Setup Requiring Explicit Consent (Never Silent):** Registering an OS background service (`systemd --user` vs system service), adding an OS firewall exception (Windows Defender Firewall prompt or `ufw`/`firewalld` guidance), or installing OpenSSH Server (only if user selects **Advanced: Manual SSH**).
- **Security-Sensitive Operations:** Trusting a peer, granting capabilities, revoking trust, enabling future unattended access.
- **Never Automated Silently:** JACK must **never** silently enable remote shell access, install OpenSSH Server, or open firewall ports without explicit user consent.

## 2. Platform Matrix

### Linux (Arch/CachyOS, Ubuntu/Debian, WSL2)
- **Host Lifecycle:** Foreground when **Share This Device** is open; optional `systemd --user` service for future unattended access.
- **Permissions:** User-owned `$HOME/.config/jack` (`0700` dir, `0600` files); Libsecret/KWallet for private key.
- **Firewall:** Outbound works automatically; inbound LAN/Tailscale may require allowing the JACK Host port in `ufw`/`firewalld` (JACK detects blocked/unreachable state and guides the user).
- **OpenSSH:** Not required for Easy Pairing; required only for **Manual SSH**.

### Windows (Brother's Target)
- **Host Lifecycle:** User-space process inside JACK Desktop (no admin elevation required to run!).
- **Permissions:** Windows DPAPI (`CryptProtectData`) scopes the Ed25519 private key to the brother's Windows user account.
- **Firewall:** First time Windows Host binds a LAN socket, Windows Defender Firewall naturally prompts the user (`Allow access` on Private networks); Tailscale interfaces typically bypass WAN firewall blocks.
- **OpenSSH:** **Not required** for Easy Pairing! (Eliminates the biggest Windows friction point.)

### macOS (Future)
- Keychain storage + App Sandbox / Local Network permission prompt; deferred to post-MVP qualification.

## 3. Updates, Recovery & Uninstallation
- Uninstalling JACK Desktop preserves `trusted_peers.json` and identity by default, with an explicit **Reset / Remove Data** option in Settings (never deleting `~/.ssh` or Tailscale).

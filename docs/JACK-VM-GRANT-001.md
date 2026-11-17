# JACK-VM-GRANT-001: Least-Privilege Dogfood Authorization Boundary

## 1. Overview & Architecture

`JACK-VM-GRANT-001` defines the least-privilege authorization boundary for autonomous Windows/Linux JACK Easy Pairing dogfooding on a developer workstation or dedicated self-hosted runner.

The key architectural finding from `JACK-EP-005-AUTOMATED-AGENT-DOGFOOD-006` is that **almost all VM and GUI dogfood operations are already unprivileged**:
- `jack-win11-dogfood` runs under `qemu:///session` (user-owned libvirt session, not `qemu:///system`).
- VM lifecycle (`start`, `shutdown`, `snapshot-list`, `snapshot-revert`, `change-media`, `screenshot`, `send-key`), VNC input (`127.0.0.1:5900`), ISO creation (`xorriso`), Linux AppImage execution (isolated `HOME`/`XDG_CONFIG_HOME`), and AT-SPI/`uinput` automation require **no root or `qemu:///system` privileges**.
- The **only** host-privileged operation is adding and removing a narrow, temporary UFW rule on `virbr0` so the Windows guest (`192.168.122.10`) can initiate TCP connections to the Linux Easy Pairing Host (`192.168.122.1`, ephemeral port `1024:65535/tcp`) during `Linux Host -> Windows Client` tests.

Accordingly, `JACK-VM-GRANT-001` **does not wrap `virsh` or QEMU in `sudo`**. Instead, it pairs:
1. **Unprivileged Policy Gate (`scripts/dogfood/vm_grant.py`)**: Validates owner-signed grants for scoped VM/harness actions, enforces VM identity binding, path canonicalization, TTL expiration, nonce anti-replay, owner revocation, and JSONL audit logging.
2. **Fixed-Operation Network Helper (`scripts/dogfood/jack-dogfood-net-helper`)**: A minimal, independently reviewable executable that accepts only `--action allow-ephemeral-virbr0` or `--action cleanup-ephemeral-virbr0` with a valid owner-signed grant, and executes only the exact hardcoded `ufw` command with `shell=False`.

---

## 2. Privilege Inventory

| Operation | Classification | Privilege Required |
|---|---|---|
| `virsh -c qemu:///session` (`list`, `dominfo`, `snapshot-list`, `snapshot-revert`, `change-media`, `send-key`, `screenshot`) | Unprivileged | User (`qemu:///session`) |
| VNC pointer/drag input (`127.0.0.1:5900`) | Unprivileged | User |
| ISO packaging (`xorriso -as mkisofs`) | Unprivileged | User |
| Linux AppImage launch (isolated `HOME`/`XDG_CONFIG_HOME`) | Unprivileged | User |
| Linux AT-SPI + `/dev/uinput` automation | Unprivileged | User (session/uinput group) |
| `Windows Host -> Linux Client` pairing over `virbr0` | Unprivileged | User (outgoing host -> `virbr0` allowed) |
| Guest NSIS silent install, PowerShell perf probes, static IP | Guest-only | Windows VM local user |
| Temporary `virbr0` UFW allow/delete (`192.168.122.10 -> 192.168.122.1:1024-65535/tcp`) | Host-privileged | Fixed helper (`jack-dogfood-net-helper`) |
| `qemu:///system`, `NOPASSWD:ALL`, `ufw disable`, public interface rules, `~/.config/jack/config` or `~/.ssh/known_hosts` edits | **Prohibited** | Never granted |

---

## 3. Grant Schema (`JACK-VM-GRANT-001`)

```json
{
  "schema": "JACK-VM-GRANT-001",
  "grant_id": "grant-20261116-001",
  "issuer": "owner",
  "subject": "jack-dogfood-runner",
  "vm_name": "jack-win11-dogfood",
  "vm_uuid": "16fa6324-af26-4145-90b9-c1c8f3ac9f1f",
  "allowed_ops": [
    "vm.session.lifecycle",
    "vm.media.swap",
    "vm.input",
    "app.linux.launch",
    "fw.virbr0.ephemeral.allow",
    "fw.virbr0.ephemeral.cleanup"
  ],
  "allowed_paths": [
    "/tmp/jack-dogfood",
    "/home/<user>/repos/jack"
  ],
  "net_scope": {
    "iface": "virbr0",
    "proto": "tcp",
    "src_ip": "192.168.122.10",
    "dst_ip": "192.168.122.1",
    "port_range": "1024:65535"
  },
  "issued_at": 1763350000,
  "expires_at": 1763353600,
  "nonce": "9f8c7b6a5d4e3f2a1b0c9d8e7f6a5b4c",
  "sig_hmac_sha256": "<hex>"
}
```

### Mandatory Enforcement Rules
1. **Signature**: HMAC-SHA256 over canonical JSON (sorted keys, no whitespace, excluding `sig_hmac_sha256`), verified with `hmac.compare_digest` using an owner-only key (`/etc/jack-dogfood/grant.key`, mode `0600`, owned by `root:root`). The agent **cannot** read this key and **cannot** issue, renew, or extend its own grants.
2. **Expiration**: `issued_at <= now < expires_at`. Maximum recommended TTL: 3600s (1 hour).
3. **Revocation**: `grant_id` checked against `/etc/jack-dogfood/revoked.json` (or `JACK_GRANT_REVOKED_FILE`). Owner revokes any grant immediately by adding its `grant_id`.
4. **Anti-Replay**: `nonce` is recorded in a state file on first privileged use; subsequent attempts with the same `nonce` fail closed.
5. **VM Identity Binding**: `vm_name` (`jack-win11-dogfood`) and `vm_uuid` (`16fa6324-af26-4145-90b9-c1c8f3ac9f1f`) must match.
6. **Path Canonicalization**: Any artifact or ISO path is resolved via `os.path.realpath` and must reside under `allowed_paths`.
7. **Audit Trail**: Every allow/deny decision is appended as structured JSONL (secrets, Auth Codes, and SAS values are never logged).

---

## 4. Threat Model & Mitigations

| Threat | Mitigation |
|---|---|
| **Arbitrary command / shell injection** | `jack-dogfood-net-helper` uses `shell=False` and hardcoded `["ufw", ...]` argv; no user strings reach `ufw`. |
| **Grant forgery / self-renewal by agent** | HMAC key is owned by `root:root` (`0600`); agent has no read access to the signing key. |
| **Grant tampering (e.g. extending TTL or adding ops)** | Canonical JSON HMAC verification rejects any modified field. |
| **Grant replay** | Unique `nonce` per grant tracked in `/run/jack-dogfood/used_nonces.json`. |
| **Stolen/compromised grant after test** | Short TTL + owner revocation list (`/etc/jack-dogfood/revoked.json`). |
| **Broad firewall exposure** | Rule is strictly pinned to `in on virbr0 from 192.168.122.10 to 192.168.122.1 port 1024:65535 proto tcp`; never touches `enp39s0`, public interfaces, or global UFW state. |
| **Lingering firewall rule on crash/Ctrl-C** | Runner installs `SIGINT`/`SIGTERM` handlers and `try/finally` cleanup calling `cleanup-ephemeral-virbr0`. |
| **Production config mutation** | Linux AppImage runs with isolated `HOME` and `XDG_CONFIG_HOME` in `/tmp/jack-dogfood-<run_id>`; runner checks `~/.config/jack/config` and `~/.ssh/known_hosts` hashes before/after. |

---

## 5. One-Time Owner-Approved Setup Plan (Optional for Passwordless `virbr0` Rule)

**Note**: This repository **never** modifies `/etc/sudoers.d`, `/etc/polkit-1`, or host firewall rules automatically.

- **Supervised / Unprivileged Mode (`--mode supervised`)**: Runs `Windows Host -> Linux Client`, `status.read`, `Disconnect`, `Revoke Access` reconciliation, negative paths, and Windows performance **with zero `sudo` or root configuration**.
- **Autonomous Full Mode (`--mode full`)**: Requires the owner to perform this one-time setup on the host:

```bash
# 1. Create root-owned config & key directory
sudo install -d -m 0750 -o root -g root /etc/jack-dogfood
sudo sh -c 'umask 077 && openssl rand -hex 32 > /etc/jack-dogfood/grant.key'
sudo sh -c 'echo "[]" > /etc/jack-dogfood/revoked.json'
sudo chmod 0644 /etc/jack-dogfood/revoked.json

# 2. Install fixed-operation helper as root-owned read-only executable
sudo install -m 0755 -o root -g root scripts/dogfood/jack-dogfood-net-helper /usr/local/libexec/jack-dogfood-net-helper
sudo install -m 0644 -o root -g root scripts/dogfood/vm_grant.py /usr/local/libexec/vm_grant.py

# 3. Allow ONLY this fixed-operation helper via sudoers (no arbitrary shell or virsh)
# Replace <USER> with the dogfood runner user:
echo '<USER> ALL=(root) NOPASSWD: /usr/local/libexec/jack-dogfood-net-helper *' | sudo tee /etc/sudoers.d/jack-dogfood-net
sudo chmod 0440 /etc/sudoers.d/jack-dogfood-net
sudo visudo -cf /etc/sudoers.d/jack-dogfood-net
```

To **revoke** passwordless firewall access at any time:
```bash
sudo rm -f /etc/sudoers.d/jack-dogfood-net /etc/jack-dogfood/grant.key
```

---

## 6. CI vs. Self-Hosted Runner Boundary

- **GitHub-hosted CI (`ci.yml`)**: Runs unit tests for `vm_grant.py`, `jack-dogfood-net-helper --dry-run`, and `run-dogfood.py` helper/redaction/cleanup logic. GitHub-hosted runners **do not** have KVM/Windows 11 VMs and never claim native cross-OS E2E PASS.
- **Self-hosted / Local Workstation**: Runs `python3 scripts/dogfood/run-dogfood.py` against the local `qemu:///session` `jack-win11-dogfood` VM and same-commit Windows NSIS + Linux AppImage artifacts.

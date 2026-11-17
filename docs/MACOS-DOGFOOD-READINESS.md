# JACK Desktop macOS Dogfood Readiness (`JACK-EP-005-MACOS-AGENT-DOGFOOD-007B`)

## 1. Preview Installer Verification & Installation

Download the matching architecture artifact from the GitHub Actions run (`jack-desktop-macos-arm64-preview` for Apple Silicon or `jack-desktop-macos-x64-preview` for Intel):

1. Verify SHA-256 before opening:
   ```bash
   shasum -a 256 -c SHA256SUMS-macos-arm64.txt   # or SHA256SUMS-macos-x64.txt
   ```
2. Mount the `.dmg` and copy `JACK Desktop.app` to `/Applications` (or an isolated test directory).
3. **Unsigned / Ad-hoc Preview Gatekeeper Handling**:
   - Preview builds are **not** Developer ID signed or Apple notarized.
   - Do **not** disable Gatekeeper globally (`spctl --master-disable`) or disable SIP.
   - On first launch, if macOS blocks the unsigned preview, open **System Settings → Privacy & Security → Open Anyway** for `JACK Desktop.app`.
   - On macOS Sequoia+, approve the **Local Network** permission prompt (`NSLocalNetworkUsageDescription`) when testing LAN Easy Pairing.

---

## 2. Isolated Test Configuration

To ensure real-device dogfooding never mutates production `~/.config/jack/config` or `~/.ssh/known_hosts`:

```bash
TEST_HOME="$(mktemp -d /tmp/jack-macos-dogfood.XXXXXX)"
mkdir -p "$TEST_HOME/.config/jack"
HOME="$TEST_HOME" JACK_HOME="$TEST_HOME/.config/jack" open -n "/Applications/JACK Desktop.app"
```

- **Keystore behavior on macOS preview**: `platform_keystore()` uses `InMemoryTestKeystore` on non-Windows targets, meaning Easy Pairing Ed25519 identities are ephemeral in-memory per session (no Keychain ACL prompt or unencrypted private key written to disk).
- **No Tailscale or SSH required**: Easy Pairing Home operates over local LAN/loopback TCP + SPAKE2 + TLS 1.3; Tailscale and Manual SSH remain under Advanced.

---

## 3. macOS ↔ Linux LAN Connectivity Plan

Note: GitHub-hosted macOS runners (`macos-14`) cannot reach your private LAN. Cross-OS testing requires a real macOS host on the same LAN (or reachable test subnet) as the Linux JACK Desktop host:

1. **macOS Host → Linux Client**:
   - On macOS `Share This Device`, select the macOS LAN IP (`en0` Wi-Fi/Ethernet) in **Listen Network** (`127.0.0.1` remains default).
   - Ensure macOS Application Firewall (if enabled) allows incoming connections for `JACK Desktop.app` (no global firewall disable).
   - Linux Client connects to `<MACOS_LAN_IP>:<EPHEMERAL_PORT>`.
2. **Linux Host → macOS Client**:
   - On Linux `Share This Device`, select the Linux LAN IP in **Listen Network**.
   - Ensure Linux UFW allows the narrow temporary LAN/test peer rule (or test-only port) with fail-safe rollback.
   - macOS Client connects to `<LINUX_LAN_IP>:<EPHEMERAL_PORT>`.

---

## 4. Native GUI Automation & Evidence Capture (With Owner Consent)

- **Accessibility / UI Automation**: macOS `System Events` (JXA / AppleScript) requires explicit owner grant in **System Settings → Privacy & Security → Accessibility** for the terminal/agent runner.
- **Screenshots**: `screencapture -x -l <window_id> <out.png>` after confirming no Auth Codes, 6-digit SAS, or personal hostnames/IPs are published unredacted.

---

## 5. Pre-Flight Checklist for `007B`

- [ ] Artifact SHA-256 matches CI `SHA256SUMS-macos-*.txt`
- [ ] `JACK Desktop.app` launches to Easy Pairing Home (no SSH/Tailscale fields on Home)
- [ ] Cold & warm startup, memory, CPU, resize, and Retina scaling recorded
- [ ] `macOS Host -> Linux Client` (SAS match, Host approve, `status.read`, Disconnect, Revoke reconciliation)
- [ ] `Linux Host -> macOS Client` (SAS match, Host approve, `status.read`, Disconnect, Revoke reconciliation)
- [ ] Negative paths: wrong Auth Code, SAS mismatch (`Codes Don't Match`), Host `Deny`, retry
- [ ] `~/.config/jack/config` and `~/.ssh/known_hosts` SHA-256 unchanged on both machines

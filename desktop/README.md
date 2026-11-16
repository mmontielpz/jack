# JACK Desktop V0.1

Desktop GUI for JACK built with **Tauri 2 + React + TypeScript**, connected to the existing JACK CLI (`bin/jack`) through typed IPC commands and strict input validation.

## Build Prerequisites (Linux)

- Node.js 20+ and `npm`
- Rust (`rustc` and `cargo`)
- Tauri 2 system libraries (`webkit2gtk-4.1`, `gtk+-3.0`, `pkg-config`)

## Development & Tests

```bash
cd desktop
npm install
npm run lint
npm run build
npm test
cd src-tauri && cargo test
```

## Packaging (Linux)

```bash
cd desktop
npx tauri build
# Binary: desktop/src-tauri/target/release/jack-desktop
# Bundles: desktop/src-tauri/target/release/bundle/{deb,appimage}/
```

## Security & Data Retention

- All CLI invocations pass explicit `argv` lists with zero shell interpolation.
- SSH credentials (passwords, private keys, tokens, `known_hosts`) are never requested, stored, or modified by JACK Desktop.
- **Reset JACK Configuration (in Settings)** creates a `0600` timestamped backup (`config.bak.<ts>`) and removes only `$HOME/.config/jack/config` (and an empty `.setup-lock` if present), returning the app to the Welcome screen.

## Uninstalling JACK Desktop

Uninstalling the desktop application **preserves** your JACK CLI binary, `$HOME/.config/jack/config`, backups, `~/.ssh`, `known_hosts`, and Tailscale state by default:

- **Arch / CachyOS (`.AppImage`):** Delete the `.AppImage` file and any desktop launcher entry you created.
- **Ubuntu / Debian (`.deb`):**
  ```bash
  sudo apt remove jack-desktop
  ```
- **Windows 11 (WSL2 Ubuntu):** Uninstall the `.deb` package or delete the `.AppImage` inside your WSL2 distribution.

### Optional Manual Data Removal (Separate, Never Automated)

Only if you explicitly want to delete local JACK configuration after uninstalling:

- Allowed JACK config directory: `$HOME/.config/jack/` (or `$JACK_HOME/` if customized)
- **Do NOT delete** `~/.ssh/`, `~/.ssh/known_hosts`, or Tailscale state unless you intentionally manage those separately.

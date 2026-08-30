# jack

`jack` lets you securely jump from your Mac into your Linux workstation.

## Desired UX

After one-time setup:

```bash
jack
```

Under the hood:

```text
Mac → Tailscale → SSH → Workstation
```

No mandatory arguments. No Tailscale or SSH knowledge required for normal use.

## Principles

- Secure by default
- No public SSH exposure
- Minimal dependencies
- Bash / native OS tooling
- Simple setup
- Simple removal

## Status

**Slice 01 — Bootstrap.** This establishes only the project foundation: the
repository layout and the `jack` CLI contract. Tailscale and SSH are not yet
configured, and no host system is modified by this slice.

## Layout

```text
bin/jack                    - the jack CLI
scripts/setup-macos.sh      - future: prepare the Mac client
scripts/setup-workstation.sh - future: prepare the Linux workstation
```

# Security policy

## Reporting a vulnerability

**Private vulnerability reporting is not configured.** GitHub's private
vulnerability reporting endpoint was verified disabled during Slice 12. No
private security email or alternative verified channel is published by JACK.
Do not send sensitive vulnerability details, exploit instructions, credentials,
keys, or private tailnet diagnostics to public issues or pull requests.

The repository owner must enable GitHub private vulnerability reporting or
publish a verified private contact before confidential reports can be accepted.
Check the [repository security page](https://github.com/mmontielpz/jack/security)
for an updated channel before sharing a report. Until one is explicitly available,
withhold sensitive details; a public request to establish a reporting channel
must contain no vulnerability details. This policy does not promise response
times, a security audit, or support for a published release series.

## Trust boundary

- Tailscale supplies network connectivity and its own authentication and access
  controls. JACK does not configure ACLs, authorize peers, or verify that a
  manually supplied hostname belongs to a tailnet.
- OpenSSH handles the SSH session, account authentication, and host-key checks.
  JACK retains the user's existing host-key policy; it does not verify that
  policy is secure or establish trust in a newly presented host key.
- Device configuration selects the destination account and host. It is parsed as
  data, never executed, and holds no passwords, tokens, or private keys. Valid
  syntax does not establish device ownership or authorization.
- Guided setup previews configuration and requires save consent. Its private
  files, lock and atomic replacement reduce accidental writes; they do not
  defend against a compromised account, privileged attacker, or every same-user
  filesystem race. Installers only manage a consented user-level CLI link.
- Discovery treats peer metadata as untrusted and does not execute it. Names and
  OS labels are advisory. Discovery, daemon state and reachability do not prove
  SSH availability, authentication, or authorization. Doctor is diagnostic,
  not a security certification.

JACK does not harden endpoints, protect a compromised device, store/manage SSH
credentials, or replace Tailscale/OpenSSH security maintenance. Keep those
components updated, restrict remote account access, and review host-key changes.
Do not expose SSH publicly merely to use JACK. See the [user guide](docs/guide.md)
for the supported setup and configuration behavior.

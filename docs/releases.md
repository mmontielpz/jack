# Planned release and version policy

This is a policy for future releases, not an announcement of a release.
At Slice 12, JACK has no Git tags, published GitHub releases, packaged version,
or package-registry distribution. The CLI identifies itself as an unversioned
source build; use the checkout commit SHA to identify tested code. Installation
currently links to a source checkout, so updating it changes the installed CLI.

## Proposed versioning

Use SemVer (`MAJOR.MINOR.PATCH`) when versioned releases begin. Before 1.0,
minor versions may introduce documented incompatible changes; patches should
preserve documented commands/configuration and fix defects. Any change to
commands, config or installation behavior needs explicit migration guidance.
A future 1.0 decision should establish the stable compatibility contract;
this document does not claim that milestone or perpetual compatibility.

## Release checklist

Before a maintainer approves a future release:

- Choose and document the version, intended scope, known limitations and any
  migration steps using actual changes. Decide how version identity will be
  represented; no runtime version flag or publishing automation is added here.
- Pass `./scripts/dev-check.sh` and required PR CI `checks`. Record Python/parser
  availability and ShellCheck results. Review docs, links and security implications.
- Perform source-checkout install, repeat install and uninstall acceptance on
  **macOS and Arch Linux / CachyOS**, preserving existing config and keys.
  Run offline checks on each platform; Linux simulations do not replace Mac runs.
- On both supported platforms, exercise `jack doctor`, interactive `jack setup`
  (discovery and manual fallback), non-interactive setup, cancellation/config
  preservation, and `jack --status`. Record any unused-destination warnings.
- Where authorized devices are available, test actual `jack` / `jack mac` SSH
  sessions over Tailscale and host-key behavior. Record unavailable live tests
  explicitly and decide whether they block release; never infer E2E from stubs.
- Verify a working private vulnerability-reporting channel and accurate
  [security policy](../SECURITY.md), contributor guidance and platform claims.
- Confirm license/asset ownership, clean reviewed source, synchronized main,
  and truthful acceptance evidence before separately authorizing tags or publishing.

macOS is primary; Arch/CachyOS is the supported Linux installation path.
Other Linux distributions and Windows are outside current support claims.
This slice does not create tags, publish releases, or configure distribution.

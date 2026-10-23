# Planned release and version policy

The prepared source identity is **0.1.0**, intended for a future `v0.1.0` tag.
This is unpublished release preparation, not a release announcement, completed
acceptance claim or authorization to publish. See the
[stable release notes and acceptance evidence](release-notes-0.1.0.md).
The [historical RC draft](release-notes-0.1.0-rc.1.md) remains unchanged.

## Authoritative identity

`JACK_VERSION` in [bin/jack](../bin/jack) is the single authoritative version
constant. `jack --version` prints `jack 0.1.0` and exits 0 without reading
configuration, writing files, querying Git or invoking network/dependency checks.
It works without HOME or external commands; extra arguments are rejected.
`jack doctor` uses the same constant. No companion VERSION file, runtime Git
lookup, version inference or environment override is used.

Maintainers update that constant intentionally for a new version and update
expected test output, documentation and notes in the same reviewed PR. A version
label alone does not identify an immutable build: record the full checkout SHA
and whether the tree is clean for every candidate-validation run. Source
installation links to the checkout, so updating it immediately changes JACK.

## Proposed versioning

Use SemVer (`MAJOR.MINOR.PATCH`), with candidate suffixes such as `-rc.1`. Before 1.0,
minor versions may introduce documented incompatible changes; patches should
preserve documented commands/configuration and fix defects. Any change to
commands, config or installation behavior needs explicit migration guidance.
A future 1.0 decision should establish the stable compatibility contract;
this document does not claim that milestone or perpetual compatibility.

## Release checklist

Before a maintainer approves a future release:

- Choose and document the version, intended scope, known limitations and any
  migration steps using actual changes. Verify `jack --version` and doctor
  agree with the authoritative constant; freeze and record the tested commit SHA.
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
No publishing automation is provided. Initial validation is source-only: no new
binary installer or package artifact is necessary. Tags, release publication,
archives/checksums or distribution require separate authorization.

## Candidate acceptance evidence

For each supported platform, record OS/Bash/dependency versions, exact commit,
clean-tree status, version output, source install/repeat/uninstall preservation,
doctor result/exit code (including expected optional warnings), interactive and
non-interactive setup, discovery/manual fallback, cancellation, status semantics,
and authorized SSH outcomes in each direction. Do not include credentials or
unredacted tailnet diagnostics. Distinguish actual machines from simulations and
leave unavailable tests explicitly NOT_RUN with an owner disposition.

Draft notes should identify the candidate/version and frozen SHA, supported
platforms, verified changes, migration, dependencies, security reporting, known
limitations and actual acceptance evidence. Populate post-merge SHA/CI facts only
once verified; no release date or successful runtime acceptance may be invented.

### Current acceptance record

The [stable evidence and owner-decision matrix](release-notes-0.1.0.md#stable-acceptance-evidence--slice-14j)
records the tested SHA and distinguishes direct agent/GitHub verification from
owner reports. PASS, PARTIAL, NOT_TESTED and WAIVED have separate meanings;
no owner waiver is inferred. In particular, CachyOS isolated lifecycle/upgrade
success does not establish native Mac fixture preservation, cleanup or upgrade,
and executing stable code inside a session does not verify stable-initiated SSH.
See [open decisions](release-notes-0.1.0.md#open-release-checklist-and-owner-decisions)
before merging or publishing. Additional lifecycle automation is a post-v0.1.0
follow-up; the existing acceptance and authorization gates remain unchanged.

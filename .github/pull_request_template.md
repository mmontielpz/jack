## Change summary

Problem, resulting behavior, and touched subsystems (`bin/jack`, `easy-pairing/`, `desktop/`, `scripts/dogfood/`, `docs/`):

## Test evidence

Record exact outcomes (`PASS` / `FAIL` / `NOT_RUN`):
- [ ] `./scripts/dev-check.sh` (CLI & installer offline suite):
- [ ] `python3 -m unittest discover -s scripts/dogfood -p "test_*.py" -v` (Dogfood & `JACK-VM-GRANT-001` unit tests):
- [ ] `cargo test --manifest-path easy-pairing/Cargo.toml` (Easy Pairing Rust suite):
- [ ] `cargo test --manifest-path desktop/src-tauri/Cargo.toml` (Tauri backend suite):
- [ ] `npm --prefix desktop run lint && npm --prefix desktop run build && npm --prefix desktop test -- --run` (Frontend lint/build/Vitest):

## Platform & E2E validation

Explicitly distinguish:
1. **Offline unit / stub tests**:
2. **CI headless smoke (`ubuntu-24.04`, `ubuntu-26.04`, `windows-latest`, `macos-15`)**:
3. **VM E2E or physical hardware E2E**:
Mark any platform or cross-machine path not exercised in this PR as `NOT_TESTED`.

## Security implications

Describe affected trust boundaries, capability scopes (`status.read`), keystore/configuration writes, or permissions, if any. Never attach credentials, keys, tokens, or unredacted tailnet diagnostics. Suspected vulnerabilities follow [SECURITY.md](../SECURITY.md).

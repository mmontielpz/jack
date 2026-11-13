#!/usr/bin/env bash
# test_governed_repair.sh
# Tests for governed repair, read-only refusal, and independent verification in JACK

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JACK="${SCRIPT_DIR}/../bin/jack"

errors=0

echo "[*] Testing unauthorized repair refusal..."
output="$("${JACK}" repair --json 2>&1)" || true
if [[ "${output}" == *"REFUSED"* && "${output}" == *"READ_ONLY_DEFAULT"* ]]; then
  echo "  [✓] PASS: Unauthorized repair was strictly refused with READ_ONLY_DEFAULT"
else
  echo "  [✗] FAIL: Expected refusal but got: ${output}"
  errors=$((errors + 1))
fi

echo "[*] Testing authorized repair execution & verification..."
output="$("${JACK}" repair --auth-token="test-token-auth" --action="recheck" --json)"
if [[ "${output}" == *"COMPLETED"* && "${output}" == *"VERIFIED"* ]]; then
  echo "  [✓] PASS: Authorized repair completed and independently verified"
else
  echo "  [✗] FAIL: Expected verified completion but got: ${output}"
  errors=$((errors + 1))
fi

echo "[*] Testing invalid repair action rejection..."
output="$("${JACK}" repair --auth-token="test-token-auth" --action="malicious-action" --json 2>&1)" || true
if [[ "${output}" == *"ERROR"* && "${output}" == *"Unknown repair action"* ]]; then
  echo "  [✓] PASS: Unknown repair action safely rejected"
else
  echo "  [✗] FAIL: Expected action error but got: ${output}"
  errors=$((errors + 1))
fi

if [[ "${errors}" -eq 0 ]]; then
  echo "[+] All governed repair tests PASSED cleanly."
  exit 0
else
  echo "[-] ${errors} test(s) FAILED."
  exit 1
fi

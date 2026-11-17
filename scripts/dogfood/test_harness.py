#!/usr/bin/env python3
"""Unit tests for the automated dogfood harness logic (CI-safe, no KVM/VM required)."""

from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

DOGFOOD_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(DOGFOOD_DIR))

SPEC = importlib.util.spec_from_file_location("run_dogfood", DOGFOOD_DIR / "run-dogfood.py")
assert SPEC and SPEC.loader
run_dogfood = importlib.util.module_from_spec(SPEC)
sys.modules["run_dogfood"] = run_dogfood
SPEC.loader.exec_module(run_dogfood)


class TestDogfoodHarness(unittest.TestCase):
    def test_verify_artifacts_sha256_match_and_mismatch(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            p_win = Path(tmp) / "setup.exe"
            p_lin = Path(tmp) / "app.AppImage"
            p_win.write_bytes(b"win-binary")
            p_lin.write_bytes(b"linux-binary")

            hashes = run_dogfood.verify_artifacts(p_win, p_lin)
            res = run_dogfood.verify_artifacts(
                p_win, p_lin, hashes["windows_sha256"], hashes["linux_sha256"]
            )
            self.assertEqual(res, hashes)

            with self.assertRaisesRegex(ValueError, "Windows installer SHA-256 mismatch"):
                run_dogfood.verify_artifacts(p_win, p_lin, "0" * 64, hashes["linux_sha256"])

    def test_redact_sensitive_removes_codes_sas_and_home_paths(self) -> None:
        raw = "Code=RZFQ-M94W SAS=069 441 path=/home/alice/repos/jack/file"
        redacted = run_dogfood.redact_sensitive(raw)
        self.assertNotIn("RZFQ-M94W", redacted)
        self.assertNotIn("069 441", redacted)
        self.assertNotIn("/home/alice", redacted)
        self.assertIn("<AUTH_CODE_REDACTED>", redacted)
        self.assertIn("<SAS_REDACTED>", redacted)
        self.assertIn("/home/<USER>", redacted)

    def test_deterministic_run_id_sanitization(self) -> None:
        self.assertEqual(run_dogfood.make_run_id("ep005 run/01"), "ep005-run-01")

    def test_failsafe_cleanup_runs_once_even_on_exception(self) -> None:
        calls: list[str] = []
        cleanup = run_dogfood.FailSafeCleanup(fw_cleanup_cb=lambda: calls.append("cleaned"))
        try:
            try:
                raise RuntimeError("simulated test crash")
            finally:
                cleanup.run()
        except RuntimeError:
            pass
        cleanup.run()
        self.assertEqual(calls, ["cleaned"])


if __name__ == "__main__":
    unittest.main()

#!/usr/bin/env python3
"""G6 Grant Security Qualification tests for JACK-VM-GRANT-001 and jack-dogfood-net-helper."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

DOGFOOD_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(DOGFOOD_DIR))

from vm_grant import GrantContext, GrantError, issue_grant, verify_grant  # noqa: E402


class TestVmGrantSecurity(unittest.TestCase):
    def setUp(self) -> None:
        self.secret = b"test-owner-only-hmac-key-material"
        self.vm_name = "jack-win11-dogfood"
        self.vm_uuid = "16fa6324-af26-4145-90b9-c1c8f3ac9f1f"
        self.tmp = tempfile.TemporaryDirectory()
        self.tmp_path = Path(self.tmp.name)
        self.allowed_dir = self.tmp_path / "artifacts"
        self.allowed_dir.mkdir(parents=True, exist_ok=True)
        self.audit_file = self.tmp_path / "audit.jsonl"
        self.nonces_file = self.tmp_path / "nonces.json"

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def _make_grant(self, **overrides):
        now = int(time.time())
        kwargs = dict(
            secret_key=self.secret,
            vm_name=self.vm_name,
            vm_uuid=self.vm_uuid,
            allowed_ops=[
                "vm.session.lifecycle",
                "vm.media.swap",
                "fw.virbr0.ephemeral.allow",
                "fw.virbr0.ephemeral.cleanup",
            ],
            allowed_paths=[str(self.allowed_dir)],
            ttl_seconds=600,
            now=now,
        )
        kwargs.update(overrides)
        return issue_grant(**kwargs)

    def test_allowed_operation_and_audit_log(self) -> None:
        grant = self._make_grant()
        artifact = self.allowed_dir / "setup.exe"
        artifact.write_text("ok", encoding="utf-8")

        verify_grant(
            grant,
            GrantContext(self.vm_name, self.vm_uuid, "vm.media.swap", str(artifact)),
            secret_key=self.secret,
            used_nonces_file=self.nonces_file,
            audit_path=self.audit_file,
        )

        entries = [json.loads(line) for line in self.audit_file.read_text(encoding="utf-8").splitlines()]
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]["decision"], "ALLOW")
        self.assertEqual(entries[0]["op"], "vm.media.swap")

    def test_denied_arbitrary_or_ungranted_operation(self) -> None:
        grant = self._make_grant(allowed_ops=["vm.session.lifecycle"])
        for bad_op in ("arbitrary.shell", "vm.system.destroy", "fw.virbr0.ephemeral.allow"):
            with self.assertRaises(GrantError):
                verify_grant(
                    grant,
                    GrantContext(self.vm_name, self.vm_uuid, bad_op),
                    secret_key=self.secret,
                    audit_path=self.audit_file,
                )

    def test_expired_grant_rejected(self) -> None:
        now = int(time.time())
        grant = self._make_grant(now=now - 1000, ttl_seconds=60)
        with self.assertRaisesRegex(GrantError, "ERR_GRANT_EXPIRED"):
            verify_grant(
                grant,
                GrantContext(self.vm_name, self.vm_uuid, "vm.session.lifecycle"),
                secret_key=self.secret,
                now=now,
            )

    def test_revoked_grant_rejected(self) -> None:
        grant = self._make_grant(grant_id="grant-revoked-001")
        with self.assertRaisesRegex(GrantError, "ERR_GRANT_REVOKED"):
            verify_grant(
                grant,
                GrantContext(self.vm_name, self.vm_uuid, "vm.session.lifecycle"),
                secret_key=self.secret,
                revoked_ids={"grant-revoked-001"},
            )

    def test_replayed_grant_rejected(self) -> None:
        grant = self._make_grant(nonce="fixed-nonce-123456")
        ctx = GrantContext(self.vm_name, self.vm_uuid, "vm.session.lifecycle")
        verify_grant(grant, ctx, secret_key=self.secret, used_nonces_file=self.nonces_file)
        with self.assertRaisesRegex(GrantError, "ERR_GRANT_REPLAY"):
            verify_grant(grant, ctx, secret_key=self.secret, used_nonces_file=self.nonces_file)

    def test_tampered_grant_rejected(self) -> None:
        grant = self._make_grant()
        grant["expires_at"] += 3600
        with self.assertRaisesRegex(GrantError, "ERR_GRANT_SIG"):
            verify_grant(
                grant,
                GrantContext(self.vm_name, self.vm_uuid, "vm.session.lifecycle"),
                secret_key=self.secret,
            )

    def test_vm_identity_binding(self) -> None:
        grant = self._make_grant()
        with self.assertRaisesRegex(GrantError, "ERR_GRANT_VM_MISMATCH"):
            verify_grant(
                grant,
                GrantContext("other-vm", self.vm_uuid, "vm.session.lifecycle"),
                secret_key=self.secret,
            )
        with self.assertRaisesRegex(GrantError, "ERR_GRANT_VM_MISMATCH"):
            verify_grant(
                grant,
                GrantContext(self.vm_name, "00000000-0000-0000-0000-000000000000", "vm.session.lifecycle"),
                secret_key=self.secret,
            )

    def test_path_traversal_rejected(self) -> None:
        grant = self._make_grant()
        evil = str(self.allowed_dir / ".." / ".." / "etc" / "passwd")
        with self.assertRaisesRegex(GrantError, "ERR_GRANT_PATH"):
            verify_grant(
                grant,
                GrantContext(self.vm_name, self.vm_uuid, "vm.media.swap", evil),
                secret_key=self.secret,
            )

    def test_net_helper_dry_run_allow_cleanup_and_reject_bad_scope(self) -> None:
        key_file = self.tmp_path / "grant.key"
        key_file.write_text(self.secret.decode("utf-8"), encoding="utf-8")
        revoked_file = self.tmp_path / "revoked.json"
        revoked_file.write_text("[]", encoding="utf-8")

        grant_file = self.tmp_path / "grant.json"
        grant = self._make_grant()
        grant_file.write_text(json.dumps(grant), encoding="utf-8")

        env = os.environ.copy()
        env.update(
            {
                "JACK_GRANT_KEY_FILE": str(key_file),
                "JACK_GRANT_REVOKED_FILE": str(revoked_file),
                "JACK_GRANT_NONCES_FILE": str(self.nonces_file),
                "JACK_GRANT_AUDIT_FILE": str(self.audit_file),
            }
        )
        helper = str(DOGFOOD_DIR / "jack-dogfood-net-helper")

        allow_proc = subprocess.run(
            [sys.executable, helper, "--action", "allow-ephemeral-virbr0", "--grant", str(grant_file), "--dry-run"],
            env=env,
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(allow_proc.returncode, 0, allow_proc.stderr)
        self.assertIn("DRY_RUN: ufw allow in on virbr0 from 192.168.122.10 to 192.168.122.1", allow_proc.stdout)

        # Replay of allow must be denied
        replay_proc = subprocess.run(
            [sys.executable, helper, "--action", "allow-ephemeral-virbr0", "--grant", str(grant_file), "--dry-run"],
            env=env,
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertNotEqual(replay_proc.returncode, 0)
        self.assertIn("ERR_GRANT_REPLAY", replay_proc.stderr)

        # Cleanup remains idempotent with the same grant
        cleanup_proc = subprocess.run(
            [sys.executable, helper, "--action", "cleanup-ephemeral-virbr0", "--grant", str(grant_file), "--dry-run"],
            env=env,
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(cleanup_proc.returncode, 0, cleanup_proc.stderr)
        self.assertIn("DRY_RUN: ufw delete allow in on virbr0", cleanup_proc.stdout)

        # Reject public interface / broad net_scope
        bad_grant = self._make_grant(
            net_scope={"iface": "enp39s0", "proto": "tcp", "src_ip": "0.0.0.0/0", "dst_ip": "0.0.0.0/0", "port_range": "22"}
        )
        bad_file = self.tmp_path / "bad_grant.json"
        bad_file.write_text(json.dumps(bad_grant), encoding="utf-8")
        bad_proc = subprocess.run(
            [sys.executable, helper, "--action", "allow-ephemeral-virbr0", "--grant", str(bad_file), "--dry-run"],
            env=env,
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertNotEqual(bad_proc.returncode, 0)
        self.assertIn("ERR_GRANT_NET_SCOPE", bad_proc.stderr)


if __name__ == "__main__":
    unittest.main()

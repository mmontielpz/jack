#!/usr/bin/env python3
"""JACK-VM-GRANT-001 least-privilege grant issuance, verification, and audit logging."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

SCHEMA_VERSION = "JACK-VM-GRANT-001"

ALLOWED_OPS = frozenset(
    {
        "vm.session.lifecycle",
        "vm.media.swap",
        "vm.input",
        "app.linux.launch",
        "fw.virbr0.ephemeral.allow",
        "fw.virbr0.ephemeral.cleanup",
    }
)

REQUIRED_NET_SCOPE = {
    "iface": "virbr0",
    "proto": "tcp",
    "src_ip": "192.168.122.10",
    "dst_ip": "192.168.122.1",
    "port_range": "1024:65535",
}


class GrantError(PermissionError):
    """Raised when a JACK-VM-GRANT-001 check fails closed."""


@dataclass(frozen=True)
class GrantContext:
    vm_name: str
    vm_uuid: str
    operation: str
    target_path: str | None = None


def _canonical_payload(grant: dict[str, Any]) -> bytes:
    body = {k: v for k, v in grant.items() if k != "sig_hmac_sha256"}
    return json.dumps(body, sort_keys=True, separators=(",", ":")).encode("utf-8")


def sign_payload(grant: dict[str, Any], secret_key: bytes) -> str:
    return hmac.new(secret_key, _canonical_payload(grant), hashlib.sha256).hexdigest()


def issue_grant(
    *,
    secret_key: bytes,
    vm_name: str,
    vm_uuid: str,
    allowed_ops: Iterable[str],
    allowed_paths: Iterable[str],
    ttl_seconds: int = 1800,
    subject: str = "jack-dogfood-runner",
    issuer: str = "owner",
    grant_id: str | None = None,
    nonce: str | None = None,
    now: int | None = None,
    net_scope: dict[str, str] | None = None,
) -> dict[str, Any]:
    if ttl_seconds <= 0 or ttl_seconds > 86400:
        raise ValueError("ttl_seconds must be between 1 and 86400")
    ops = list(allowed_ops)
    invalid = [op for op in ops if op not in ALLOWED_OPS]
    if invalid:
        raise ValueError(f"Unsupported operations: {invalid}")
    ts = int(time.time()) if now is None else int(now)
    grant: dict[str, Any] = {
        "schema": SCHEMA_VERSION,
        "grant_id": grant_id or f"grant-{ts}-{uuid.uuid4().hex[:8]}",
        "issuer": issuer,
        "subject": subject,
        "vm_name": vm_name,
        "vm_uuid": vm_uuid,
        "allowed_ops": ops,
        "allowed_paths": [os.path.realpath(p) for p in allowed_paths],
        "net_scope": dict(net_scope or REQUIRED_NET_SCOPE),
        "issued_at": ts,
        "expires_at": ts + int(ttl_seconds),
        "nonce": nonce or uuid.uuid4().hex,
    }
    grant["sig_hmac_sha256"] = sign_payload(grant, secret_key)
    return grant


def _validate_path(target_path: str, allowed_paths: list[str]) -> None:
    if not allowed_paths:
        raise GrantError("Grant contains no allowed_paths")
    resolved = os.path.realpath(target_path)
    for base in allowed_paths:
        base_resolved = os.path.realpath(base)
        if resolved == base_resolved or resolved.startswith(base_resolved + os.sep):
            return
    raise GrantError(f"Path outside allowed_paths: {target_path}")


def append_audit_log(audit_path: str | Path | None, event: dict[str, Any]) -> None:
    if not audit_path:
        return
    p = Path(audit_path)
    p.parent.mkdir(parents=True, exist_ok=True)
    record = {"ts": int(time.time()), **event}
    with p.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(record, sort_keys=True) + "\n")


def load_json_set(path: str | Path | None) -> set[str]:
    if not path:
        return set()
    p = Path(path)
    if not p.exists():
        return set()
    data = json.loads(p.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise GrantError(f"Expected JSON list in {p}")
    return {str(x) for x in data}


def record_used_nonce(path: str | Path | None, nonce: str) -> None:
    if not path:
        return
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    existing = sorted(load_json_set(p) | {nonce})
    p.write_text(json.dumps(existing) + "\n", encoding="utf-8")


def verify_grant(
    grant: dict[str, Any],
    ctx: GrantContext,
    *,
    secret_key: bytes,
    revoked_ids: set[str] | None = None,
    used_nonces: set[str] | None = None,
    used_nonces_file: str | Path | None = None,
    audit_path: str | Path | None = None,
    now: int | None = None,
    consume_nonce: bool = True,
) -> None:
    """Validate grant signature, expiry, revocation, replay, VM identity, op, and path."""
    grant_id = str(grant.get("grant_id", "<missing>"))

    def deny(reason: str) -> None:
        append_audit_log(
            audit_path,
            {
                "decision": "DENY",
                "grant_id": grant_id,
                "op": ctx.operation,
                "vm_name": ctx.vm_name,
                "reason": reason,
            },
        )
        raise GrantError(reason)

    if grant.get("schema") != SCHEMA_VERSION:
        deny("ERR_GRANT_SCHEMA: unsupported grant schema")

    sig = grant.get("sig_hmac_sha256")
    if not isinstance(sig, str) or not sig:
        deny("ERR_GRANT_SIG: missing signature")
    expected_sig = sign_payload(grant, secret_key)
    if not hmac.compare_digest(sig, expected_sig):
        deny("ERR_GRANT_SIG: signature mismatch (tampered or wrong key)")

    ts = int(time.time()) if now is None else int(now)
    issued_at = grant.get("issued_at")
    expires_at = grant.get("expires_at")
    if not isinstance(issued_at, int) or not isinstance(expires_at, int):
        deny("ERR_GRANT_TIME: invalid timestamps")
    if ts < issued_at:
        deny("ERR_GRANT_TIME: grant not yet valid")
    if ts >= expires_at:
        deny("ERR_GRANT_EXPIRED: grant expired")

    if revoked_ids and grant_id in revoked_ids:
        deny("ERR_GRANT_REVOKED: grant has been revoked by owner")

    nonce = grant.get("nonce")
    if not isinstance(nonce, str) or len(nonce) < 8:
        deny("ERR_GRANT_NONCE: invalid nonce")
    seen_nonces = set(used_nonces or set()) | load_json_set(used_nonces_file)
    if consume_nonce and nonce in seen_nonces:
        deny("ERR_GRANT_REPLAY: nonce already used")

    if grant.get("vm_name") != ctx.vm_name or grant.get("vm_uuid") != ctx.vm_uuid:
        deny("ERR_GRANT_VM_MISMATCH: VM identity mismatch")

    allowed_ops = grant.get("allowed_ops")
    if not isinstance(allowed_ops, list) or ctx.operation not in ALLOWED_OPS:
        deny(f"ERR_GRANT_OP: unknown operation {ctx.operation}")
    if ctx.operation not in allowed_ops:
        deny(f"ERR_GRANT_OP: operation {ctx.operation} not permitted by grant")

    if ctx.operation.startswith("fw.virbr0."):
        if grant.get("net_scope") != REQUIRED_NET_SCOPE:
            deny("ERR_GRANT_NET_SCOPE: net_scope does not match fixed virbr0 policy")

    if ctx.target_path is not None:
        allowed_paths = grant.get("allowed_paths")
        if not isinstance(allowed_paths, list):
            deny("ERR_GRANT_PATH: invalid allowed_paths")
        try:
            _validate_path(ctx.target_path, [str(p) for p in allowed_paths])
        except GrantError as exc:
            deny(f"ERR_GRANT_PATH: {exc}")

    if consume_nonce and used_nonces_file is not None:
        record_used_nonce(used_nonces_file, nonce)

    append_audit_log(
        audit_path,
        {
            "decision": "ALLOW",
            "grant_id": grant_id,
            "op": ctx.operation,
            "vm_name": ctx.vm_name,
        },
    )

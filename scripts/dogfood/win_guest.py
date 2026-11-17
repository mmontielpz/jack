#!/usr/bin/env python3
"""Unprivileged qemu:///session Windows VM automation helpers for JACK dogfooding."""

from __future__ import annotations

import shutil
import subprocess
import time
from pathlib import Path

VIRSH_BASE = ["virsh", "-c", "qemu:///session"]

CHAR_MAP = {
    "a": "KEY_A", "b": "KEY_B", "c": "KEY_C", "d": "KEY_D", "e": "KEY_E",
    "f": "KEY_F", "g": "KEY_G", "h": "KEY_H", "i": "KEY_I", "j": "KEY_J",
    "k": "KEY_K", "l": "KEY_L", "m": "KEY_M", "n": "KEY_N", "o": "KEY_O",
    "p": "KEY_P", "q": "KEY_Q", "r": "KEY_R", "s": "KEY_S", "t": "KEY_T",
    "u": "KEY_U", "v": "KEY_V", "w": "KEY_W", "x": "KEY_X", "y": "KEY_Y",
    "z": "KEY_Z", "0": "KEY_0", "1": "KEY_1", "2": "KEY_2", "3": "KEY_3",
    "4": "KEY_4", "5": "KEY_5", "6": "KEY_6", "7": "KEY_7", "8": "KEY_8",
    "9": "KEY_9", " ": "KEY_SPACE", "-": "KEY_MINUS", "=": "KEY_EQUAL",
    "[": "KEY_LEFTBRACE", "]": "KEY_RIGHTBRACE", ";": "KEY_SEMICOLON",
    "'": "KEY_APOSTROPHE", ",": "KEY_COMMA", ".": "KEY_DOT", "/": "KEY_SLASH",
    "\\": "KEY_BACKSLASH",
}

SHIFT_MAP = {
    "!": "KEY_1", "@": "KEY_2", "#": "KEY_3", "$": "KEY_4", "%": "KEY_5",
    "^": "KEY_6", "&": "KEY_7", "*": "KEY_8", "(": "KEY_9", ")": "KEY_0",
    "_": "KEY_MINUS", "+": "KEY_EQUAL", "{": "KEY_LEFTBRACE", "}": "KEY_RIGHTBRACE",
    ":": "KEY_SEMICOLON", '"': "KEY_APOSTROPHE", "<": "KEY_COMMA",
    ">": "KEY_DOT", "?": "KEY_SLASH", "|": "KEY_BACKSLASH",
}


def run_virsh(*args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run([*VIRSH_BASE, *args], text=True, capture_output=True, check=check)


def verify_vm_and_snapshot(vm_name: str, snapshot_name: str) -> str:
    """Verify VM exists in qemu:///session, is running, and preserves clean snapshot. Returns UUID."""
    info = run_virsh("dominfo", vm_name).stdout
    vm_uuid = ""
    state = ""
    for line in info.splitlines():
        if line.startswith("UUID:"):
            vm_uuid = line.split(":", 1)[1].strip()
        elif line.startswith("State:"):
            state = line.split(":", 1)[1].strip()
    if not vm_uuid:
        raise RuntimeError(f"Could not determine UUID for VM {vm_name}")
    if "running" not in state.lower():
        raise RuntimeError(f"VM {vm_name} is not running (state={state!r})")
    snaps = run_virsh("snapshot-list", vm_name).stdout
    if snapshot_name not in snaps:
        raise RuntimeError(f"Required preserved snapshot {snapshot_name!r} not found on {vm_name}")
    return vm_uuid


def send_keys(vm_name: str, *keys: str, delay: float = 0.05) -> None:
    run_virsh("send-key", vm_name, *keys)
    if delay > 0:
        time.sleep(delay)


def send_text(vm_name: str, text: str) -> None:
    for ch in text:
        if "A" <= ch <= "Z":
            send_keys(vm_name, "KEY_LEFTSHIFT", CHAR_MAP[ch.lower()], delay=0.015)
        elif ch in SHIFT_MAP:
            send_keys(vm_name, "KEY_LEFTSHIFT", SHIFT_MAP[ch], delay=0.015)
        elif ch in CHAR_MAP:
            send_keys(vm_name, CHAR_MAP[ch], delay=0.015)
        else:
            raise ValueError(f"Unsupported guest character: {ch!r}")


def screenshot_png(vm_name: str, out_png: Path) -> Path:
    ppm = out_png.with_suffix(".ppm")
    run_virsh("screenshot", vm_name, str(ppm))
    if shutil.which("ffmpeg"):
        subprocess.run(
            ["ffmpeg", "-y", "-i", str(ppm), str(out_png), "-loglevel", "error"],
            check=True,
        )
        ppm.unlink(missing_ok=True)
        return out_png
    return ppm


def attach_installer_iso(vm_name: str, installer_path: Path, work_dir: Path) -> Path:
    iso_dir = work_dir / "win-iso"
    iso_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(installer_path, iso_dir / installer_path.name)
    iso_path = work_dir / "jack-setup.iso"
    subprocess.run(
        ["xorriso", "-as", "mkisofs", "-J", "-R", "-V", "JACK_SETUP", "-o", str(iso_path), str(iso_dir)],
        check=True,
        capture_output=True,
        text=True,
    )
    run_virsh("change-media", vm_name, "sdc", str(iso_path), "--update", "--live")
    return iso_path

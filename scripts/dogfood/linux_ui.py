#!/usr/bin/env python3
"""Isolated Linux AppImage launcher and AT-SPI UI automation helpers."""

from __future__ import annotations

import os
import subprocess
import time
from pathlib import Path
from typing import Callable


def _import_atspi():
    import gi

    gi.require_version("Atspi", "2.0")
    from gi.repository import Atspi

    return Atspi


def launch_isolated_appimage(appimage_path: Path, run_dir: Path) -> subprocess.Popen[str]:
    iso_home = run_dir / "linux-home"
    (iso_home / ".config").mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    env.update(
        {
            "HOME": str(iso_home),
            "XDG_CONFIG_HOME": str(iso_home / ".config"),
            "APPIMAGE_EXTRACT_AND_RUN": "1",
            "DISPLAY": env.get("DISPLAY", ":0"),
            "WAYLAND_DISPLAY": env.get("WAYLAND_DISPLAY", "wayland-0"),
            "DBUS_SESSION_BUS_ADDRESS": env.get(
                "DBUS_SESSION_BUS_ADDRESS", f"unix:path=/run/user/{os.getuid()}/bus"
            ),
        }
    )
    proc = subprocess.Popen(
        [str(appimage_path)],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    return proc


def _find_jack_app(Atspi):
    desktop = Atspi.get_desktop(0)
    for i in range(desktop.get_child_count()):
        app = desktop.get_child_at_index(i)
        if app and "jack" in (app.get_name() or "").lower():
            return app
    return None


def wait_for_jack_window(timeout: float = 15.0) -> None:
    Atspi = _import_atspi()
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        app = _find_jack_app(Atspi)
        if app and app.get_child_count() > 0:
            return
        time.sleep(0.25)
    raise TimeoutError("Timed out waiting for JACK Desktop AT-SPI window")


def _walk(node, predicate: Callable[[object], bool]):
    if predicate(node):
        return node
    for i in range(node.get_child_count()):
        hit = _walk(node.get_child_at_index(i), predicate)
        if hit is not None:
            return hit
    return None


def click_name(name: str, timeout: float = 5.0) -> None:
    Atspi = _import_atspi()
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        app = _find_jack_app(Atspi)
        if app:
            target = _walk(
                app,
                lambda n: (n.get_name() or "").strip() == name
                and n.get_action_iface() is not None
                and n.get_state_set().contains(Atspi.StateType.ENABLED),
            )
            if target is not None:
                target.get_action_iface().do_action(0)
                return
        time.sleep(0.2)
    raise RuntimeError(f"AT-SPI clickable {name!r} not found or disabled")


def collect_texts() -> list[tuple[str, str, str]]:
    Atspi = _import_atspi()
    app = _find_jack_app(Atspi)
    if not app:
        return []
    out: list[tuple[str, str, str]] = []

    def visit(n) -> None:
        role = n.get_role_name()
        name = (n.get_name() or "").strip()
        txt = ""
        ti = n.get_text_iface()
        if ti:
            cnt = Atspi.Text.get_character_count(ti)
            if cnt > 0:
                txt = Atspi.Text.get_text(ti, 0, cnt).strip()
        if (name or txt) and role != "document web":
            out.append((role, name, txt))
        for i in range(n.get_child_count()):
            visit(n.get_child_at_index(i))

    visit(app)
    return out


def list_bind_options() -> list[str]:
    return [name for role, name, _ in collect_texts() if role == "menu item"]

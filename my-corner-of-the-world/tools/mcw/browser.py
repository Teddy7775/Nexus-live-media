"""Launch Chromium for PDF/PNG rendering.

Uses CHROMIUM_PATH if set, else the Playwright-managed binary at /opt/pw-browsers/chromium,
else whatever Playwright finds on its own (after `playwright install chromium`).
"""
import os
from pathlib import Path


def launch(p):
    exe = os.environ.get("CHROMIUM_PATH")
    if not exe and Path("/opt/pw-browsers/chromium").exists():
        exe = "/opt/pw-browsers/chromium"
    kwargs = {"args": ["--no-sandbox", "--font-render-hinting=none", "--disable-gpu"]}
    if exe:
        kwargs["executable_path"] = exe
    return p.chromium.launch(**kwargs)

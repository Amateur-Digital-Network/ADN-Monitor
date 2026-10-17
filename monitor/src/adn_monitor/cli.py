# ADN Monitor - CLI entrypoint (``adn-monitor`` console script)
#
# Copyright (C) 2026  Rodrigo Pérez, CE5RPY <ce5rpy@qmd.cl>
#
# Derived from FDMR Monitor (OA4DOA), HBMonv2 (SP2ONG), hbmonitor3 (KC1AWV),
# and HBmonitor (Cortney T. Buffington, N0MJS). Original works under GPLv3.

"""Run the monitor: ``adn-monitor`` after pip install, or ``python monitor/monitor.py`` from a checkout."""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from adn_monitor import __version__
from adn_monitor.domain import is_fail
from adn_monitor.infrastructure import create_logger, load_config
from adn_monitor.infrastructure.env_loader import load_project_env
from adn_monitor.infrastructure.fastapi import create_app


def _monitor_dir() -> Path:
    """``monitor/`` in a checkout, else current working directory when installed."""
    pkg = Path(__file__).resolve().parent
    src_dir = pkg.parent
    if src_dir.name == "src":
        candidate = src_dir.parent
        if (candidate / "adn-monitor.yaml").is_file() or (candidate / "monitor.py").is_file():
            return candidate
    return Path.cwd()


def _default_config_path() -> str:
    env = os.environ.get("ADN_CONFIG_PATH", "").strip()
    if env and Path(env).is_file():
        return env
    monitor_dir = _monitor_dir()
    for candidate in (
        monitor_dir / "adn-monitor.yaml",
        Path.cwd() / "adn-monitor.yaml",
        Path("/etc/adn-monitor/adn-monitor.yaml"),
    ):
        if candidate.is_file():
            return str(candidate)
    return str(monitor_dir / "adn-monitor.yaml")


def main() -> None:
    load_project_env(_monitor_dir())

    parser = argparse.ArgumentParser(description="ADN Monitor (FastAPI)")
    parser.add_argument("-c", "--config", default=_default_config_path(), help="adn-monitor.yaml path")
    parser.add_argument("--host", default=None, help="Override MONITOR_APP.LISTEN_HOST")
    parser.add_argument("--port", type=int, default=None, help="Override MONITOR_APP.LISTEN_PORT")
    parser.add_argument("--version", action="version", version=f"adn-monitor {__version__}")
    args = parser.parse_args()

    result = load_config(args.config)
    if is_fail(result):
        print(f"Config error: {result.error}", file=sys.stderr)
        sys.exit(1)
    config = result.value

    log_conf = config.get("LOG", {})
    create_logger(log_conf)

    app_conf = config.get("APP", {})
    host = args.host if args.host is not None else app_conf.get("LISTEN_HOST", "")
    port = args.port if args.port is not None else int(app_conf.get("LISTEN_PORT", 8080))
    bind = host or "0.0.0.0"

    import uvicorn

    uvicorn.run(
        create_app(config, config_path=args.config),
        host=bind,
        port=port,
        log_level=str(log_conf.get("LOG_LEVEL", "info")).lower(),
        # The dashboard compresses each broadcast once (WsHub, /ws?z=1); per-connection deflate
        # would compress it again for every client.
        ws_per_message_deflate=False,
    )


if __name__ == "__main__":
    main()

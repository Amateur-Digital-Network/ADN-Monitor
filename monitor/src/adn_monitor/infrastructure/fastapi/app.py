# ADN Monitor - infrastructure fastapi app
#
# Copyright (C) 2026  Rodrigo Pérez, CE5RPY <ce5rpy@qmd.cl>
#
###############################################################################
#   This program is free software; you can redistribute it and/or modify
#   it under the terms of the GNU General Public License as published by
#   the Free Software Foundation; either version 3 of the License, or
#   (at your option) any later version.
#
#   This program is distributed in the hope that it will be useful,
#   but WITHOUT ANY WARRANTY; without even the implied warranty of
#   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
#   GNU General Public License for more details.
#
#   You should have received a copy of the GNU General Public License
#   along with this program; if not, write to the Free Software Foundation,
#   Inc., 51 Franklin Street, Fifth Floor, Boston, MA 02110-1301  USA
###############################################################################
#
# Derived from FDMR Monitor (OA4DOA), HBMonv2 (SP2ONG), hbmonitor3 (KC1AWV),
# and HBmonitor (Cortney T. Buffington, N0MJS). Original works under GPLv3.

"""FastAPI application factory."""

from __future__ import annotations

import asyncio
import os
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware

from adn_monitor import read_version

from .composition import build_monitor_api
from .runtime import MonitorRuntime
from .routes.aliases_proxy import router as aliases_router
from .routes.auth import router as auth_router
from .routes.config_api import DashboardConfigSource, router as config_router
from .routes.health import router as health_router
from .routes.self_service import router as self_service_router
from .routes.servers_status import router as servers_status_router
from .routes.ws import router as ws_router


@asynccontextmanager
async def _lifespan(app: FastAPI):
    config = app.state.monitor_config
    runtime: MonitorRuntime | None = None
    if config.get("APP", {}).get("AUTO_START_INGEST", True):
        runtime = MonitorRuntime(config)
        runtime.ws_hub.bind_event_loop(asyncio.get_running_loop())
        runtime.start()
        runtime.start_background_tasks()
        app.state.monitor_runtime = runtime
    try:
        yield
    finally:
        if runtime is not None:
            await runtime.stop_background_tasks()
            runtime.stop()
            app.state.monitor_runtime = None


def create_app(config: dict[str, Any], config_path: str | None = None) -> FastAPI:
    """Build the unified monitor HTTP app from ``load_config()`` dict; ``config_path`` lets the dashboard JSON follow YAML edits."""
    app_conf = config.get("APP", {})
    title = config.get("DASHBOARD", {}).get("DASHTITLE", "ADN Monitor")

    app = FastAPI(
        title=str(title),
        version=read_version(),
        lifespan=_lifespan,
    )
    app.state.monitor_config = config
    app.state.dashboard_config = DashboardConfigSource(config, config_path)
    app.state.monitor_api = build_monitor_api(config)

    db = config.get("DB") or {}
    session_secret = (
        os.environ.get("MONITOR_SESSION_SECRET", "").strip()
        or str(db.get("PBKDF2_SALT", "ADN"))
        + "-monitor-session"
    )
    app.add_middleware(SessionMiddleware, secret_key=session_secret, max_age=3600 * 24 * 30)

    origins = app_conf.get("CORS_ORIGINS") or ["*"]
    if isinstance(origins, str):
        origins = [o.strip() for o in origins.split(",") if o.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health_router)
    app.include_router(config_router)
    app.include_router(aliases_router)
    app.include_router(servers_status_router)
    app.include_router(auth_router)
    app.include_router(self_service_router)
    app.include_router(ws_router)
    return app

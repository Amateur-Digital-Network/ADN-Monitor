# ADN Monitor - infrastructure fastapi routes config api
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

"""Dashboard config route (GET /api/config/dashboard)."""

from __future__ import annotations

import logging
import os
from typing import Any

from fastapi import APIRouter, Request

from ....application.dashboard_config import build_dashboard_config
from ....domain import is_fail
from ...config_loader import load_config

logger = logging.getLogger(__name__)

router = APIRouter(tags=["config"])


class DashboardConfigSource:
    """Dashboard JSON, rebuilt when the YAML changes on disk: DASHBOARD and MAP edits need no restart.

    Only this JSON follows the file; ports, DB and ingest keep the config read at start.
    """

    def __init__(self, config: dict[str, Any], config_path: str | None) -> None:
        self._path = config_path
        self._mtime = self._stat()
        self._json = build_dashboard_config(config)

    def _stat(self) -> int | None:
        if not self._path:
            return None
        try:
            return os.stat(self._path).st_mtime_ns
        except OSError:
            return None

    def current(self) -> dict[str, Any]:
        mtime = self._stat()
        if mtime is None or mtime == self._mtime:
            return self._json
        self._mtime = mtime
        result = load_config(self._path)
        if is_fail(result):
            # Usually a save half-way through an edit: keep serving the last good one.
            logger.warning("Dashboard config not reloaded: %s", result.error)
        else:
            self._json = build_dashboard_config(result.value)
        return self._json


@router.get("/api/config/dashboard")
async def dashboard_config(request: Request) -> dict:
    return request.app.state.dashboard_config.current()

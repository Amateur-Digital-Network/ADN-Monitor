# ADN Monitor - infrastructure http httpx fetcher
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

"""httpx adapter for HttpFetcherPort."""

from __future__ import annotations

import httpx

from ... import USER_AGENT
from ...application.ports import HttpFetcherPort
from ...domain import Failure, Result, Success


class HttpxFetcher(HttpFetcherPort):
    def __init__(self, *, timeout: float = 25.0, user_agent: str = USER_AGENT) -> None:
        self._timeout = timeout
        self._user_agent = user_agent

    def fetch(self, url: str) -> Result[tuple[bytes, str | None], str]:
        try:
            with httpx.Client(timeout=self._timeout, follow_redirects=True) as client:
                resp = client.get(url, headers={"User-Agent": self._user_agent})
            if resp.status_code != 200:
                return Failure(f"HTTP {resp.status_code}")
            ct = resp.headers.get("content-type")
            return Success((resp.content, ct))
        except Exception as exc:
            return Failure(str(exc))

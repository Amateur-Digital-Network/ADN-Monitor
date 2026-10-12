# ADN Monitor - infrastructure fastapi ws hub
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

"""WebSocket hub implementing BroadcastPort for ``/ws``."""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass, field
from typing import Any

from fastapi import WebSocket

from ...application import ws_ctable_views
from ...application.dashboard_rows import lastheard_rows, tgcount_rows
from ...application.dashboard_ws import handle_conf_groups, parse_conf_message
from ...application.monitor_controller import MonitorState
from ...application.ports import BroadcastPort
from .db_sync_render import sync_select_for_render, sync_select_tgcount

logger = logging.getLogger("adn-monitor")

GROUP_NAMES = (
    "all_clients",
    "main",
    "bridge",
    "lnksys",
    "opb",
    "statictg",
    "log",
    "lsthrd_log",
    "tgcount",
    "server_info",
)


@dataclass(eq=False)
class WsClient:
    """One browser tab; hashable by object id for set membership in WsHub."""

    websocket: WebSocket
    groups: set[str] = field(default_factory=set)

    async def send_text(self, message: str) -> None:
        await self.websocket.send_text(message)


class WsHub(BroadcastPort):
    """Track subscribers per group and broadcast dashboard messages."""

    def __init__(self) -> None:
        self._clients: dict[str, set[WsClient]] = {g: set() for g in GROUP_NAMES}
        self._lock = asyncio.Lock()
        self._loop: asyncio.AbstractEventLoop | None = None

    def bind_event_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        """Bind the FastAPI/uvicorn loop so Twisted ingest can schedule WS sends."""
        self._loop = loop

    def group_counts(self) -> dict[str, int]:
        return {g: len(self._clients[g]) for g in GROUP_NAMES}

    def is_group_active(self, group: str) -> bool:
        return bool(self._clients.get(group))

    async def register(self, client: WsClient, group: str) -> None:
        async with self._lock:
            self._clients[group].add(client)
            client.groups.add(group)
            self._clients["all_clients"].add(client)

    async def unregister(self, client: WsClient) -> None:
        async with self._lock:
            for group in GROUP_NAMES:
                self._clients[group].discard(client)
            client.groups.clear()

    def _schedule_send(self, client: WsClient, message: str) -> None:
        loop = self._loop
        if loop is None:
            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:
                logger.debug("WS send dropped: no event loop bound")
                return
        coro = self._safe_send(client, message)
        try:
            if asyncio.get_running_loop() is loop:
                loop.create_task(coro)
                return
        except RuntimeError:
            pass
        asyncio.run_coroutine_threadsafe(coro, loop)

    def broadcast(self, message: str, group: str) -> None:
        clients = list(self._clients.get(group, ()))
        if not clients:
            return
        for client in clients:
            self._schedule_send(client, message)

    def send_to_client(self, client: Any, message: str) -> None:
        if not isinstance(client, WsClient):
            return
        self._schedule_send(client, message)

    async def _safe_send(self, client: WsClient, message: str) -> None:
        try:
            await client.send_text(message)
        except Exception as e:
            logger.debug("WS send failed: %s", e)

    async def handle_connection(
        self,
        websocket: WebSocket,
        *,
        state: MonitorState,
        conf_global: dict,
        db_config: dict | None,
        refresh_from_server: Any = None,
    ) -> None:
        await websocket.accept()
        client = WsClient(websocket=websocket)
        logger.info("WebSocket client connected")

        def _send(text: str) -> None:
            asyncio.create_task(self._safe_send(client, text))

        def _render_last_heard() -> None:
            rows = sync_select_for_render(db_config or {}, "last_heard", conf_global.get("LH_ROWS", 20))
            lh_rows = lastheard_rows(rows, conf_global)
            payload = {
                "lastheard": lh_rows,
                "ctable": ws_ctable_views.ctable_for_main(
                    state.CTABLE, empty_masters=bool(conf_global.get("EMPTY_MASTERS", False))
                ),
            }
            _send("i" + json.dumps(payload, default=str))

        def _render_lstheard_log() -> None:
            rows = sync_select_for_render(
                db_config or {},
                "lstheard_log",
                getattr(state, "lastheard_log_rows", 70),
            )
            payload = {"rows": lastheard_rows(rows, conf_global)}
            _send("h" + json.dumps(payload, default=str))

        def _render_tgcount() -> None:
            result = sync_select_tgcount(
                db_config or {},
                conf_global.get("TGC_ROWS", 20),
                conf_global,
            )
            payload = {"rows": tgcount_rows(result)}
            _send("t" + json.dumps(payload, default=str))

        try:
            while True:
                raw = await websocket.receive_text()
                groups = parse_conf_message(raw)
                if groups is None:
                    continue
                for group in groups:
                    if group in GROUP_NAMES:
                        await self.register(client, group)
                handle_conf_groups(
                    state=state,
                    conf_global=conf_global,
                    groups=groups,
                    send=_send,
                    render_last_heard=_render_last_heard,
                    render_lstheard_log=_render_lstheard_log,
                    render_tgcount=_render_tgcount,
                    refresh_from_server=refresh_from_server,
                )
        except Exception as e:
            logger.info("WebSocket closed: %s", e)
        finally:
            await self.unregister(client)

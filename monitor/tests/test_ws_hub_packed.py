# ADN Monitor - tests ws hub packed frames
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

"""A broadcast is compressed once for every tab that opened /ws?z=1, not once per connection."""

from __future__ import annotations

import asyncio
import json
import zlib
from unittest.mock import AsyncMock, MagicMock

from adn_monitor.infrastructure.fastapi import ws_hub
from adn_monitor.infrastructure.fastapi.ws_hub import WsClient, WsHub

_BIG = "h" + json.dumps({"rows": [{"call": "CE5RPY", "tg": 730500 + i} for i in range(60)]})


def _client(*, packed: bool) -> WsClient:
    ws = MagicMock()
    ws.send_text, ws.send_bytes = AsyncMock(), AsyncMock()
    return WsClient(websocket=ws, packed=packed)


async def _broadcast(message: str, clients: list[WsClient]) -> None:
    hub = WsHub()
    hub.bind_event_loop(asyncio.get_running_loop())
    for client in clients:
        await hub.register(client, "lsthrd_log")
    hub.broadcast(message, "lsthrd_log")
    for _ in range(5):
        await asyncio.sleep(0)


def test_one_compression_serves_every_packed_tab(monkeypatch) -> None:
    calls = []
    real = zlib.compress
    monkeypatch.setattr(ws_hub.zlib, "compress", lambda data: calls.append(1) or real(data))
    packed = [_client(packed=True) for _ in range(3)]
    legacy = _client(packed=False)

    asyncio.run(_broadcast(_BIG, [*packed, legacy]))

    assert len(calls) == 1
    for client in packed:
        (frame,), _ = client.websocket.send_bytes.call_args
        assert zlib.decompress(frame).decode() == _BIG
        client.websocket.send_text.assert_not_called()
    legacy.websocket.send_text.assert_awaited_once_with(_BIG)
    legacy.websocket.send_bytes.assert_not_called()


def test_small_messages_stay_text() -> None:
    client = _client(packed=True)
    asyncio.run(_broadcast("l a log line", [client]))
    client.websocket.send_text.assert_awaited_once_with("l a log line")
    client.websocket.send_bytes.assert_not_called()


def test_z_query_marks_the_tab_packed() -> None:
    async def connect(query: dict) -> WsClient:
        hub, seen = WsHub(), []
        real_register = hub.register

        async def register(client: WsClient, group: str) -> None:
            seen.append(client)
            await real_register(client, group)

        hub.register = register  # type: ignore[method-assign]
        ws = MagicMock(query_params=query, accept=AsyncMock())
        ws.receive_text = AsyncMock(side_effect=["conf,log", ConnectionError("closed")])
        await hub.handle_connection(ws, state=MagicMock(), conf_global={}, db_config=None)
        return seen[0]

    assert asyncio.run(connect({"z": "1"})).packed is True
    assert asyncio.run(connect({})).packed is False

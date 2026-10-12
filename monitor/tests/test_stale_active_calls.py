"""A chip stayed lit until the next call on its TG when its END did not match its START."""

from __future__ import annotations

import asyncio
from unittest.mock import MagicMock

from adn_monitor.application.monitor_controller import MonitorState
from adn_monitor.application.rts_update import rts_update_impl
from adn_monitor.infrastructure.fastapi.runtime import MonitorRuntime

TG = 730


def _state(masters: dict[str, int]) -> MonitorState:
    state = MonitorState()
    state.CTABLE = {
        "MASTERS": {
            system: {"PEERS": {peer: {"TS1_STATIC": [], "TS2_STATIC": [str(TG)], 1: {"TS": False, "TRX": ""}, 2: {"TS": False, "TRX": ""}}}}
            for system, peer in masters.items()
        },
        "PEERS": {},
        "OPENBRIDGES": {},
    }
    return state


def _event(state: MonitorState, text: str) -> None:
    alias = MagicMock()
    alias.alias_short.return_value = alias.alias_call.return_value = alias.alias_tgid.return_value = "X"
    rts_update_impl(text.split(","), state, alias, lambda: "12:00")


def _lit(state: MonitorState) -> list[str]:
    return [s for s, m in state.CTABLE["MASTERS"].items() for row in m["PEERS"].values() if row[2]["TS"]]


def test_an_end_naming_another_system_still_ends_its_stream() -> None:
    state = _state({"SYSTEM-3": 730000103})
    _event(state, f"GROUP VOICE,START,RX,SYSTEM-3,222,730000103,7300391,2,{TG}")
    assert _lit(state) == ["SYSTEM-3"]
    _event(state, f"GROUP VOICE,END,RX,SYSTEM,222,730000103,7300391,2,{TG},3.0")
    assert _lit(state) == []


def test_an_end_tx_missing_for_some_hotspots_still_ends_the_call_for_all() -> None:
    state = _state({f"SYSTEM-{n}": 730000100 + n for n in range(5)})
    for n in range(5):
        _event(state, f"GROUP VOICE,START,TX,SYSTEM-{n},333,714009901,7140099,2,{TG}")
    assert len(_lit(state)) == 5
    for n in range(3):
        _event(state, f"GROUP VOICE,END,TX,SYSTEM-{n},333,714009901,7140099,2,{TG},3.0")
    assert _lit(state) == []


def test_an_end_leaves_other_streams_alone() -> None:
    state = _state({"SYSTEM-0": 730000100, "SYSTEM-1": 730000101})
    _event(state, f"GROUP VOICE,START,TX,SYSTEM-0,444,714009901,7140099,2,{TG}")
    _event(state, f"GROUP VOICE,START,TX,SYSTEM-1,555,714009902,7140098,2,{TG}")
    _event(state, f"GROUP VOICE,END,TX,SYSTEM-0,444,714009901,7140099,2,{TG},3.0")
    assert _lit(state) == ["SYSTEM-1"]


def test_stale_chips_expire_without_a_database() -> None:
    """clean_te ran only from the DB maintenance loop: without MySQL a stale chip stayed forever."""
    async def run() -> None:
        runtime = MonitorRuntime({"APP": {"INGEST": "tcp", "AUTO_START_INGEST": False, "FREQUENCY": 0},
                                  "GLOBAL": {}, "OPB_FLTR": {}, "DASHBOARD": {}, "DB": {}})
        runtime._db_ok = False
        runtime.start_background_tasks()
        try:
            assert runtime._memory_task is not None
            await runtime._stop_db_background_tasks()
            assert runtime._memory_task is not None and not runtime._memory_task.cancelled()
        finally:
            for task in asyncio.all_tasks() - {asyncio.current_task()}:
                task.cancel()
    asyncio.run(run())

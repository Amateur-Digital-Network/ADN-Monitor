# ADN Monitor - Dashboard and backend for ADN Systems.
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

"""Main monitor controller: process report messages and coordinate use cases."""

from __future__ import annotations

import json
import logging
import time
from collections import deque
from ..domain import Failure, ReportProtocolError, ServerMode, Success, is_fail
from ..domain.value_objects import Opcode
from .alias_service import AliasService
from .dashboard_config import resolve_map_precision
from .ports import (
    AliasRepository,
    BroadcastPort,
    LastHeardRepository,
    ReportPayloadDecoder,
    TgCountRepository,
)
from .report_mapper import (
    REPORT_PROTOCOL,
    dashboard_state_to_config,
    decode_report_payload,
    merge_routing_delta,
    merge_topology_delta,
    routing_table_to_bridges,
    topology_to_config,
    voice_event_to_csv_parts,
)
from .time_utils import format_display_datetime, format_utc_naive_datetime, time_str

logger = logging.getLogger("adn-monitor")

# Orphan START rows in sys_dict: must survive long PTTs (same cap as clean_sys_dict).
# A prior 3s threshold deleted active calls' START before END arrived → no match, wrong LH.
SYS_DICT_MAX_ENTRIES = 20_000
SYS_DICT_MAX_AGE_SEC = 300


def _uses_v2_report_wire(state: MonitorState) -> bool:
    """True only after HELLO with ``report_protocol: 2`` (new-adn-server 2.x wire)."""
    return getattr(state, "report_protocol", None) == REPORT_PROTOCOL


def _uses_slim_v2_wire(state: MonitorState) -> bool:
    """True after first ``dashboard_state`` (D-25); topology/routing/delta are not used."""
    return bool(getattr(state, "slim_wire", False))


def _include_connected_since(state: MonitorState) -> bool:
    """HELLO received (v1 or v2 handshake); same as adn-monitor 1.0.0."""
    return getattr(state, "server_mode", ServerMode.LEGACY) == ServerMode.V2


def _prune_ctable_not_in_config(ctable: dict, config_dict: dict) -> None:
    """Drop CTABLE rows absent from CONFIG (slim ``dashboard_state`` is a full snapshot)."""
    for key in ("MASTERS", "PEERS", "OPENBRIDGES"):
        section = ctable.get(key, {})
        for name in list(section):
            if name not in config_dict:
                del section[name]


def _apply_config_to_state(
    state: MonitorState,
    config_dict: dict,
    config_global: dict,
) -> None:
    """Apply decoded CONFIG to state (build/update CTABLE). Single responsibility."""
    state.CONFIG = config_dict
    state.CONFIG_RX = format_display_datetime(time.time(), config_global)
    include_since = _include_connected_since(state)
    if _uses_slim_v2_wire(state):
        # D-25: dashboard_state is a full topology snapshot (prune + sync), not CONFIG_SND deltas.
        # Use update after the first snapshot so voice timeslots / openbridge streams are preserved.
        _prune_ctable_not_in_config(state.CTABLE, config_dict)
        if ctable_is_empty(state.CTABLE):
            build_hblink_table(
                state.CONFIG, state.CTABLE, time_str, config_global, include_connected_since=include_since
            )
        else:
            update_hblink_table(
                state.CONFIG, state.CTABLE, time_str, config_global, include_connected_since=include_since
            )
    elif state.CTABLE["MASTERS"]:
        update_hblink_table(
            state.CONFIG, state.CTABLE, time_str, config_global, include_connected_since=include_since
        )
    else:
        build_hblink_table(
            state.CONFIG, state.CTABLE, time_str, config_global, include_connected_since=include_since
        )
    from .tgstats import sync_server_ua_sessions_from_config

    sync_server_ua_sessions_from_config(state, config_dict)
    build_tgstats(state)


def sync_ctable_from_config(state: MonitorState, config_global: dict) -> None:
    """Re-sync CTABLE from cached CONFIG (e.g. after v2 mode is confirmed or CTABLE was wiped)."""
    if not state.CONFIG:
        return
    _apply_config_to_state(state, state.CONFIG, config_global)


def ctable_is_empty(ctable: dict) -> bool:
    """True when CTABLE has no masters, service peers, or openbridges."""
    return not (
        ctable.get("MASTERS") or ctable.get("PEERS") or ctable.get("OPENBRIDGES")
    )


def _apply_dashboard_state_payload(
    state: MonitorState,
    payload: dict,
    config_global: dict,
) -> Success[None]:
    """Apply slim ``dashboard_state`` JSON (TCP STATE_SND or MQTT state topic)."""
    if payload.get("type") != "dashboard_state":
        logger.warning("(REPORT) dashboard_state unexpected type=%s", payload.get("type"))
        return Success(None)
    ts = float(payload.get("ts", 0.0) or 0.0)
    if ts and ts < state.dashboard_state_ts:
        logger.debug(
            "(REPORT) dashboard_state stale ts=%s (have %s)",
            ts,
            state.dashboard_state_ts,
        )
        return Success(None)
    config_dict = dashboard_state_to_config(payload, map_precision=resolve_map_precision(config_global))
    if not config_dict:
        logger.warning("(REPORT) dashboard_state produced empty CONFIG")
        return Success(None)
    state.slim_wire = True
    if ts:
        state.dashboard_state_ts = ts
    _apply_config_to_state(state, config_dict, config_global)
    n_m, n_p, n_o, n_mp = _ctable_counts(state)
    logger.info(
        "(REPORT) dashboard_state applied: CTABLE MASTERS=%d PEERS=%d OPENBRIDGES=%d MASTER_PEERS=%d",
        n_m,
        n_p,
        n_o,
        n_mp,
    )
    return Success(None)


def process_report_json(
    payload: dict,
    state: MonitorState,
    alias_svc: AliasService,
    alias_repo: AliasRepository,
    lastheard_repo: LastHeardRepository,
    tgcount_repo: TgCountRepository,
    broadcast: BroadcastPort | None,
    config_global: dict,
) -> Success[None] | Failure[ReportProtocolError]:
    """Dispatch typed JSON payloads (MQTT ingest shares TCP semantics)."""
    msg_type = payload.get("type")
    if msg_type == "dashboard_state":
        return _apply_dashboard_state_payload(state, payload, config_global)
    if msg_type == "voice_event":
        parts = voice_event_to_csv_parts(payload)
        if parts is None:
            return Success(None)
        return _handle_brdg_event_parts(
            parts,
            state,
            alias_svc,
            alias_repo,
            lastheard_repo,
            tgcount_repo,
            broadcast,
            config_global,
        )
    return Success(None)


def _apply_bridges_to_state(
    state: MonitorState,
    bridges_dict: dict,
    config_global: dict,
) -> None:
    """Apply decoded BRIDGES to state (BTABLE, tgstats). Single responsibility."""
    state.BRIDGES = bridges_dict
    state.BRIDGES_RX = format_display_datetime(time.time(), config_global)
    if config_global.get("BRDG_INC"):
        state.BTABLE["BRIDGES"] = build_bridge_table(state.BRIDGES, time.time())
    build_tgstats(state)


def _ctable_counts(state: MonitorState) -> tuple[int, int, int, int]:
    """Return counts for logging.

    The flat ``CTABLE["PEERS"]`` dict is **only** XLXPEER / standalone PEER systems from
    YAML — not hotspots under MASTER. Hotspots live under ``MASTERS[name]["PEERS"]``.
    ``nested_peers`` sums radio IDs under all masters (what operators usually mean by “hotspots”).
    """
    nested_peers = 0
    for master in state.CTABLE.get("MASTERS", {}).values():
        if isinstance(master, dict):
            nested_peers += len(master.get("PEERS", {}))
    return (
        len(state.CTABLE.get("MASTERS", {})),
        len(state.CTABLE.get("PEERS", {})),
        len(state.CTABLE.get("OPENBRIDGES", {})),
        nested_peers,
    )


class MonitorState:
    """Mutable in-memory state for CTABLE, BTABLE, CONFIG, BRIDGES, log buffer."""

    def __init__(
        self,
        lastheard_log_rows: int = 70,
        empty_masters: bool = False,
        brdg_inc: bool = False,
    ) -> None:
        self.CONFIG: dict = {}
        self.CTABLE: dict = {
            "MASTERS": {},
            "PEERS": {},
            "OPENBRIDGES": {},
            "SETUP": {"LASTHEARD": True},
        }
        self.BTABLE: dict = {"BRIDGES": {}, "SETUP": {}}
        self.BRIDGES: dict = {}
        self.CONFIG_RX = ""
        self.BRIDGES_RX = ""
        self.LOGBUF: deque = deque(100 * [""], 100)
        self.lastheard_log_rows = lastheard_log_rows
        self.empty_masters = empty_masters
        self.brdg_inc = brdg_inc
        self.sys_dict: dict = {"lst_clean": 0}
        # Per-peer static TG from Clients.options (self-service DB); int_id -> {TS1_STATIC, TS2_STATIC}
        self.PEER_OPTIONS: dict = {}
        self.server_mode: ServerMode = ServerMode.LEGACY
        self.server_info: dict = {}
        # True after HELLO (any) or HELLO timeout (no-HELLO peers).
        self.server_mode_confirmed: bool = False
        # None until HELLO: no-HELLO / v1 HELLO (protocol:1) / v2 HELLO (report_protocol:2).
        self.report_protocol: int | None = None
        self.topology_snapshot: dict | None = None
        self.routing_snapshot: dict | None = None
        self.topology_seq: int = 0
        self.routing_seq: int = 0
        self.slim_wire: bool = False
        self.dashboard_state_ts: float = 0.0
        # (master, peer_id, slot) -> tgid — one UA/SINGLE session per peer/slot
        self.UA_DYNAMIC_OWNERS: dict[tuple[str, int, int], int] = {}
        # (master, peer_id, slot) -> (tgid, expires_at) — per-peer OPTIONS TIMER (SINGLE=1)
        self.UA_SESSION_EXPIRES: dict[tuple[str, int, int], tuple[int, float]] = {}
        # (master, peer_id, slot) -> set[tgid] when SINGLE=0 (multi dynamic until TG 4000)
        self.UA_MULTI_TGS: dict[tuple[str, int, int], set[int]] = {}


def process_message(
    raw_message: bytes,
    state: MonitorState,
    alias_svc: AliasService,
    alias_repo: AliasRepository,
    lastheard_repo: LastHeardRepository,
    tgcount_repo: TgCountRepository,
    broadcast: BroadcastPort | None,
    config_global: dict,
    report_decoder: ReportPayloadDecoder,
) -> Success[None] | Failure[ReportProtocolError]:
    """Dispatch by opcode and update state. Returns Result for protocol errors."""
    try:
        message = raw_message.decode("utf-8", "ignore")
    except Exception as e:
        return Failure(ReportProtocolError(str(e)))
    opcode = Opcode.from_message(raw_message)

    if opcode.value == Opcode.TOPOLOGY_SND:
        if not _uses_v2_report_wire(state):
            logger.debug("(REPORT) ignore opcode %s (wire v1 or no-HELLO)", opcode.value.hex())
            return Success(None)
        if _uses_slim_v2_wire(state):
            logger.debug("(REPORT) ignore TOPOLOGY_SND (slim wire uses dashboard_state)")
            return Success(None)

    if opcode.value in (Opcode.ROUTING_TABLE_SND, Opcode.DELTA_SND):
        if not _uses_v2_report_wire(state):
            logger.debug("(REPORT) ignore opcode %s (wire v1 or no-HELLO)", opcode.value.hex())
            return Success(None)

    if opcode.value == Opcode.VOICE_EVENT_SND and not _uses_v2_report_wire(state):
        logger.debug("(REPORT) ignore VOICE_EVENT_SND (wire v1 or no-HELLO)")
        return Success(None)

    if opcode.value == Opcode.CONFIG_SND:
        if not hasattr(state, "CONFIG"):
            logger.error("CONFIG_SND: state is not MonitorState (got %s), skipping", type(state).__name__)
            return Success(None)
        decode_result = report_decoder.decode_config(raw_message)
        if is_fail(decode_result):
            logger.warning("(REPORT) CONFIG_SND decode failed; keeping existing CTABLE")
            return Success(None)
        config_dict = decode_result.value
        _apply_config_to_state(state, config_dict, config_global)
        n_m, n_p, n_o, n_mp = _ctable_counts(state)
        logger.info(
            "(REPORT) CONFIG applied: CTABLE MASTERS=%d PEERS=%d OPENBRIDGES=%d MASTER_PEERS=%d",
            n_m,
            n_p,
            n_o,
            n_mp,
        )
        return Success(None)

    if opcode.value == Opcode.BRIDGE_SND:
        if not hasattr(state, "BRIDGES"):
            logger.error("BRIDGE_SND: state is not MonitorState (got %s), skipping", type(state).__name__)
            return Success(None)
        decode_result = report_decoder.decode_bridges(raw_message)
        if is_fail(decode_result):
            logger.warning("(REPORT) BRIDGE_SND decode failed; keeping existing BTABLE")
            return Success(None)
        bridges_dict = decode_result.value
        _apply_bridges_to_state(state, bridges_dict, config_global)
        n_brg = len(state.BTABLE.get("BRIDGES", {}))
        logger.info("(REPORT) BRIDGES applied: BTABLE BRIDGES=%d", n_brg)
        return Success(None)

    if opcode.value == Opcode.LINK_EVENT:
        return Success(None)

    if opcode.value == Opcode.HELLO:
        if not hasattr(state, "server_mode"):
            logger.warning("HELLO: state has no server_mode attribute; skipping")
            return Success(None)
        try:
            info = json.loads(raw_message[1:].decode("utf-8", errors="replace") or "{}")
            if not isinstance(info, dict):
                info = {}
        except Exception as e:
            logger.warning("(REPORT) HELLO payload not valid JSON (%s); mode=v2 empty info", e)
            info = {}
        state.server_mode = ServerMode.V2
        state.server_info = info
        report_protocol = info.get("report_protocol")
        state.report_protocol = int(report_protocol) if report_protocol is not None else None
        if state.report_protocol == REPORT_PROTOCOL:
            logger.info(
                "(REPORT) HELLO received: report_protocol=%s server=%s version=%s features=%s",
                state.report_protocol,
                info.get("server"),
                info.get("version"),
                info.get("features"),
            )
        elif state.report_protocol is None:
            logger.info(
                "(REPORT) HELLO received (v1 wire, protocol=%s): server=%s version=%s",
                info.get("protocol"),
                info.get("server"),
                info.get("version"),
            )
        else:
            logger.warning(
                "(REPORT) HELLO report_protocol=%s (expected %s)",
                state.report_protocol,
                REPORT_PROTOCOL,
            )
        return Success(None)

    if opcode.value == Opcode.BRDG_EVENT:
        parts = message[1:].split(",")
        return _handle_brdg_event_parts(
            parts,
            state,
            alias_svc,
            alias_repo,
            lastheard_repo,
            tgcount_repo,
            broadcast,
            config_global,
        )

    if opcode.value == Opcode.STATE_SND:
        decode_result = decode_report_payload(raw_message)
        if is_fail(decode_result):
            logger.warning("(REPORT) STATE_SND decode failed")
            return Success(None)
        return _apply_dashboard_state_payload(state, decode_result.value, config_global)

    if opcode.value == Opcode.TOPOLOGY_SND:
        decode_result = decode_report_payload(raw_message)
        if is_fail(decode_result):
            logger.warning("(REPORT) TOPOLOGY_SND decode failed")
            return Success(None)
        topology = decode_result.value
        if topology.get("type") != "topology":
            logger.warning("(REPORT) TOPOLOGY_SND unexpected type=%s", topology.get("type"))
            return Success(None)
        seq = int(topology.get("seq", 0))
        if seq < state.topology_seq:
            logger.debug("(REPORT) TOPOLOGY_SND stale seq=%s (have %s)", seq, state.topology_seq)
            return Success(None)
        state.topology_snapshot = topology
        state.topology_seq = seq
        config_dict = topology_to_config(topology, map_precision=resolve_map_precision(config_global))
        _apply_config_to_state(state, config_dict, config_global)
        n_m, n_p, n_o, n_mp = _ctable_counts(state)
        logger.info(
            "(REPORT) topology applied seq=%s: CTABLE MASTERS=%d PEERS=%d OPENBRIDGES=%d MASTER_PEERS=%d",
            seq,
            n_m,
            n_p,
            n_o,
            n_mp,
        )
        return Success(None)

    if opcode.value == Opcode.ROUTING_TABLE_SND:
        decode_result = decode_report_payload(raw_message)
        if is_fail(decode_result):
            logger.warning("(REPORT) ROUTING_TABLE_SND decode failed")
            return Success(None)
        routing = decode_result.value
        if routing.get("type") != "routing_table":
            logger.warning("(REPORT) ROUTING_TABLE_SND unexpected type=%s", routing.get("type"))
            return Success(None)
        seq = int(routing.get("seq", 0))
        if seq < state.routing_seq:
            logger.debug("(REPORT) ROUTING_TABLE_SND stale seq=%s (have %s)", seq, state.routing_seq)
            return Success(None)
        state.routing_snapshot = routing
        state.routing_seq = seq
        bridges_dict = routing_table_to_bridges(routing)
        _apply_bridges_to_state(state, bridges_dict, config_global)
        n_brg = len(state.BTABLE.get("BRIDGES", {}))
        logger.info("(REPORT) routing_table applied seq=%s: BTABLE BRIDGES=%d", seq, n_brg)
        return Success(None)

    if opcode.value == Opcode.VOICE_EVENT_SND:
        decode_result = decode_report_payload(raw_message)
        if is_fail(decode_result):
            logger.warning("(REPORT) VOICE_EVENT_SND decode failed")
            return Success(None)
        voice = decode_result.value
        if voice.get("type") != "voice_event":
            logger.warning("(REPORT) VOICE_EVENT_SND unexpected type=%s", voice.get("type"))
            return Success(None)
        parts = voice_event_to_csv_parts(voice)
        if parts is None:
            logger.debug("(REPORT) VOICE_EVENT_SND not mapped: family=%s phase=%s", voice.get("call_family"), voice.get("phase"))
            return Success(None)
        return _handle_brdg_event_parts(
            parts,
            state,
            alias_svc,
            alias_repo,
            lastheard_repo,
            tgcount_repo,
            broadcast,
            config_global,
        )

    if opcode.value == Opcode.DELTA_SND:
        decode_result = decode_report_payload(raw_message)
        if is_fail(decode_result):
            logger.warning("(REPORT) DELTA_SND decode failed")
            return Success(None)
        delta = decode_result.value
        if delta.get("type") != "delta":
            logger.warning("(REPORT) DELTA_SND unexpected type=%s", delta.get("type"))
            return Success(None)
        patch = delta.get("patch")
        if not isinstance(patch, dict):
            return Success(None)
        patch_type = patch.get("type")
        since_seq = delta.get("since_seq")
        if patch_type == "topology":
            if _uses_slim_v2_wire(state):
                logger.debug("(REPORT) ignore DELTA_SND topology (slim wire uses dashboard_state)")
                return Success(None)
            if state.topology_snapshot is None:
                logger.warning("(REPORT) DELTA_SND topology patch without prior snapshot")
                return Success(None)
            if since_seq is not None and int(since_seq) != state.topology_seq:
                logger.warning(
                    "(REPORT) DELTA_SND topology since_seq=%s expected %s",
                    since_seq,
                    state.topology_seq,
                )
            merged = merge_topology_delta(state.topology_snapshot, patch)
            seq = int(merged.get("seq", state.topology_seq))
            state.topology_snapshot = merged
            state.topology_seq = seq
            config_dict = topology_to_config(merged, map_precision=resolve_map_precision(config_global))
            _apply_config_to_state(state, config_dict, config_global)
            logger.info("(REPORT) topology delta applied seq=%s", seq)
            return Success(None)
        if patch_type == "routing_table":
            if state.routing_snapshot is None:
                logger.warning("(REPORT) DELTA_SND routing patch without prior snapshot")
                return Success(None)
            if since_seq is not None and int(since_seq) != state.routing_seq:
                logger.warning(
                    "(REPORT) DELTA_SND routing since_seq=%s expected %s",
                    since_seq,
                    state.routing_seq,
                )
            merged = merge_routing_delta(state.routing_snapshot, patch)
            seq = int(merged.get("seq", state.routing_seq))
            state.routing_snapshot = merged
            state.routing_seq = seq
            bridges_dict = routing_table_to_bridges(merged)
            _apply_bridges_to_state(state, bridges_dict, config_global)
            logger.info("(REPORT) routing_table delta applied seq=%s", seq)
            return Success(None)
        logger.warning("(REPORT) DELTA_SND unknown patch type=%s", patch_type)
        return Success(None)

    if opcode.value == Opcode.SERVER_MSG:
        return Success(None)

    return Failure(ReportProtocolError(f"Unknown opcode: {repr(opcode.value)}"))


def _handle_brdg_event_parts(
    parts: list[str],
    state: MonitorState,
    alias_svc: AliasService,
    alias_repo: AliasRepository,
    lastheard_repo: LastHeardRepository,
    tgcount_repo: TgCountRepository,
    broadcast: BroadcastPort | None,
    config_global: dict,
) -> Success[None]:
    """Shared BRDG_EVENT / VOICE_EVENT_SND handler (legacy CSV field list)."""
    if len(parts) < 9:
        logger.debug("(REPORT) bridge event ignored: parts len=%d (need >= 9)", len(parts))
        return Success(None)
    if not isinstance(state, MonitorState) or not getattr(state, "CTABLE", None):
        logger.warning("(REPORT) bridge event ignored: state or CTABLE missing")
        return Success(None)
    logger.debug("(REPORT) bridge event parts[0]=%s parts[1]=%s parts[2]=%s", parts[0], parts[1], parts[2])
    alias_repo.resolve_subscriber_sync(int(parts[6]))
    if parts[0] == "PRIVATE VOICE":
        # Private call destinations are subscriber ids, not talkgroups -- without
        # this, alias_short(destination) in rts_update always misses the cache and
        # falls back to the raw id, even when the subscriber is registered.
        alias_repo.resolve_subscriber_sync(int(parts[8]))
    else:
        alias_repo.resolve_talkgroup_sync(int(parts[8]))
    if parts[0] in ("GROUP VOICE", "PRIVATE VOICE"):
        _event_ts = time.time()
        rts_update(parts, state, alias_svc, time_str)
        skip_persist = parts[2] == "TX" or parts[5] in config_global.get("OPB_FILTER", [])
        if skip_persist:
            logger.debug("(REPORT) bridge event skip persist: dir=%s src=%s", parts[2], parts[5])
        _now = format_display_datetime(_event_ts, config_global, with_tz_abbr=True)
        _wall_db = format_utc_naive_datetime(_event_ts)
        reported_dur = float(parts[9]) if len(parts) > 9 else 0.0
        duration_sec = int(reported_dur)
        if parts[1] == "INGRESS":
            log_message = _format_log_message(_now, parts, alias_svc, None)
        elif parts[1] == "END" and parts[4] in state.sys_dict and state.sys_dict[parts[4]]["sys"] == parts[3]:
            _sd = state.sys_dict[parts[4]]
            del state.sys_dict[parts[4]]
            if not skip_persist:
                wall_dur = max(0.0, _event_ts - _sd["timeST"])
                merged_dur = max(reported_dur, wall_dur)
                duration_sec = int(merged_dur)
                if config_global.get("TGC_INC") and merged_dur > 5:
                    tgcount_repo.insert_tgcount(parts[8], parts[6], str(int(merged_dur)))
                if config_global.get("LH_INC"):
                    lastheard_repo.insert_lstheard_log(
                        merged_dur,
                        parts[0],
                        parts[3],
                        int(parts[8]),
                        int(parts[6]),
                        wall_date_time=_wall_db,
                    )
                    min_duration = config_global.get("DASHBOARD_MIN_DURATION", 3)
                    if merged_dur >= min_duration:
                        lastheard_repo.insert_last_heard(
                            merged_dur,
                            parts[0],
                            parts[3],
                            int(parts[8]),
                            int(parts[6]),
                            wall_date_time=_wall_db,
                        )
            if not state.sys_dict["lst_clean"] or time.time() - state.sys_dict["lst_clean"] >= 3:
                state.sys_dict["lst_clean"] = time.time()
                for k, v in list(state.sys_dict.items()):
                    if k == "lst_clean":
                        continue
                    if time.time() - v["timeST"] >= SYS_DICT_MAX_AGE_SEC:
                        del state.sys_dict[k]
            log_message = _format_log_message(_now, parts, alias_svc, duration_sec)
        elif parts[1] == "START":
            log_message = _format_log_message(_now, parts, alias_svc, None)
            if not skip_persist:
                state.sys_dict[parts[4]] = {"sys": parts[3], "timeST": _event_ts}
        elif parts[1] == "END":
            log_message = _format_log_message(_now, parts, alias_svc, duration_sec)
            if not skip_persist and config_global.get("LH_INC"):
                lastheard_repo.insert_lstheard_log(
                    reported_dur,
                    parts[0],
                    parts[3],
                    int(parts[8]),
                    int(parts[6]),
                    wall_date_time=_wall_db,
                )
                min_duration = config_global.get("DASHBOARD_MIN_DURATION", 3)
                if reported_dur >= min_duration:
                    lastheard_repo.insert_last_heard(
                        reported_dur,
                        parts[0],
                        parts[3],
                        int(parts[8]),
                        int(parts[6]),
                        wall_date_time=_wall_db,
                    )
        elif parts[1] == "END WITHOUT MATCHING START":
            log_message = _format_log_message_unknown_end(_now, parts, alias_svc)
        else:
            log_message = f"{_now[10:19]} Unknown voice bridge log message ({parts[0]})."
        from .rts_update import voice_event_skip_master_downlink_log

        if not voice_event_skip_master_downlink_log(parts, state.CTABLE):
            state.LOGBUF.append(log_message)
            logger.info("(VOICE) %s", log_message)
            if broadcast:
                broadcast.broadcast("l" + log_message, "log")
    elif parts[0] == "UNIT DATA HEADER" and parts[2] != "TX" and parts[5] not in config_global.get("OPB_FILTER", []):
        _u_ts = time.time()
        _u_utc = format_utc_naive_datetime(_u_ts)
        lastheard_repo.insert_last_heard(
            None, parts[0], parts[3], int(parts[8]), int(parts[6]), wall_date_time=_u_utc
        )
        lastheard_repo.insert_lstheard_log(
            None, parts[0], parts[3], int(parts[8]), int(parts[6]), wall_date_time=_u_utc
        )
    return Success(None)


def _format_log_message(
    now: str,
    p: list[str],
    alias_svc: AliasService,
    duration_sec: int | None,
) -> str:
    sub_short = alias_svc.alias_short(int(p[6]))
    tg_name = alias_svc.alias_tgid(int(p[8]))
    base = (
        f"{now[10:19]} {p[0][6:]:5.5s} {p[1]:7.7s} {p[2]:2.2s} SYS: {p[3]:10.10s} STREAM: {p[4]} SRC_ID: {p[5]:5.5s} "
        f"TS: {p[7]} TGID: {p[8]:7.7s} {tg_name:17.17s} "
        f"SUB: {p[6]:9.9s}; {sub_short:18.18s}"
    )
    if duration_sec is not None:
        return base + f" Time: {duration_sec}s"
    return base


def _format_log_message_unknown_end(now: str, p: list[str], alias_svc: AliasService) -> str:
    sub_short = alias_svc.alias_short(int(p[6]))
    tg_name = alias_svc.alias_tgid(int(p[8]))
    return (
        f"{now[10:19]} {p[0][6:]:5.5s} {p[1]:5.5s} {p[2]:2.2s} on SYSTEM: {p[3]:10.10s} STREAM: {p[4]} SRC_ID: {p[5]:5.5s} "
        f"TS: {p[7]} TGID: {p[8]:7.7s} {tg_name:17.17s} "
        f"SUB: {p[6]:9.9s}; {sub_short:18.18s}"
    )


def clean_sys_dict(state: MonitorState) -> None:
    """Remove stale and excess entries from state.sys_dict to prevent memory growth.
    Call periodically (e.g. every 60s); BRDG_EVENT END cleanup alone is not sufficient."""
    # TODO: remove after validating memory fix (MEMORY_LEAK_ANALYSIS.md)
    n_sys = len([k for k in state.sys_dict if k != "lst_clean"])
    logger.info("(monitor) sys_dict size: %d entries", n_sys)
    now = time.time()
    to_del = [
        k for k, v in state.sys_dict.items()
        if k != "lst_clean" and isinstance(v, dict) and (now - v.get("timeST", 0) >= SYS_DICT_MAX_AGE_SEC)
    ]
    for k in to_del:
        del state.sys_dict[k]
    if to_del:
        logger.info("(monitor) clean_sys_dict: removed %d stale entries", len(to_del))
    # Hard cap: evict oldest by timeST if over limit
    if len(state.sys_dict) <= SYS_DICT_MAX_ENTRIES + 1:  # +1 for lst_clean
        return
    entries = [(k, v.get("timeST", 0)) for k, v in state.sys_dict.items() if k != "lst_clean" and isinstance(v, dict)]
    entries.sort(key=lambda x: x[1])
    n_evict = len(entries) - SYS_DICT_MAX_ENTRIES
    for k, _ in entries[:n_evict]:
        del state.sys_dict[k]
    logger.info("(monitor) clean_sys_dict: evicted %d entries (cap=%d)", n_evict, SYS_DICT_MAX_ENTRIES)


def int_id(raw: int | bytes) -> int:
    """Normalize peer id from bytes or int."""
    if isinstance(raw, bytes):
        return int.from_bytes(raw[:4], "big") if len(raw) >= 4 else 0
    return int(raw)


def bytes_4(peer_id: int) -> bytes:
    """Peer id as 4-byte big-endian."""
    return peer_id.to_bytes(4, "big")


def build_hblink_table(
    config: dict,
    stats_table: dict,
    time_str_fn,
    config_global: dict | None = None,
    include_connected_since: bool = False,
) -> None:
    """Populate CTABLE from CONFIG (MASTERS, PEERS, OPENBRIDGES)."""
    from .hblink_table import build_hblink_table_impl
    build_hblink_table_impl(
        config, stats_table, time_str_fn, int_id, config_global, include_connected_since
    )


def update_hblink_table(
    config: dict,
    stats_table: dict,
    time_str_fn,
    config_global: dict | None = None,
    include_connected_since: bool = False,
) -> None:
    """Sync CTABLE with CONFIG (add/remove peers, update connection times)."""
    from .hblink_table import update_hblink_table_impl
    update_hblink_table_impl(
        config, stats_table, time_str_fn, int_id, bytes_4, include_connected_since
    )


def build_bridge_table(bridges: dict, now: float) -> dict:
    """Build BTABLE from BRIDGES dict."""
    from .bridge_table import build_bridge_table_impl
    return build_bridge_table_impl(bridges, now, int_id)


def build_tgstats(state: MonitorState) -> None:
    """Fill CTABLE SERVER/TS1/TS2 and SINGLE_TS1/SINGLE_TS2 from CONFIG and BRIDGES."""
    from .tgstats import build_tgstats_impl
    build_tgstats_impl(state, time_str)


def rts_update(
    p: list[str],
    state: MonitorState,
    alias_svc: AliasService,
    time_str_fn,
) -> None:
    """Update timeslot state from GROUP VOICE START/END."""
    from .rts_update import rts_update_impl
    rts_update_impl(p, state, alias_svc, time_str_fn)

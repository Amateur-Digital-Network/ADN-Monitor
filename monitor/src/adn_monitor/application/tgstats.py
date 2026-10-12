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

"""Build TG stats (SERVER TS1/TS2, SINGLE_TS1/SINGLE_TS2) per peer OPTIONS + voice sessions."""

from __future__ import annotations

import re
import time

from adn_monitor.domain.ua_timer import (
    UA_SESSION_NEVER_EXPIRES_AT,
    normalize_ua_timer_minutes,
    ua_session_expires_is_infinite,
    ua_session_never_expires,
    ua_timer_is_infinite,
)

from .monitor_controller import MonitorState


def _is_service_voice_tgid(tgid: int) -> bool:
    """TG 4000 (reset) and 9990–9999 (echo/service) are not UA dynamic sessions."""
    t = int(tgid)
    return t == 4000 or (9990 <= t <= 9999)


def _static_tg_list(value) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [x.strip() for x in value.split(",") if x.strip()]
    if isinstance(value, list):
        return [str(x).strip() for x in value if str(x).strip()]
    text = str(value).strip()
    return [text] if text else []


def parse_options_to_static(options_str: str | None) -> dict:
    """Parse OPTIONS (TS1/TS2 static lists, TIMER, SINGLE).

    Supports classic (``TS1=262,110;TS2=730;``) and OpenSpot / DMR+
    (``TS1_1=262;TS1_2=110;TS2_1=714;``) formats. Unknown keys are ignored.
    """
    out: dict = {"TS1_STATIC": [], "TS2_STATIC": []}
    if not options_str or not isinstance(options_str, str):
        return out
    text = re.sub(r"['\"]", "", options_str.strip())
    kv: dict[str, str] = {}
    for part in text.split(";"):
        part = part.strip()
        if "=" not in part:
            continue
        key, value = part.split("=", 1)
        kv[key.strip().upper()] = value.strip()
    ts1_parts: list[str] = []
    if "TS1_1" in kv:
        ts1_parts.append(kv["TS1_1"])
        for i in range(2, 10):
            p = kv.get(f"TS1_{i}")
            if p:
                ts1_parts.append(p)
    elif "TS1" in kv:
        ts1_parts = [x.strip() for x in kv["TS1"].split(",") if x.strip()]
    ts2_parts: list[str] = []
    if "TS2_1" in kv:
        ts2_parts.append(kv["TS2_1"])
        for i in range(2, 10):
            p = kv.get(f"TS2_{i}")
            if p:
                ts2_parts.append(p)
    elif "TS2" in kv:
        ts2_parts = [x.strip() for x in kv["TS2"].split(",") if x.strip()]
    out["TS1_STATIC"] = ts1_parts
    out["TS2_STATIC"] = ts2_parts
    if "TIMER" in kv:
        try:
            out["TIMER"] = float(kv["TIMER"].strip())
        except ValueError:
            pass
    if "SINGLE" in kv:
        out["SINGLE"] = kv["SINGLE"].strip()
    return out


def _masters_for_bridge_system(ctable: dict, sys_name: str) -> list[str]:
    """Map inject ``SYSTEM`` bridge legs to virtual ``SYSTEM-N`` monitor masters."""
    masters = ctable.get("MASTERS", {})
    if sys_name in masters:
        return [sys_name]
    prefix = f"{sys_name}-"
    virtual = sorted(n for n in masters if isinstance(n, str) and n.startswith(prefix))
    return virtual


def _base_system_name(master_name: str) -> str:
    """``SYSTEM-3`` inject virtual master → YAML/logical ``SYSTEM``."""
    if "-" in master_name:
        prefix, suffix = master_name.rsplit("-", 1)
        if suffix.isdigit():
            return prefix
    return master_name


def _yaml_system_config(state: MonitorState, master_name: str) -> dict:
    """YAML block for inject target (``SYSTEM``), not virtual ``SYSTEM-N`` row names."""
    base = _base_system_name(master_name)
    cfg = (state.CONFIG or {}).get(base)
    if isinstance(cfg, dict):
        return cfg
    for _name, block in (state.CONFIG or {}).items():
        if isinstance(block, dict) and block.get("MODE") == "MASTER":
            return block
    return {}


def _config_block_for_master(state: MonitorState, master_name: str) -> dict:
    """CONFIG block for ``SYSTEM-N`` virtual master, else inject base ``SYSTEM``."""
    config = state.CONFIG or {}
    block = config.get(master_name)
    if isinstance(block, dict):
        return block
    base = _base_system_name(master_name)
    fallback = config.get(base)
    return fallback if isinstance(fallback, dict) else {}


def _peer_cfg_from_config(state: MonitorState, master_name: str, peer_id: int) -> dict:
    peer_key = peer_id.to_bytes(4, "big") if isinstance(peer_id, int) else peer_id
    peer_cfg = _config_block_for_master(state, master_name).get("PEERS", {}).get(peer_key, {})
    return peer_cfg if isinstance(peer_cfg, dict) else {}


def _peer_options_text_from_config(state: MonitorState, master_name: str, peer_id: int) -> str | None:
    """Live RPTO OPTIONS on server CONFIG for this virtual master peer."""
    raw = _peer_cfg_from_config(state, master_name, peer_id).get("OPTIONS")
    if raw is None:
        return None
    if isinstance(raw, bytes):
        return raw.decode("utf-8", errors="replace")
    return str(raw)


def _merged_peer_option_fields(state: MonitorState, master_name: str, peer_id: int) -> dict:
    """Runtime OPTIONS from server CONFIG only; YAML fills SINGLE/TIMER gaps."""
    merged: dict = {}
    opt_text = _peer_options_text_from_config(state, master_name, peer_id)
    if opt_text:
        merged.update(parse_options_to_static(opt_text))
    peer_cfg = _peer_cfg_from_config(state, master_name, peer_id)
    if "SINGLE_MODE" in peer_cfg and "SINGLE" not in merged:
        merged["SINGLE"] = "1" if peer_cfg["SINGLE_MODE"] else "0"
    if "UA_TIMER_MIN" in peer_cfg and "TIMER" not in merged:
        try:
            timer = float(peer_cfg["UA_TIMER_MIN"])
        except (TypeError, ValueError):
            pass
        else:
            if not ua_timer_is_infinite(timer):
                merged["TIMER"] = timer
    return merged


def _resolve_peer_single_and_timer(
    state: MonitorState,
    master_name: str,
    peer_id: int,
) -> tuple[bool, float]:
    """Peer OPTIONS ``SINGLE``/``TIMER`` when present; else YAML ``SINGLE_MODE``/``DEFAULT_UA_TIMER``."""
    yaml_cfg = _yaml_system_config(state, master_name)
    fields = _merged_peer_option_fields(state, master_name, peer_id)
    if "SINGLE" in fields:
        single = str(fields["SINGLE"]).strip() == "1"
    else:
        single = bool(yaml_cfg.get("SINGLE_MODE", False))
    if "TIMER" in fields:
        try:
            timer = normalize_ua_timer_minutes(
                float(fields["TIMER"]),
                default_minutes=float(yaml_cfg.get("DEFAULT_UA_TIMER", 10)),
            )
        except (TypeError, ValueError):
            timer = normalize_ua_timer_minutes(
                float(yaml_cfg.get("DEFAULT_UA_TIMER", 10)),
                default_minutes=10.0,
            )
    else:
        timer = normalize_ua_timer_minutes(
            float(yaml_cfg.get("DEFAULT_UA_TIMER", 10)),
            default_minutes=10.0,
        )
    return single, timer


def _peer_single_mode(state: MonitorState, master_name: str, peer_id: int) -> bool:
    single, _ = _resolve_peer_single_and_timer(state, master_name, peer_id)
    return single


def _peer_static_slot_tgs(state: MonitorState, master_name: str, peer_id: int, slot: int) -> list[str]:
    ctable = state.CTABLE or {}
    row = ctable.get("MASTERS", {}).get(master_name, {}).get("PEERS", {}).get(peer_id, {})
    if not isinstance(row, dict):
        return []
    return [str(x) for x in (row.get(f"TS{slot}_STATIC") or [])]


def _is_static_tg(
    state: MonitorState,
    master_name: str,
    peer_id: int,
    slot: int,
    tgid: int,
) -> bool:
    return str(tgid) in _peer_static_slot_tgs(state, master_name, peer_id, slot)


def _peer_timer_minutes(state: MonitorState, master_name: str, peer_id: int) -> float:
    """Per-peer OPTIONS TIMER (minutes), else YAML ``DEFAULT_UA_TIMER``."""
    _, timer = _resolve_peer_single_and_timer(state, master_name, peer_id)
    return timer


def _session_key(master_name: str, peer_id: int, slot: int) -> tuple[str, int, int]:
    return (master_name, peer_id, slot)


def _active_tgid_from_peer_ts(peer_ts: dict) -> int | None:
    """TG/destination id from a live CTABLE timeslot row (DEST / TG fields).

    A resolved display name can contain digits of its own (most ham callsigns do,
    e.g. "CE5RPY") -- prefer the id in "(...)" (the convention every display format
    here uses, e.g. "CE5RPY, Rodrigo (7300391)") over a bare first-digit-run match,
    so a callsign's embedded digit is never mistaken for the real id.
    """
    if not peer_ts.get("TS"):
        return None
    raw = peer_ts.get("TG") or peer_ts.get("DEST") or ""
    if isinstance(raw, int):
        return raw
    text = str(raw).replace("&nbsp;", " ")
    paren = re.search(r"\((\d+)\)", text)
    if paren:
        return int(paren.group(1))
    match = re.search(r"\d+", text)
    return int(match.group()) if match else None


def clear_peer_voice_ts_slot(peer_ts: dict) -> None:
    """Reset one CTABLE voice timeslot chip (same fields as BRDG END)."""
    peer_ts["TS"] = False
    peer_ts["TYPE"] = peer_ts["SUB"] = peer_ts["CALL"] = ""
    peer_ts["SRC"] = peer_ts["DEST"] = peer_ts["TG"] = peer_ts["TRX"] = ""
    peer_ts.pop("STREAM", None)


def clear_voice_ts_for_stream(ctable: dict, stream_id: str) -> None:
    """Clear every master chip still showing this stream, whatever SYSTEM-N or peer its END named.

    A stream ends once: an END whose system or peer does not match its START used to leave
    the chip lit until the next END on that TG.
    """
    for master in (ctable.get("MASTERS") or {}).values():
        for peer_row in (master.get("PEERS") or {}).values() if isinstance(master, dict) else ():
            for slot in (1, 2):
                peer_ts = peer_row.get(slot) if isinstance(peer_row, dict) else None
                if isinstance(peer_ts, dict) and peer_ts.get("STREAM") == stream_id:
                    clear_peer_voice_ts_slot(peer_ts)


def clear_voice_ts_for_destination(peer_row: dict, destination: int) -> None:
    """Clear every slot showing this TG (cross-slot START vs END safety)."""
    for slot in (1, 2):
        peer_ts = peer_row.get(slot)
        if isinstance(peer_ts, dict) and _active_tgid_from_peer_ts(peer_ts) == destination:
            clear_peer_voice_ts_slot(peer_ts)


def _is_echo_service_live_tgid(tgid: int) -> bool:
    """Echo/on-demand 9990–9999: live TRX chips must survive build_tgstats prune."""
    t = int(tgid)
    return 9990 <= t <= 9999


def prune_voice_ts_not_in_static(
    state: MonitorState,
    master_name: str,
    peer_id: int,
    peer_row: dict,
) -> None:
    """Drop live QSO chips for static TGs removed from peer OPTIONS (self-service)."""
    allowed = {
        str(x).strip()
        for x in (peer_row.get("TS1_STATIC") or []) + (peer_row.get("TS2_STATIC") or [])
        if str(x).strip()
    }
    multi = getattr(state, "UA_MULTI_TGS", None) or {}
    owners = getattr(state, "UA_DYNAMIC_OWNERS", None) or {}
    for slot in (1, 2):
        peer_ts = peer_row.get(slot)
        if not isinstance(peer_ts, dict) or not peer_ts.get("TS"):
            continue
        tgid = _active_tgid_from_peer_ts(peer_ts)
        if tgid is None:
            continue
        tg_str = str(tgid)
        if _is_echo_service_live_tgid(tgid):
            continue
        if peer_ts.get("TYPE") == "PRIVATE VOICE":
            # Private call destinations are subscriber IDs, never a hotspot's static
            # TG -- this check would otherwise wipe the chip on the very next
            # build_tgstats pass (fires after every voice event, START included).
            continue
        if tg_str in allowed:
            continue
        key = _session_key(master_name, peer_id, slot)
        if owners.get(key) == tgid:
            continue
        if tg_str in {str(x) for x in multi.get(key, set())}:
            continue
        clear_peer_voice_ts_slot(peer_ts)


def _ensure_session_maps(state: MonitorState) -> tuple[dict, dict, dict]:
    owners = getattr(state, "UA_DYNAMIC_OWNERS", None)
    if owners is None:
        state.UA_DYNAMIC_OWNERS = {}
        owners = state.UA_DYNAMIC_OWNERS
    expires = getattr(state, "UA_SESSION_EXPIRES", None)
    if expires is None:
        state.UA_SESSION_EXPIRES = {}
        expires = state.UA_SESSION_EXPIRES
    multi = getattr(state, "UA_MULTI_TGS", None)
    if multi is None:
        state.UA_MULTI_TGS = {}
        multi = state.UA_MULTI_TGS
    return owners, expires, multi


def clear_peer_ua_sessions(
    state: MonitorState,
    master_name: str,
    peer_id: int,
    *,
    slot: int | None = None,
) -> None:
    """Clear UA/SINGLE state for a peer (TG 4000, reconnect)."""
    owners, expires, multi = _ensure_session_maps(state)
    for store in (owners, expires, multi):
        for key in list(store.keys()):
            if key[0] != master_name or key[1] != peer_id:
                continue
            if slot is not None and key[2] != slot:
                continue
            store.pop(key, None)


def register_ua_session(
    state: MonitorState,
    master_name: str,
    peer_id: int,
    slot: int,
    tgid: int,
) -> None:
    """Track which TG this peer keyed; SINGLE=1 uses per-peer OPTIONS TIMER."""
    if _is_service_voice_tgid(tgid):
        return
    owners, expires, multi = _ensure_session_maps(state)
    key = _session_key(master_name, peer_id, slot)
    if _peer_single_mode(state, master_name, peer_id):
        owners[key] = tgid
        timer_min = _peer_timer_minutes(state, master_name, peer_id)
        if ua_timer_is_infinite(timer_min):
            expires[key] = (tgid, UA_SESSION_NEVER_EXPIRES_AT)
        else:
            expires[key] = (tgid, time.time() + timer_min * 60.0)
        multi.pop(key, None)
        return
    multi.setdefault(key, set()).add(tgid)
    owners.pop(key, None)
    expires.pop(key, None)


def _session_active(
    state: MonitorState,
    master_name: str,
    peer_id: int,
    slot: int,
    tgid: int,
) -> tuple[bool, float | None]:
    """Return (active, expires_at) for a SINGLE=1 peer session."""
    expires = getattr(state, "UA_SESSION_EXPIRES", None) or {}
    key = _session_key(master_name, peer_id, slot)
    entry = expires.get(key)
    if not entry:
        return False, None
    owned, expires_at = entry
    if owned != tgid:
        return False, None
    if ua_session_never_expires(expires_at):
        return True, None
    if time.time() >= expires_at:
        return False, None
    return True, expires_at


def _prune_expired_single_sessions(state: MonitorState) -> None:
    owners, expires, _ = _ensure_session_maps(state)
    now = time.time()
    for key, entry in list(expires.items()):
        if len(key) != 3:
            continue
        if ua_session_never_expires(entry[1]):
            continue
        if now < entry[1]:
            continue
        expires.pop(key, None)
        if owners.get(key) == entry[0]:
            owners.pop(key, None)


def _format_ua_timeout_to(
    state: MonitorState,
    master_name: str,
    peer_id: int,
    expires_at: float | None,
    time_str_fn,
) -> str:
    """Human countdown for UA chip; omit when TIMER=0 (legacy no-expiry sentinel)."""
    if expires_at is None or ua_session_never_expires(expires_at):
        return ""
    timer_min = _peer_timer_minutes(state, master_name, peer_id)
    if ua_timer_is_infinite(timer_min) or ua_session_expires_is_infinite(expires_at):
        return ""
    return time_str_fn(expires_at, "to")


def lookup_ua_timeout_for_peer(
    state: MonitorState,
    master_name: str,
    peer_id: int,
    slot: int,
    tgid: int,
    time_str_fn,
) -> str:
    active, expires_at = _session_active(state, master_name, peer_id, slot, tgid)
    if active and expires_at is not None:
        return _format_ua_timeout_to(
            state, master_name, peer_id, expires_at, time_str_fn,
        )
    return ""


def _tgid_to_int(raw) -> int:
    if isinstance(raw, int):
        return raw
    if isinstance(raw, bytes):
        return int.from_bytes(raw[:4], "big") if len(raw) >= 4 else 0
    try:
        return int(raw)
    except (TypeError, ValueError):
        return 0


def _apply_single_mode_chips(
    state: MonitorState,
    master_name: str,
    peer_id: int,
    peer_row: dict,
    time_str_fn,
) -> None:
    owners = getattr(state, "UA_DYNAMIC_OWNERS", None) or {}
    for slot in (1, 2):
        key = _session_key(master_name, peer_id, slot)
        tgid = owners.get(key)
        if tgid is None:
            peer_row[f"SINGLE_TS{slot}"] = {"TGID": "", "TO": ""}
            continue
        active, expires_at = _session_active(state, master_name, peer_id, slot, tgid)
        if not active:
            peer_row[f"SINGLE_TS{slot}"] = {"TGID": "", "TO": ""}
            continue
        peer_row[f"SINGLE_TS{slot}"] = {
            "TGID": tgid,
            "TO": _format_ua_timeout_to(
                state, master_name, peer_id, expires_at, time_str_fn,
            ),
        }


def _apply_multi_mode_chips(
    state: MonitorState,
    master_name: str,
    peer_id: int,
    peer_row: dict,
) -> None:
    multi = getattr(state, "UA_MULTI_TGS", None) or {}
    for slot in (1, 2):
        key = _session_key(master_name, peer_id, slot)
        tgs = sorted(multi.get(key, set()))
        entries = []
        for tgid in tgs:
            if _is_service_voice_tgid(tgid) or _is_static_tg(state, master_name, peer_id, slot, tgid):
                continue
            entries.append({"TGID": str(tgid), "TO": ""})
        peer_row[f"UA_MULTI_TS{slot}"] = entries
        peer_row[f"SINGLE_TS{slot}"] = {"TGID": "", "TO": ""}


def _apply_server_ua_sessions_from_config(
    state: MonitorState,
    master_name: str,
    peer_id: int,
    peer_cfg: dict,
) -> None:
    """Sync SINGLE=1 indigo from server ``UA_SESSIONS`` (dashboard_state only).

    SINGLE=0 multi-dynamic TGs are tracked from voice events in ``UA_MULTI_TGS``;
    an empty ``ua_sessions`` snapshot must not wipe them.
    """
    if not _peer_single_mode(state, master_name, peer_id):
        return
    if "UA_SESSIONS" not in peer_cfg:
        return
    raw = peer_cfg.get("UA_SESSIONS")
    if not isinstance(raw, dict):
        return
    clear_peer_ua_sessions(state, master_name, peer_id)
    if not raw:
        return
    owners, expires, _multi = _ensure_session_maps(state)
    now = time.time()
    for slot_key, sess in raw.items():
        if not isinstance(sess, dict):
            continue
        try:
            slot = int(slot_key)
        except (TypeError, ValueError):
            continue
        tgid = int(sess.get("tgid", 0) or 0)
        exp = float(sess.get("expires_at", 0) or 0)
        if tgid <= 0 or _is_service_voice_tgid(tgid):
            continue
        if exp > 0 and exp <= now:
            continue
        key = _session_key(master_name, peer_id, slot)
        owners[key] = tgid
        expires[key] = (tgid, exp)


def _apply_server_ua_multi_from_config(
    state: MonitorState,
    master_name: str,
    peer_id: int,
    peer_cfg: dict,
) -> None:
    """Sync SINGLE=0 multi-dynamic chips from server ``UA_MULTI_TGS`` (after DB restore)."""
    if _peer_single_mode(state, master_name, peer_id):
        return
    if "UA_MULTI_TGS" not in peer_cfg:
        return
    raw = peer_cfg.get("UA_MULTI_TGS")
    if not isinstance(raw, dict):
        return
    _, _, multi = _ensure_session_maps(state)
    for slot_key, tgids in raw.items():
        try:
            slot = int(slot_key)
        except (TypeError, ValueError):
            continue
        if not isinstance(tgids, (list, tuple, set)):
            continue
        tset = {
            int(t)
            for t in tgids
            if int(t) > 0 and not _is_service_voice_tgid(int(t))
        }
        key = _session_key(master_name, peer_id, slot)
        if tset:
            multi[key] = tset
        else:
            multi.pop(key, None)


def sync_server_ua_sessions_from_config(state: MonitorState, config_dict: dict) -> None:
    """Apply server UA snapshot only when CONFIG/dashboard_state arrives (not on voice)."""
    for master_name, sys_cfg in config_dict.items():
        if not isinstance(sys_cfg, dict) or sys_cfg.get("MODE") != "MASTER":
            continue
        peers = sys_cfg.get("PEERS", {})
        if not isinstance(peers, dict):
            continue
        for peer_key, peer_cfg in peers.items():
            if not isinstance(peer_cfg, dict):
                continue
            if isinstance(peer_key, (bytes, bytearray)):
                pid = int.from_bytes(peer_key[:4], "big") if len(peer_key) >= 4 else int(peer_key)
            else:
                pid = int(peer_key)
            _apply_server_ua_sessions_from_config(state, master_name, pid, peer_cfg)
            _apply_server_ua_multi_from_config(state, master_name, pid, peer_cfg)


def build_tgstats_impl(state: MonitorState, time_str_fn) -> None:
    """Fill CTABLE UA chips from per-peer OPTIONS + voice session timers."""
    config = state.CONFIG
    ctable = state.CTABLE
    if not config or not ctable:
        return
    _prune_expired_single_sessions(state)
    ctable["SERVER"] = {"TS1": [], "TS2": []}
    for _master in ctable.get("MASTERS", {}):
        for _peer in ctable["MASTERS"][_master].get("PEERS", {}):
            if _peer == 4294967295:
                continue
            _row = ctable["MASTERS"][_master]["PEERS"][_peer]
            if isinstance(_row, dict):
                _row["SINGLE_TS1"] = {"TGID": "", "TO": ""}
                _row["SINGLE_TS2"] = {"TGID": "", "TO": ""}
                _row["UA_MULTI_TS1"] = []
                _row["UA_MULTI_TS2"] = []
    tmp_dict = {}
    for system in ctable.get("MASTERS", {}):
        if not ctable["MASTERS"][system].get("PEERS"):
            continue
        for peer in ctable["MASTERS"][system]["PEERS"]:
            if peer == 4294967295:
                continue
            if system not in tmp_dict:
                tmp_dict[system] = [peer]
            else:
                tmp_dict[system].append(peer)
    yaml_cfg = {}
    for master_name in tmp_dict:
        block = _yaml_system_config(state, master_name)
        if block:
            yaml_cfg = block
            break
    if yaml_cfg:
        ctable["SERVER"]["SINGLE_MODE"] = yaml_cfg.get("SINGLE_MODE", False)
        ctable["SERVER"]["DEFAULT_UA_TIMER"] = yaml_cfg.get("DEFAULT_UA_TIMER", 10)
        ts1 = _static_tg_list(yaml_cfg.get("TS1_STATIC"))
        ts2 = _static_tg_list(yaml_cfg.get("TS2_STATIC"))
        if ts1:
            ctable["SERVER"]["TS1"] = ts1
        if ts2:
            ctable["SERVER"]["TS2"] = ts2
    for master_name, peer_list in tmp_dict.items():
        for peer in peer_list:
            peer_row = ctable["MASTERS"][master_name]["PEERS"][peer]
            opt_text = _peer_options_text_from_config(state, master_name, peer)
            if opt_text is not None:
                fields = _merged_peer_option_fields(state, master_name, peer)
                peer_row["TS1_STATIC"] = list(fields.get("TS1_STATIC") or [])
                peer_row["TS2_STATIC"] = list(fields.get("TS2_STATIC") or [])
            else:
                peer_cfg = _peer_cfg_from_config(state, master_name, peer)
                peer_row["TS1_STATIC"] = _static_tg_list(peer_cfg.get("TS1_STATIC"))
                peer_row["TS2_STATIC"] = _static_tg_list(peer_cfg.get("TS2_STATIC"))
            ctable["MASTERS"][master_name]["PEERS"][peer]["SINGLE_MODE"] = _peer_single_mode(
                state, master_name, peer
            )
            prune_voice_ts_not_in_static(state, master_name, peer, peer_row)
    for master_name, peer_list in tmp_dict.items():
        peers = ctable["MASTERS"][master_name]["PEERS"]
        for peer in peer_list:
            peer_row = peers[peer]
            if _peer_single_mode(state, master_name, peer):
                _apply_single_mode_chips(state, master_name, peer, peer_row, time_str_fn)
            else:
                _apply_multi_mode_chips(state, master_name, peer, peer_row)

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

"""Slim CTABLE slices and semantic fingerprints for WebSocket deduplication."""

from __future__ import annotations

import json
from typing import Any


def _dict_keys_str(obj: Any) -> Any:
    """Recursively stringify dict keys so json.dumps(sort_keys=True) never compares int vs str."""
    if isinstance(obj, dict):
        return {str(k): _dict_keys_str(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_dict_keys_str(x) for x in obj]
    if isinstance(obj, tuple):
        return tuple(_dict_keys_str(x) for x in obj)
    return obj


def _fingerprint_dumps(payload: Any) -> str:
    try:
        return json.dumps(payload, sort_keys=True, default=str)
    except TypeError:  # a dict mixes int and str keys: stringify them (one full walk, the slow path)
        return json.dumps(_dict_keys_str(payload), sort_keys=True, default=str)


def _peer_ts_semantic(ent: Any) -> Any:
    if not isinstance(ent, dict):
        return ent
    return {k: v for k, v in ent.items() if k != "TIMEOUT"}


def _streams_semantic(streams: dict) -> dict:
    out: dict = {}
    for sid, ent in streams.items():
        if isinstance(ent, (list, tuple)) and len(ent) >= 3:
            out[sid] = [ent[0], ent[1], ent[2]]
        else:
            out[sid] = ent
    return out


def _main_ctable_semantic(ctable: dict[str, Any]) -> dict[str, Any]:
    """Semantic main-dashboard CTABLE view without deepcopy (ignore TIMEOUT churn)."""
    masters_out: dict[str, Any] = {}
    for sn, master in (ctable.get("MASTERS") or {}).items():
        if not isinstance(master, dict) or not master.get("PEERS"):
            continue
        peers_out: dict[str, Any] = {}
        for pid, peer in (master.get("PEERS") or {}).items():
            if not isinstance(peer, dict):
                continue
            peers_out[pid] = {
                ts: _peer_ts_semantic(peer[ts])
                for ts in (1, 2, "1", "2")
                if ts in peer
            }
        masters_out[sn] = {"PEERS": peers_out}

    peers_out: dict[str, Any] = {}
    for sys_name, pobj in (ctable.get("PEERS") or {}).items():
        if not isinstance(pobj, dict):
            continue
        peers_out[sys_name] = {
            ts: _peer_ts_semantic(pobj[ts])
            for ts in (1, 2, "1", "2")
            if ts in pobj
        }

    ob_out: dict[str, Any] = {}
    for ob_name, ob in (ctable.get("OPENBRIDGES") or {}).items():
        if not isinstance(ob, dict):
            continue
        streams = ob.get("STREAMS") or {}
        ob_out[ob_name] = {"STREAMS": _streams_semantic(streams)}

    return {"MASTERS": masters_out, "PEERS": peers_out, "OPENBRIDGES": ob_out}


def ctable_for_lnksys(ctable: dict[str, Any], *, empty_masters: bool = False) -> dict[str, Any]:
    """Linked Systems / Static TG: masters + homebrew peers (no OPENBRIDGES).

    When ``empty_masters`` is false (default / ``EMPTY_MASTERS: false``), omit masters
    with no connected peers so WebSocket payloads stay slim.
    """
    return {
        "MASTERS": _masters(ctable, empty_masters),
        "PEERS": ctable.get("PEERS", {}),
    }


def _masters(ctable: dict[str, Any], empty_masters: bool) -> dict[str, Any]:
    masters = ctable.get("MASTERS", {})
    if empty_masters:
        return masters
    return {name: data for name, data in masters.items() if isinstance(data, dict) and data.get("PEERS")}


def ctable_for_opb(ctable: dict[str, Any]) -> dict[str, Any]:
    """OpenBridge page: OPENBRIDGES only."""
    return {"OPENBRIDGES": ctable.get("OPENBRIDGES", {})}


def ctable_for_main(ctable: dict[str, Any], *, empty_masters: bool = False) -> dict[str, Any]:
    """Dashboard / ActiveQsoBox: masters, XLX/homebrew peers, openbridge streams.

    Like ``ctable_for_lnksys``, masters with no peers are left out unless ``EMPTY_MASTERS``:
    an inject-only server reports one per MAX_PEERS slot, a third of each message, sent on
    every voice event.
    """
    return {
        "MASTERS": _masters(ctable, empty_masters),
        "PEERS": ctable.get("PEERS", {}),
        "OPENBRIDGES": ctable.get("OPENBRIDGES", {}),
    }


def opb_semantic_fingerprint(ctable: dict[str, Any], dbridges: bool) -> str:
    """Stable hash input for OpenBridge ``o`` messages (ignore stream timeout churn)."""
    ob_out: dict[str, Any] = {}
    for sys_name, sys_ob in (ctable.get("OPENBRIDGES") or {}).items():
        if not isinstance(sys_ob, dict):
            continue
        streams = sys_ob.get("STREAMS") or {}
        ob_entry: dict[str, Any] = {"STREAMS": _streams_semantic(streams)}
        if isinstance(sys_ob.get("CONNECTED"), bool):
            ob_entry["CONNECTED"] = sys_ob["CONNECTED"]
        ob_out[sys_name] = ob_entry
    return _fingerprint_dumps({"ctable": {"OPENBRIDGES": ob_out}, "dbridges": dbridges})


def main_dashboard_semantic_fingerprint(lastheard: list, ctable: dict[str, Any]) -> str:
    """Stable string for dedup of WebSocket ``i`` (Dashboard): lastheard + view without TIMEOUT / stream ts."""
    return _fingerprint_dumps({"lastheard": lastheard, "ctable": _main_ctable_semantic(ctable)})


def lastheard_db_refresh_needed(brdg_meta: dict[str, str] | None) -> bool:
    """True when MySQL last_heard may have changed (END RX or unit-data RX)."""
    if not brdg_meta:
        return False
    call_type = brdg_meta.get("call_type", "")
    if call_type.startswith("UNIT DATA"):
        return brdg_meta.get("direction", "") != "TX"
    if brdg_meta.get("action") == "END":
        return brdg_meta.get("direction", "") == "RX"
    return False

# ADN Monitor - application report mapper
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

"""Map report JSON payloads to legacy CONFIG / BRIDGES / BRDG_EVENT CSV shapes."""

from __future__ import annotations

import json
import logging
import re
import time
from typing import Any

from ..domain import Failure, ReportProtocolError, Success
from .dashboard_config import MapPrecision

logger = logging.getLogger("adn-monitor")

REPORT_PROTOCOL = 2


def decode_report_payload(raw_message: bytes) -> Success[dict] | Failure[ReportProtocolError]:
    """Decode JSON payload after the single-byte opcode."""
    data = raw_message[1:]
    if not data:
        return Failure(ReportProtocolError("report payload empty"))
    try:
        obj = json.loads(data.decode("utf-8", errors="replace"))
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        logger.warning("(REPORT) JSON decode failed: %s", e)
        return Failure(ReportProtocolError(f"JSON decode failed: {e}"))
    if not isinstance(obj, dict):
        return Failure(ReportProtocolError("report payload is not a JSON object"))
    return Success(obj)


def _bytes_4(peer_id: int) -> bytes:
    """Peer dict keys match legacy CONFIG pickle (4-byte big-endian)."""
    return peer_id.to_bytes(4, "big")


_PEER_JSON_TO_LEGACY: tuple[tuple[str, str], ...] = (
    ("callsign", "CALLSIGN"),
    ("rx_freq", "RX_FREQ"),
    ("tx_freq", "TX_FREQ"),
    ("location", "LOCATION"),
    ("description", "DESCRIPTION"),
    ("url", "URL"),
    ("slots", "SLOTS"),
    ("package_id", "PACKAGE_ID"),
    ("software_id", "SOFTWARE_ID"),
    ("colorcode", "COLORCODE"),
    ("tx_power", "TX_POWER"),
    # Coordinates the peer sent in its RPTC login; used by the map page. Servers
    # that do not report them simply leave the peer off the map.
    ("latitude", "LATITUDE"),
    ("longitude", "LONGITUDE"),
    ("height", "HEIGHT"),
)

_BYTE_PEER_FIELDS = frozenset({"RX_FREQ", "TX_FREQ", "SLOTS"})


def _route_table_key(route: dict[str, Any]) -> str:
    """Routing table row key (``relay_table_key`` on wire; legacy ``bridge_key`` fallback)."""
    key = route.get("relay_table_key") or route.get("bridge_key")
    return str(key).strip() if key is not None else ""


def _apply_peer_topology_fields(peer_conf: dict[str, Any], peer: dict[str, Any]) -> None:
    if "single_mode" in peer:
        peer_conf["SINGLE_MODE"] = bool(peer["single_mode"])
    if peer.get("ua_timer_min") is not None:
        try:
            peer_conf["UA_TIMER_MIN"] = float(peer["ua_timer_min"])
        except (TypeError, ValueError):
            pass
    if "ua_sessions" in peer:
        peer_conf["UA_SESSIONS"] = peer.get("ua_sessions") or {}
    if "ua_multi_tgs" in peer:
        peer_conf["UA_MULTI_TGS"] = peer.get("ua_multi_tgs") or {}
    if peer.get("rf_mode") in ("simplex", "duplex"):
        peer_conf["RF_MODE"] = str(peer["rf_mode"])


def _legacy_peer_field(legacy_key: str, value: Any) -> Any:
    if legacy_key in _BYTE_PEER_FIELDS:
        if isinstance(value, bytes):
            return value
        text = str(value).strip()
        return text.encode("utf-8") if text else b""
    return value


_HEMISPHERE_RE = re.compile(r"^([NSEW])|([NSEW])$", re.IGNORECASE)
_ZERO_ISLAND = 0.0005
_HOTSPOT_ID_MIN_DIGITS = 7


def _parse_coordinate(raw: Any, max_abs: float) -> float | None:
    """Mirror frontend/src/utils/mapPoints.ts:parseCoordinate — same formats radios send."""
    if raw is None:
        return None
    text = str(raw).strip().replace(",", ".")
    if not text:
        return None
    sign = 1
    match = _HEMISPHERE_RE.search(text)
    if match:
        letter = (match.group(1) or match.group(2) or "").upper()
        if letter in ("S", "W"):
            sign = -1
        text = _HEMISPHERE_RE.sub("", text, count=1).strip()
    try:
        value = float(text)
    except ValueError:
        return None
    signed = sign * value
    if abs(signed) > max_abs:
        return None
    return signed


def _round_peer_coordinates(peer_conf: dict[str, Any], pid: int, map_precision: MapPrecision | None) -> None:
    """Coarsen LATITUDE/LONGITUDE before the peer dict reaches any WS/REST consumer.

    This is the privacy boundary: the map page's own client-side rounding runs too
    late, after the raw value already went out to every dashboard client, not just
    those with the map page open.
    """
    if map_precision is None:
        return
    lat = _parse_coordinate(peer_conf.get("LATITUDE"), 90.0)
    lon = _parse_coordinate(peer_conf.get("LONGITUDE"), 180.0)
    if lat is None or lon is None or (abs(lat) < _ZERO_ISLAND and abs(lon) < _ZERO_ISLAND):
        return
    is_hotspot = len(str(pid)) >= _HOTSPOT_ID_MIN_DIGITS
    decimals = map_precision.hotspot if is_hotspot else map_precision.repeater
    if decimals is None or decimals < 0:
        return
    factor = 10**decimals
    peer_conf["LATITUDE"] = str(round(lat * factor) / factor)
    peer_conf["LONGITUDE"] = str(round(lon * factor) / factor)


_CALL_FAMILY_TO_CSV = {
    "GROUP": "GROUP VOICE",
    "PRIVATE": "PRIVATE VOICE",
    "UNIT": "UNIT DATA",
}


def dashboard_state_to_config(
    doc: dict[str, Any], *, ts: float | None = None, map_precision: MapPrecision | None = None
) -> dict[str, Any]:
    """Build CONFIG dict from ``dashboard_state`` (TCP STATE_SND or MQTT state topic)."""
    if doc.get("type") != "dashboard_state":
        return {}
    epoch = float(doc.get("ts", time.time())) if ts is None else ts
    ctable = doc.get("ctable")
    if not isinstance(ctable, dict):
        return {}
    config: dict[str, Any] = {}

    for name, master in (ctable.get("MASTERS") or {}).items():
        if not isinstance(master, dict):
            continue
        entry: dict[str, Any] = {
            "ENABLED": True,
            "MODE": str(master.get("mode", "MASTER")),
        }
        if master.get("ip"):
            entry["IP"] = str(master["ip"])
        port = master.get("port")
        if port is not None:
            entry["PORT"] = int(port)
        if "single_mode" in master:
            entry["SINGLE_MODE"] = bool(master["single_mode"])
        if master.get("default_ua_timer") is not None:
            try:
                entry["DEFAULT_UA_TIMER"] = float(master["default_ua_timer"])
            except (TypeError, ValueError):
                pass
        peers: dict[bytes, dict[str, Any]] = {}
        raw_peers = master.get("peers") or {}
        if isinstance(raw_peers, dict):
            peer_items = raw_peers.items()
        elif isinstance(raw_peers, list):
            peer_items = ((p.get("id"), p) for p in raw_peers if isinstance(p, dict) and "id" in p)
        else:
            peer_items = ()
        for pid_key, peer in peer_items:
            if not isinstance(peer, dict):
                continue
            pid = int(peer.get("id", pid_key))
            connected_at = peer.get("connected_at")
            if connected_at is not None:
                try:
                    connected_ts = int(float(connected_at))
                except (TypeError, ValueError):
                    connected_ts = int(epoch)
            else:
                connected_ts = int(epoch)
            peer_conf: dict[str, Any] = {
                "CONNECTION": "YES",
                "CONNECTED": connected_ts,
                "IP": peer.get("ip", ""),
                "PORT": peer.get("port", ""),
                "TX_FREQ": b"",
                "RX_FREQ": b"",
                "SLOTS": b"0",
            }
            for json_key, legacy_key in _PEER_JSON_TO_LEGACY:
                if json_key in peer:
                    peer_conf[legacy_key] = _legacy_peer_field(legacy_key, peer[json_key])
            _round_peer_coordinates(peer_conf, pid, map_precision)
            ts1 = peer.get("ts1_static")
            if isinstance(ts1, list) and ts1:
                peer_conf["TS1_STATIC"] = ",".join(str(x) for x in ts1)
            ts2 = peer.get("ts2_static")
            if isinstance(ts2, list) and ts2:
                peer_conf["TS2_STATIC"] = ",".join(str(x) for x in ts2)
            options = peer.get("options")
            if isinstance(options, str) and options.strip():
                peer_conf["OPTIONS"] = options.encode("utf-8")
            _apply_peer_topology_fields(peer_conf, peer)
            peers[_bytes_4(pid)] = peer_conf
        entry["PEERS"] = peers
        config[str(name)] = entry

    for name, peer_sys in (ctable.get("PEERS") or {}).items():
        if not isinstance(peer_sys, dict):
            continue
        mode = str(peer_sys.get("mode", "PEER"))
        entry: dict[str, Any] = {"ENABLED": True, "MODE": mode}
        for json_key, legacy_key in (
            ("callsign", "CALLSIGN"),
            ("location", "LOCATION"),
            ("description", "DESCRIPTION"),
            ("url", "URL"),
            ("master_ip", "MASTER_IP"),
            ("master_port", "MASTER_PORT"),
        ):
            if json_key in peer_sys and peer_sys[json_key] is not None:
                entry[legacy_key] = str(peer_sys[json_key])
        radio_id = peer_sys.get("radio_id")
        if radio_id is not None:
            entry["RADIO_ID"] = int(radio_id)
        connected_at = peer_sys.get("connected_at")
        try:
            connected_ts = int(float(connected_at)) if connected_at is not None else int(epoch)
        except (TypeError, ValueError):
            connected_ts = int(epoch)
        stats_key = "XLXSTATS" if mode == "XLXPEER" else "STATS"
        entry[stats_key] = {"CONNECTION": "YES", "CONNECTED": connected_ts}
        config[str(name)] = entry

    for name, obp in (ctable.get("OPENBRIDGES") or {}).items():
        if not isinstance(obp, dict):
            continue
        entry = {"ENABLED": True, "MODE": "OPENBRIDGE"}
        if obp.get("ip"):
            entry["IP"] = str(obp["ip"])
        port = obp.get("port")
        if port is not None:
            entry["PORT"] = int(port)
        if obp.get("network_id") is not None:
            entry["NETWORK_ID"] = _bytes_4(int(obp["network_id"]))
        if obp.get("enhanced_obp"):
            entry["ENHANCED_OBP"] = True
        if isinstance(obp.get("connected"), bool):
            entry["OBP_CONNECTED"] = obp["connected"]
        config[str(name)] = entry

    return config


def topology_to_config(
    topology: dict[str, Any], *, ts: float | None = None, map_precision: MapPrecision | None = None
) -> dict[str, Any]:
    """Build a CONFIG dict compatible with ``build_hblink_table`` / ``update_hblink_table``."""
    epoch = float(topology.get("ts", time.time())) if ts is None else ts
    config: dict[str, Any] = {}
    for system in topology.get("systems", []):
        if not isinstance(system, dict):
            continue
        name = system.get("name")
        if not name:
            continue
        entry: dict[str, Any] = {
            "ENABLED": bool(system.get("enabled", True)),
            "MODE": system.get("mode", "MASTER"),
        }
        if system.get("ip"):
            entry["IP"] = str(system["ip"])
        port = system.get("port")
        if port is not None:
            entry["PORT"] = int(port)
        if "repeat" in system:
            entry["REPEAT"] = bool(system["repeat"])
        if system.get("enhanced_obp"):
            entry["ENHANCED_OBP"] = True
        if system.get("mode") == "OPENBRIDGE" and system.get("network_id") is not None:
            entry["NETWORK_ID"] = _bytes_4(int(system["network_id"]))
        # Per-peer OPTIONS only — do not copy system-level static TG lists onto inject masters.
        peers: dict[bytes, dict[str, Any]] = {}
        for peer in system.get("peers", []):
            if not isinstance(peer, dict):
                continue
            pid = int(peer["id"])
            connected = bool(peer.get("connected", False))
            connected_at = peer.get("connected_at")
            if connected and connected_at is not None:
                try:
                    connected_ts = int(float(connected_at))
                except (TypeError, ValueError):
                    connected_ts = 0
            else:
                connected_ts = 0
            if connected and connected_ts <= 0:
                connected_ts = int(epoch)
            peer_conf: dict[str, Any] = {
                "CONNECTION": "YES" if connected else "NO",
                "CONNECTED": connected_ts if connected else 0,
                "IP": peer.get("ip", ""),
                "PORT": peer.get("port", ""),
                "TX_FREQ": b"",
                "RX_FREQ": b"",
                "SLOTS": b"0",
            }
            for json_key, legacy_key in _PEER_JSON_TO_LEGACY:
                if json_key in peer:
                    peer_conf[legacy_key] = _legacy_peer_field(legacy_key, peer[json_key])
            _round_peer_coordinates(peer_conf, pid, map_precision)
            ts1 = peer.get("ts1_static")
            if isinstance(ts1, list) and ts1:
                peer_conf["TS1_STATIC"] = ",".join(str(x) for x in ts1)
            ts2 = peer.get("ts2_static")
            if isinstance(ts2, list) and ts2:
                peer_conf["TS2_STATIC"] = ",".join(str(x) for x in ts2)
            options = peer.get("options")
            if isinstance(options, str) and options.strip():
                peer_conf["OPTIONS"] = options.encode("utf-8")
            _apply_peer_topology_fields(peer_conf, peer)
            peers[_bytes_4(pid)] = peer_conf
        entry["PEERS"] = peers
        config[str(name)] = entry
    return config


def routing_table_to_bridges(routing: dict[str, Any]) -> dict[str, Any]:
    """Build a BRIDGES dict compatible with ``build_bridge_table``."""
    bridges: dict[str, Any] = {}
    for route in routing.get("routes", []):
        if not isinstance(route, dict):
            continue
        key = _route_table_key(route)
        if not key:
            continue
        legs: list[dict[str, Any]] = []
        for leg in route.get("legs", []):
            if not isinstance(leg, dict):
                continue
            row: dict[str, Any] = {
                "SYSTEM": str(leg.get("system", "")),
                "TS": int(leg.get("ts", 1)),
                "TGID": int(leg.get("tgid", 0)),
                "ACTIVE": bool(leg.get("active", False)),
                "TO_TYPE": str(leg.get("to_type", "NONE")),
            }
            timer = leg.get("timer_expires_at")
            if timer is not None:
                row["TIMER"] = float(timer)
            legs.append(row)
        bridges[key] = legs
    return bridges


def voice_event_to_csv_parts(voice: dict[str, Any]) -> list[str] | None:
    """Convert a ``voice_event`` to legacy BRDG_EVENT CSV field list."""
    family = voice.get("call_family")
    csv_family = _CALL_FAMILY_TO_CSV.get(family)
    if csv_family is None:
        return None
    phase = str(voice.get("phase", ""))
    if family == "UNIT" and phase == "DATA":
        csv_family = "UNIT DATA HEADER"
    direction = str(voice.get("direction", "RX"))
    parts = [
        csv_family,
        phase,
        direction,
        str(voice.get("system", "")),
        str(int(voice.get("stream_id", 0))),
        str(int(voice.get("peer_id", 0))),
        str(int(voice.get("src_id", 0))),
        str(int(voice.get("slot", 1))),
        str(int(voice.get("dst_id", 0))),
    ]
    if phase == "END":
        dur = voice.get("duration_s")
        if dur is not None:
            parts.append(f"{float(dur):.2f}")
    if family == "PRIVATE" and direction == "TX" and voice.get("dest_peer_id") is not None:
        parts.append(str(int(voice["dest_peer_id"])))
    else:
        parts.append("1" if voice.get("is_announcement") else "0")
    return parts


def merge_topology_delta(previous: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    """Merge a topology delta patch into the last full snapshot."""
    merged = dict(previous)
    prev_systems = {s["name"]: s for s in previous.get("systems", []) if isinstance(s, dict) and s.get("name")}
    for system in patch.get("systems", []):
        if isinstance(system, dict) and system.get("name"):
            prev_systems[system["name"]] = system
    merged["type"] = "topology"
    merged["systems"] = list(prev_systems.values())
    if "seq" in patch:
        merged["seq"] = patch["seq"]
    if "ts" in patch:
        merged["ts"] = patch["ts"]
    return merged


def merge_routing_delta(previous: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    """Merge a routing_table delta patch into the last full snapshot."""
    merged = dict(previous)
    prev_routes: dict[str, dict[str, Any]] = {}
    for r in previous.get("routes", []):
        if not isinstance(r, dict):
            continue
        key = _route_table_key(r)
        if key:
            prev_routes[key] = r
    for route in patch.get("routes", []):
        if not isinstance(route, dict):
            continue
        key = _route_table_key(route)
        if key:
            prev_routes[key] = route
    merged["type"] = "routing_table"
    merged["routes"] = list(prev_routes.values())
    if "seq" in patch:
        merged["seq"] = patch["seq"]
    if "ts" in patch:
        merged["ts"] = patch["ts"]
    return merged

# ADN Monitor - application dashboard config
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

"""Build dashboard JSON for GET /api/config/dashboard."""

from __future__ import annotations

from typing import Any

from ..version import read_version


def _bool(val: object) -> bool:
    if isinstance(val, bool):
        return val
    if isinstance(val, str):
        return val.strip().lower() in ("1", "true", "yes", "on")
    return bool(val)


def _link_items(raw: object) -> list[dict[str, str]]:
    if not isinstance(raw, list):
        return []
    out: list[dict[str, str]] = []
    for entry in raw:
        if isinstance(entry, dict) and "name" in entry:
            out.append({"name": str(entry["name"]), "url": str(entry.get("url", ""))})
        elif isinstance(entry, str):
            parts = entry.split(",", 1)
            out.append({"name": parts[0].strip(), "url": (parts[1] if len(parts) > 1 else "").strip()})
    return out


def _normalize_nav_links(dashboard: dict[str, Any]) -> dict[str, Any]:
    nav = dashboard.get("nav_links") or dashboard.get("NAV_LINKS")
    if isinstance(nav, dict):
        items = nav.get("items") or nav.get("Items") or []
        return {"name": str(nav.get("name") or nav.get("Name") or ""), "items": _link_items(items)}
    name = str(dashboard.get("NAV_LNK_NAME") or dashboard.get("nav_lnk_name") or "")
    items: list[dict[str, str]] = []
    for i in range(1, 100):
        val = dashboard.get(f"LINK{i}") or dashboard.get(f"link{i}")
        if val is None or val == "":
            break
        parts = str(val).split(",", 1)
        items.append({"name": parts[0].strip(), "url": (parts[1] if len(parts) > 1 else "").strip()})
    return {"name": name, "items": items}


def _normalize_footer(dashboard: dict[str, Any]) -> list[dict[str, str]]:
    footer = dashboard.get("footer") or dashboard.get("FOOTER")
    if isinstance(footer, dict):
        return _link_items(footer.get("items") or footer.get("Items") or footer)
    if isinstance(footer, list):
        return _link_items(footer)
    items: list[dict[str, str]] = []
    for i in range(1, 100):
        val = dashboard.get(f"FOOTER{i}") or dashboard.get(f"footer{i}")
        if val is None or val == "":
            break
        parts = str(val).split(",", 1)
        items.append({"name": parts[0].strip(), "url": (parts[1] if len(parts) > 1 else "").strip()})
    return items


def _normalize_news(dashboard: dict[str, Any]) -> list[dict[str, str]]:
    news = dashboard.get("news") or dashboard.get("NEWS")
    if isinstance(news, dict):
        return _link_items(news.get("items") or news.get("Items") or news)
    if isinstance(news, list):
        return _link_items(news)
    items: list[dict[str, str]] = []
    for i in range(1, 100):
        val = dashboard.get(f"NEWS{i}") or dashboard.get(f"news{i}")
        if val is None or val == "":
            break
        parts = str(val).split(",", 1)
        items.append({"name": parts[0].strip(), "url": (parts[1] if len(parts) > 1 else "").strip()})
    return items


_MAP_DEFAULTS: dict[str, Any] = {
    "enabled": True,
    "tileUrl": "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    # Empty: the dashboard darkens the light tiles with a CSS filter, so a dark
    # theme needs no second tile provider (and no API key).
    "tileUrlDark": "",
    "attribution": '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    "maxZoom": 18,
    "center": [20.0, 0.0],
    "zoom": 2,
    # Hotspots sit at someone's home: coarsen them to ~1 km by default.
    "hotspotPrecision": 2,
    "repeaterPrecision": None,
    "approxByCountry": True,
    "gpsUrl": "",
    "gpsLabel": "",
    "gpsRefreshSec": 60,
    "overrides": {},
}

# MAP section keys (YAML upper case) -> JSON keys used by the frontend.
_MAP_KEYS: tuple[tuple[str, str], ...] = (
    ("ENABLED", "enabled"),
    ("TILE_URL", "tileUrl"),
    ("TILE_URL_DARK", "tileUrlDark"),
    ("ATTRIBUTION", "attribution"),
    ("MAX_ZOOM", "maxZoom"),
    ("CENTER", "center"),
    ("ZOOM", "zoom"),
    ("HOTSPOT_PRECISION", "hotspotPrecision"),
    ("REPEATER_PRECISION", "repeaterPrecision"),
    ("APPROX_BY_COUNTRY", "approxByCountry"),
    ("GPS_URL", "gpsUrl"),
    ("GPS_LABEL", "gpsLabel"),
    ("GPS_REFRESH_SEC", "gpsRefreshSec"),
    ("OVERRIDES", "overrides"),
)


def _map_overrides(raw: object) -> dict[str, list[float]]:
    """``OVERRIDES: {peer_id: [lat, lon]}`` for systems that report no coordinates."""
    if not isinstance(raw, dict):
        return {}
    out: dict[str, list[float]] = {}
    for peer_id, value in raw.items():
        if isinstance(value, dict):
            value = [value.get("lat", value.get("latitude")), value.get("lon", value.get("longitude"))]
        if not isinstance(value, (list, tuple)) or len(value) != 2:
            continue
        try:
            lat, lon = float(value[0]), float(value[1])
        except (TypeError, ValueError):
            continue
        if -90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0:
            out[str(peer_id).strip()] = [lat, lon]
    return out


def _map_value(json_key: str, value: object) -> Any:
    """Coerce one MAP entry to the type the frontend expects."""
    if json_key in ("enabled", "approxByCountry"):
        return _bool(value)
    if json_key in ("maxZoom", "zoom", "gpsRefreshSec"):
        try:
            return int(value)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            return _MAP_DEFAULTS[json_key]
    if json_key in ("hotspotPrecision", "repeaterPrecision"):
        if value is None or (isinstance(value, str) and not value.strip()):
            return None
        try:
            return max(int(value), 0)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            return _MAP_DEFAULTS[json_key]
    if json_key == "center":
        if isinstance(value, (list, tuple)) and len(value) == 2:
            try:
                return [float(value[0]), float(value[1])]
            except (TypeError, ValueError):
                return _MAP_DEFAULTS[json_key]
        return _MAP_DEFAULTS[json_key]
    if json_key == "overrides":
        return _map_overrides(value)
    return str(value)


def _normalize_map(config: dict[str, Any], dashboard: dict[str, Any]) -> dict[str, Any]:
    """MAP settings for the map page (top-level ``MAP:`` or nested under ``DASHBOARD:``)."""
    raw = config.get("MAP") or config.get("map") or dashboard.get("MAP") or dashboard.get("map") or {}
    out = dict(_MAP_DEFAULTS)
    if not isinstance(raw, dict):
        return out
    for yaml_key, json_key in _MAP_KEYS:
        if yaml_key in raw:
            value = raw[yaml_key]
        elif yaml_key.lower() in raw:
            value = raw[yaml_key.lower()]
        else:
            continue
        out[json_key] = _map_value(json_key, value)
    return out


def build_dashboard_config(config: dict[str, Any]) -> dict[str, Any]:
    dashboard = config.get("DASHBOARD") or {}
    if not isinstance(dashboard, dict):
        dashboard = {}
    title = dashboard.get("DASHTITLE") or dashboard.get("dashtitle") or "ADN Systems Dashboard"
    return {
        "title": str(title),
        "monitorVersion": read_version(),
        "language": str(dashboard.get("LANGUAGE") or dashboard.get("language") or "en"),
        "background": _bool(dashboard.get("BACKGROUND") if "BACKGROUND" in dashboard else dashboard.get("background", False)),
        "selfService": _bool(
            dashboard.get("SELF_SERVICE") if "SELF_SERVICE" in dashboard else dashboard.get("self_service", False)
        ),
        "showConsole": _bool(
            dashboard.get("SHOW_CONSOLE") if "SHOW_CONSOLE" in dashboard else dashboard.get("show_console", False)
        ),
        "footer": _normalize_footer(dashboard),
        "news": _normalize_news(dashboard),
        "navLinks": _normalize_nav_links(dashboard),
        "map": _normalize_map(config, dashboard),
    }

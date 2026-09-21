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

"""Load monitor config from YAML (adn-monitor.yaml). Returns Result (Success/Failure)."""

from __future__ import annotations

import logging
from pathlib import Path
from urllib.parse import urlparse

import yaml

from ..domain import ConfigError, Failure, Result, Success

logger = logging.getLogger("adn-monitor")


def _bool(val: object) -> bool:
    if isinstance(val, bool):
        return val
    if isinstance(val, str):
        return val.strip().lower() in ("1", "true", "yes", "on")
    return bool(val)


def _int(val: object, default: int = 0) -> int:
    if isinstance(val, int) and not isinstance(val, bool):
        return val
    if isinstance(val, str):
        try:
            return int(val.strip())
        except ValueError:
            return default
    return default


def _str(val: object) -> str:
    if val is None:
        return ""
    return str(val).strip()


def _url_sibling(url: str, filename: str) -> str:
    """Same origin and directory as *url*, with *filename* as the path tail."""
    parsed = urlparse(url.strip())
    if not parsed.scheme or not parsed.netloc:
        return ""
    dir_path = parsed.path.rsplit("/", 1)[0]
    return f"{parsed.scheme}://{parsed.netloc}{dir_path}/{filename}"


def load_config(cfg_file: str) -> Result[dict, ConfigError]:
    """
    Load config from YAML (adn-monitor.yaml).
    Returns Success(config_dict) or Failure(ConfigError).
    config_dict has keys: GLOBAL, ADN_CXN, OPB_FLTR, FILES, LOG, WS, DASHBOARD, DB (if present), ALIASES (if present), MAP (if present).
    """
    path = Path(cfg_file)
    ext = path.suffix.lower()
    if ext not in (".yaml", ".yml"):
        return Failure(ConfigError(f"Config must be YAML (.yaml or .yml), got: {cfg_file}"))
    if not path.is_file():
        return Failure(ConfigError(f"Configuration file {cfg_file} is not a valid file."))

    try:
        with open(path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
    except Exception as err:
        return Failure(ConfigError(f"Error parsing YAML config: {err}"))
    if not isinstance(data, dict):
        return Failure(ConfigError("YAML config root must be a mapping."))

    CONF: dict = {
        "GLOBAL": {},
        "ADN_CXN": {},
        "OPB_FLTR": {},
        "FILES": {"PATH": "./json"},
        "LOG": {},
        "WS": {},
        "APP": {},
        "DASHBOARD": {},
    }

    # GLOBAL
    g = data.get("GLOBAL") or {}
    CONF["GLOBAL"] = {
        "HB_INC": _bool(g.get("HOMEBREW_INC", True)),
        "LH_INC": _bool(g.get("LASTHEARD_INC", True)),
        "LH_ROWS": _int(g.get("LASTHEARD_ROWS"), 20),
        "BRDG_INC": _bool(g.get("BRIDGES_INC", True)),
        "EMPTY_MASTERS": _bool(g.get("EMPTY_MASTERS", False)),
        "TGC_INC": _bool(g.get("TGCOUNT_INC", True)),
        "TGC_ROWS": _int(g.get("TGCOUNT_ROWS"), 20),
        # IANA name, e.g. Europe/Madrid — empty = server local (see time_utils.format_display_datetime)
        "TIMEZONE": _str(g.get("TIMEZONE", "")),
    }

    # ADN_CONNECTION
    adn = data.get("ADN_CONNECTION") or {}
    CONF["ADN_CXN"] = {
        "ADN_IP": _str(adn.get("ADN_IP", "127.0.0.1")),
        "ADN_PORT": _int(adn.get("ADN_PORT"), 4321),
        "HELLO_TIMEOUT_MS": _int(adn.get("HELLO_TIMEOUT_MS"), 1500),
    }

    # OPB_FILTER
    opb = data.get("OPB_FILTER") or {}
    opb_val = _str(opb.get("OPB_FILTER", ""))
    CONF["OPB_FLTR"] = {
        "OPB_FILTER": [x for x in opb_val.replace(" ", "").split(",") if x],
    }

    # ALIASES / FILES
    aliases = data.get("ALIASES") or {}
    if not isinstance(aliases, dict):
        aliases = {}
    path_val = _str(aliases.get("PATH", "./json")).strip().rstrip("/") or "./json"
    path_val = path_val.rstrip("/") + "/"  # always end with / for downstream (e.g. try_download)
    reload_hours = 24
    try:
        reload_hours = _int(aliases.get("STALE_HOURS"), 24)
    except (TypeError, ValueError):
        pass
    review_minutes = 5
    try:
        review_minutes = _int(aliases.get("REVIEW_INTERVAL_MINUTES"), 5)
    except (TypeError, ValueError):
        pass
    su = _str(aliases.get("SUBSCRIBER_URL", "https://adn.systems/files/subscriber_ids.json"))
    tgid_url = _str(aliases.get("TGID_URL", "https://adn.systems/files/talkgroup_ids.json"))
    server_id_url = _str(
        aliases.get("SERVER_ID_URL")
        or aliases.get("BRIDGE_LIST_URL")
        or _url_sibling(tgid_url, "server_ids.tsv")
    )
    tg_list_url = _str(aliases.get("TG_LIST_URL", tgid_url))
    bridge_list_url = _str(aliases.get("BRIDGE_LIST_URL", server_id_url))
    CONF["ALIASES"] = {k: _str(v) for k, v in aliases.items()}
    CONF["ALIASES"]["TG_LIST_URL"] = tg_list_url
    CONF["ALIASES"]["BRIDGE_LIST_URL"] = bridge_list_url
    CONF["ALIASES"]["SERVER_ID_URL"] = server_id_url
    CONF["FILES"] = {
        "PATH": path_val,
        "SUBS": _str(aliases.get("SUBSCRIBER_FILE", "subscriber_ids.json")),
        "PEER": _str(aliases.get("PEER_FILE", "peer_ids.json")),
        "TGID": _str(aliases.get("TGID_FILE", "talkgroup_ids.json")),
        "LCL_SUBS": _str(aliases.get("LOCAL_SUBSCRIBER_FILE", "")),
        "LCL_PEER": _str(aliases.get("LOCAL_PEER_FILE", "")),
        "LCL_TGID": _str(aliases.get("LOCAL_TGID_FILE", "")),
        "RELOAD_TIME": reload_hours * 3600,
        "REVIEW_INTERVAL": review_minutes * 60,
        "PEER_URL": _str(aliases.get("PEER_URL", "https://adn.systems/files/peer_ids.json")),
        "SUBS_URL": su,
        "SUBSCRIBER_URL": su,
        "TGID_URL": tgid_url,
        "SERVER_ID_URL": server_id_url,
        "CHECKSUM_URL": _str(aliases.get("CHECKSUM_URL", "https://adn.systems/files/file_checksums.json")),
        "CHECKSUM_FILE": _str(aliases.get("CHECKSUM_FILE", "file_checksums.json")),
        "TG_LIST_URL": tg_list_url,
        "BRIDGE_LIST_URL": bridge_list_url,
    }

    # LOGGER
    log = data.get("LOGGER") or {}
    log_path = _str(log.get("LOG_PATH", "./log"))
    log_file = _str(log.get("LOG_FILE", "adn-monitor.log"))
    enabled = True if "ENABLED" not in log else _bool(log.get("ENABLED"))
    CONF["LOG"] = {
        "ENABLED": enabled,
        "PATH": log_path,
        "LOG_FILE": log_file,
        "LOG_LEVEL": _str(log.get("LOG_LEVEL", "INFO")),
        "P2F_LOG": Path(log_path, log_file),
        "LOG_HANDLERS": [] if not enabled else ["console", "file"],
    }

    # MONITOR_APP — unified FastAPI (REST + WebSocket + ingest)
    app_block = data.get("MONITOR_APP") or {}
    ws_legacy = data.get("WEBSOCKET_SERVER") or {}
    resync_sec = _int(app_block.get("FREQUENCY"), _int(ws_legacy.get("FREQUENCY"), 1))
    client_timeout = _int(app_block.get("CLIENT_TIMEOUT"), _int(ws_legacy.get("CLIENT_TIMEOUT"), 0))
    ingest = _str(app_block.get("INGEST", "tcp")).lower() or "tcp"
    if ingest not in ("tcp", "mqtt"):
        return Failure(ConfigError(f"MONITOR_APP.INGEST must be 'tcp' or 'mqtt', got {ingest!r}"))
    mqtt_block = app_block.get("MQTT") if isinstance(app_block.get("MQTT"), dict) else {}
    mqtt_url = _str(mqtt_block.get("URL", "")).strip()
    mqtt_prefix = _str(mqtt_block.get("TOPIC_PREFIX", "")).strip()
    if ingest == "mqtt":
        if not mqtt_url:
            return Failure(ConfigError("MONITOR_APP.MQTT.URL is required when INGEST=mqtt"))
        if not mqtt_prefix:
            return Failure(ConfigError("MONITOR_APP.MQTT.TOPIC_PREFIX is required when INGEST=mqtt"))
    CONF["APP"] = {
        "LISTEN_HOST": _str(app_block.get("LISTEN_HOST", "")),
        "LISTEN_PORT": _int(app_block.get("LISTEN_PORT"), 8080),
        "INGEST": ingest,
        "FREQUENCY": resync_sec,
        "CLIENT_TIMEOUT": client_timeout,
        "CORS_ORIGINS": _str(app_block.get("CORS_ORIGINS", "")),
        "TRUSTED_PROXY_IPS": app_block.get("TRUSTED_PROXY_IPS"),
        "MQTT": {
            "URL": mqtt_url,
            "TOPIC_PREFIX": mqtt_prefix.rstrip("/"),
            "QOS": _int(mqtt_block.get("QOS"), 0),
        },
    }
    if ingest == "tcp" and (mqtt_url or mqtt_prefix):
        CONF["APP"]["MQTT_IGNORED"] = True

    # Legacy WEBSOCKET_SERVER YAML (Twisted stack); ignored by monitor.py (FastAPI)
    ssl_path = _str(ws_legacy.get("SSL_PATH", "./ssl"))
    listen_interface = _str(ws_legacy.get("LISTEN_INTERFACE", "")).strip()
    CONF["WS"] = {
        "WS_PORT": _int(ws_legacy.get("WEBSOCKET_PORT"), 9000),
        "LISTEN_INTERFACE": listen_interface if listen_interface else "",
        "USE_SSL": _bool(ws_legacy.get("USE_SSL", False)),
        "SSL_PATH": ssl_path,
        "SSL_CERT": _str(ws_legacy.get("SSL_CERTIFICATE", "cert.pem")),
        "P2F_CERT": Path(ssl_path, _str(ws_legacy.get("SSL_CERTIFICATE", "cert.pem"))),
        "SSL_PKEY": _str(ws_legacy.get("SSL_PRIVATEKEY", "key.pem")),
        "P2F_PKEY": Path(ssl_path, _str(ws_legacy.get("SSL_PRIVATEKEY", "key.pem"))),
        "FREQUENCY": resync_sec,
        "CLT_TO": client_timeout,
    }

    # SELF_SERVICE (DB)
    db = data.get("SELF_SERVICE") or {}
    if db:
        CONF["DB"] = {
            "SERVER": _str(db.get("DB_SERVER", "localhost")),
            "USER": _str(db.get("DB_USERNAME", "")),
            "PASSWD": _str(db.get("DB_PASSWORD", "")),
            "NAME": _str(db.get("DB_NAME", "")),
            "PORT": _int(db.get("DB_PORT"), 3306),
            "PBKDF2_SALT": _str(db.get("PBKDF2_SALT", "ADN")),
            "PBKDF2_ITERATIONS": _int(db.get("PBKDF2_ITERATIONS"), 2000),
            "USE_SELFSERVICE": _bool(db.get("USE_SELFSERVICE", True)),
        }

    # MAP (map page; kept as written for REST /api/config/dashboard)
    map_conf = data.get("MAP")
    if isinstance(map_conf, dict):
        CONF["MAP"] = dict(map_conf)

    # DASHBOARD (preserve nested nav_links/footer/news for REST /api/config/dashboard)
    dash = data.get("DASHBOARD") or {}
    if isinstance(dash, dict):
        CONF["DASHBOARD"] = dict(dash)
        CONF["DASHBOARD"]["MIN_DURATION"] = _int(dash.get("MIN_DURATION"), 3)
    else:
        CONF["DASHBOARD"] = {}

    return Success(CONF)

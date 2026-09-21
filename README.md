# ADN Systems Monitor

**Version 2.5.3** — pairs with **adn-server 2.0.0** (report v2 slim wire + JSON HELLO).

Releases are cut from **`master`** (merge `develop` → `master` when ready; semver from commit history since last tag).

Dashboard for ADN networks: unified **FastAPI** process (REST + WebSocket + report ingest), React frontend, and optional MySQL for self-service and Last Heard.

**v2 highlights:** PHP `backend/` and standalone `proxy/` were removed from this repo. Self-service, auth, and the dashboard API live in **`monitor/monitor.py`**. Hotspot UDP fan-in uses integrated **`PROXY`** in **adn-server**. The monitor ingests **report v2** `dashboard_state` from new-adn-server; legacy **adn-dmr-server** still works when HELLO is absent (pickle/CSV fallback).

---

## Architecture

| Part        | Folder      | Role |
|-------------|-------------|------|
| **Monitor** | `monitor/monitor.py` | FastAPI: `/api/*`, `/ws`, report ingest (TCP or MQTT). |
| **Frontend** | `frontend/` | Web UI (React). Static files after `npm run build`. |

- Frontend can run without the monitor API (no live dashboard data).
- In production you do not need Node running: it is only used to **build** the frontend; then serve `frontend/dist/` with Nginx or Apache (or let FastAPI serve static assets if configured).

---

## Requirements

- **Node.js** 18+ (frontend build only)
- **Python** 3.10+ (`monitor/requirements.txt`: FastAPI, Twisted for TCP ingest, PyYAML, mysqlclient, …)
- **MySQL** (for Self Service and monitor data if using DB)

---

## Configuration

### 1. Monitor config: `adn-monitor.yaml`

Dashboard and monitor behaviour are defined in YAML under the monitor folder:

- **Typical path:** `monitor/adn-monitor.yaml`
- Copy and adapt from `monitor/adn-monitor.yaml.example`. It configures:
  - **GLOBAL**: bridges, lastheard, TG count, optional **TIMEZONE** (IANA, e.g. `Europe/Madrid`) for logs/dashboard; **last_heard / lstheard_log** store **naive UTC** datetimes; **tg_count / user_count** use the **UTC calendar day** for the daily bucket (not `CURDATE()` in server TZ). The UI converts stored UTC to `TIMEZONE` when showing lastheard. If `TIMEZONE` is empty, lastheard uses the server’s local zone for display.
  - **SELF_SERVICE**: MySQL credentials (monitor API; same DB as adn-server self-service when enabled).
  - **MONITOR_APP**: `LISTEN_PORT` (REST `/api/*` + WebSocket `/ws` on the same port), `INGEST` (`tcp` or `mqtt`), optional MQTT block, `FREQUENCY` (background resync).
  - **ADN_CONNECTION**: IP and port of the ADN report server; optional **HELLO_TIMEOUT_MS** (wait for opcode `0xFF` HELLO from **adn-server** before assuming legacy **adn-dmr-server**). Detected mode is **legacy** or **v2** (JSON field `mode` on WebSocket messages prefixed with `v`). With v2, the footer shows **Monitor** and **Server** versions from HELLO.
  - **ALIASES**: URLs and files for alias (peers, subscribers, talkgroups).
  - **LOGGER**, **DASHBOARD** (title, language, nav/footer/news marquee links).
  - **MAP**: map page (`/map`). Tiles (light/dark) and attribution, first view, coordinate precision per system type, country fallback for systems that report no position, optional external GPS/APRS feed and per-peer coordinate overrides. See the **Map** section below.

Paths inside the YAML (e.g. `LOG_PATH`, `PATH` for alias files) are relative to the **monitor/** directory when you run the monitor from there.

### 2. Environment: `.env`

A single **`.env` in the project root** is used by all components. Create it from the example:

```bash
cp .env.example .env
```

Edit `.env` and set at least:

| Variable | Purpose |
|----------|---------|
| **ADN_CONFIG_PATH** | Absolute path to `adn-monitor.yaml`. e.g. `/opt/adn-monitor/monitor/adn-monitor.yaml` |
| **VITE_API_BASE** | Frontend build: API base URL. **Empty** = same origin (Nginx proxies `/api` to `monitor.py`). |
| **VITE_DEFAULT_LANGUAGE** | Default UI language at build time (`en`, `es`, …). |

Everything else (DB, aliases, ingest, timezone) lives in **`adn-monitor.yaml`**, not in `.env`.

- **Monitor** (`monitor.py`, `db_bootstrap.py`): auto-load root `.env` on start; systemd uses `EnvironmentFile`.
- **Frontend (Vite)**: reads the same root `.env` (`VITE_*` only). Do not use `frontend/.env`.

---

## Running (development)

Two terminals.

### Terminal 1: Monitor API

```bash
cd /opt/adn-monitor/monitor
pip install -r requirements.txt
./run.sh
# or: python3 monitor.py -c adn-monitor.yaml
```

Default listen: **http://localhost:8080** (`MONITOR_APP.LISTEN_PORT`). Health: `GET /api/health`.

### Terminal 2: Web UI (React)

```bash
cd /opt/adn-monitor/frontend
npm install
npm run dev
```

Vite proxies `/api` and `/ws` to port **8080** (same host as the monitor API).

---

## Production deployment (full howto)

### 1. Database (MySQL)

Create a user and database for the monitor (credentials go in `adn-monitor.yaml`, **SELF_SERVICE** section). Then create or update tables from the monitor:

```bash
cd /opt/adn-monitor/monitor
python3 db_bootstrap.py --config adn-monitor.yaml --create   # create tables
python3 db_bootstrap.py --config adn-monitor.yaml --update   # migrations
```

### 2. Configuration

- Place **adn-monitor.yaml** in `monitor/` (or your chosen path) and set **ADN_CONFIG_PATH** in `.env`.
- In the project root: `cp .env.example .env` and fill **ADN_CONFIG_PATH**, **VITE_API_BASE**, etc. for production.

### 3. Frontend build

```bash
cd /opt/adn-monitor/frontend
npm install
npm run build
```

Output is in `frontend/dist/`. That directory is what Nginx (or Apache) will serve.

### 4. Monitor API as a service (systemd)

An example unit is in the repo:

```bash
sudo cp /opt/adn-monitor/examples/systemd/adn-monitor.service /etc/systemd/system/
# Adjust WorkingDirectory and ExecStart if your install is not under /opt/adn-monitor
sudo systemctl daemon-reload
sudo systemctl enable adn-monitor
sudo systemctl start adn-monitor
```

The example runs **`monitor.py`**. Install deps for that Python: `pip install -r monitor/requirements.txt`.

### 5. Nginx (example)

Unified upstream (recommended): `/api` and `/ws` → `MONITOR_APP.LISTEN_PORT` (default 8080):

```bash
sudo cp /opt/adn-monitor/examples/nginx-adn-monitor.conf /etc/nginx/sites-enabled/
```

Edit the file and set:

- **server_name** (your domains)
- **root** (path to `frontend/dist`)
- **upstream** `adn_monitor_api` (127.0.0.1:8080 or your `LISTEN_PORT`)
- If using HTTPS: certificate paths and the `listen 443 ssl` block (commented in the example)

Then:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

### 6. Production checklist

1. MySQL created and `db_bootstrap.py --create` / `--update` run.
2. `adn-monitor.yaml` and `.env` configured; **ADN_CONFIG_PATH** set.
3. `npm run build` in `frontend/`; Nginx serves `frontend/dist/`.
4. `monitor.py` running (systemd); Nginx proxies `/api` and `/ws` to `LISTEN_PORT`.
5. **adn-server** **2.0.0** (report v2 slim wire + JSON HELLO; upgrade/restart if the footer shows an older server version).

---

## Examples in the repo

| File | Description |
|------|-------------|
| **examples/systemd/adn-monitor.service** | Example systemd unit (`monitor.py`; system Python). |
| **examples/nginx-adn-monitor.conf** | Nginx: static frontend + FastAPI `/api` + `/ws`. |

Copy and adapt paths, domains, and certificates to your server.

---

## Map

`/map` draws the network on one map and lets each visitor pick the layers:
repeaters, hotspots, bridges, traffic **on air** right now (both this server's
peers and the calls coming in over OpenBridge) and, when configured, an
external **GPS** feed. It
remembers the chosen layers and view, and has a full-screen mode for phones.

Tiles come from OpenStreetMap and, with the dark theme, are darkened with a CSS
filter, so no second tile provider and no API key are needed. `MAP.TILE_URL_DARK`
switches to a real dark basemap if you have one.

Positions come from the `LATITUDE` / `LONGITUDE` a peer sends in its login
(RPTC). Peers that report none are hidden, or drawn dashed over their country
(DMR ID prefix) when `APPROX_BY_COUNTRY` is on; `OVERRIDES` pins exact
coordinates for a given peer ID.

Privacy: a hotspot's coordinates are usually someone's home, so
`HOTSPOT_PRECISION` (2 decimals, about 1 km) rounds them **before** they are
sent to the browser. Set it to `null` to publish them as reported.

The page is switched on and off with `DASHBOARD.SHOW_MAP` (same shape as
`SHOW_CONSOLE`) or with `MAP.ENABLED`; `SHOW_MAP` wins when both are set. Off,
neither the page nor its navbar entry exists.

With **adn-server** (v2) the map needs a server that includes `latitude` /
`longitude` in its `dashboard_state` report; with the legacy **adn-dmr-server**
they are already in `CONFIG`.

## IPv6 support

To run the whole project over IPv6 (or dual-stack):

| Component | What to do |
|-----------|------------|
| **Monitor API** | Set `MONITOR_APP.LISTEN_HOST` to `::` for dual-stack (uvicorn bind). |
| **Monitor – connection to ADN** | Set `ADN_CONNECTION.ADN_IP` to the report server’s IPv6 address (or hostname that resolves to IPv6). No code change. |
| **Nginx** | Listen on `[::]:80` / `[::]:443`; proxy to the monitor API on localhost or `::1`. |
| **Hotspot proxy** | Configure **`PROXY`** in **adn-server.yaml** (see adn-server docs). |
| **Frontend** | No change; it uses the same API/WebSocket URLs. If the server is reachable via IPv6, the browser will use it when available. |

---

## License and credits

This project is **GPL v3**. The **monitor** (Python) and **frontend** (React dashboard) are derivatives of the following works:

| Project | Author | Description |
|--------|--------|-------------|
| **FDMR Monitor** | OA4DOA | FDMR Monitor for FreeDMR Server based on HBMonv2 — [github.com/yuvelq/FDMR-Monitor](https://github.com/yuvelq/FDMR-Monitor) |
| **HBMonv2** | SP2ONG | HBMonitor v2 for DMR Server based on HBlink/FreeDMR — [github.com/sp2ong/HBMonv2](https://github.com/sp2ong/HBMonv2) |
| **hbmonitor3** | KC1AWV | Python 3 implementation of N0MJS HBmonitor for HBlink — [github.com/kc1awv/hbmonitor3](https://github.com/kc1awv/hbmonitor3) |
| **HBmonitor** | Cortney T. Buffington, N0MJS | Original HBmonitor (Copyright (C) 2013-2018, n0mjs@me.com) |

**This codebase:** Copyright (C) 2026 Rodrigo Pérez, CE5RPY. Original works and these derivatives are free software under the [GNU General Public License v3](https://www.gnu.org/licenses/gpl-3.0.html). Preserve license and attribution when distributing or modifying.

## Acknowledgments

Thanks to **[Esteban Mackay, HP3ICC](https://gitlab.com/hp3icc)**, for ideas, help, testing, and suggestions throughout development.

---

## Further reading

- **Changelog:** [CHANGELOG.md](CHANGELOG.md)
- **YAML config:** options and sections in `monitor/adn-monitor.yaml.example`
- **adn-server:** report v2 and monitoring — [ADN-DMR-Peer-Server docs](https://github.com/ce5rpy/ADN-DMR-Peer-Server)

---

[Español](README_es.md)

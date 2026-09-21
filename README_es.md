# ADN Systems Monitor

**Versión 2.5.3** — emparejado con **adn-server 2.0.0** (report v2 slim wire + HELLO JSON).

Dashboard para redes ADN: proceso **FastAPI** unificado (REST + WebSocket + ingest de informes), frontend React y MySQL opcional para self-service y Last Heard.

**Novedades v2:** se eliminaron **`backend/`** (PHP) y **`proxy/`** (proxy UDP standalone) de este repositorio. Self-service, auth y la API del dashboard viven en **`monitor/monitor.py`**. El fan-in UDP de hotspots usa **`PROXY`** integrado en **adn-server**. El monitor ingiere **report v2** `dashboard_state` desde new-adn-server; **adn-dmr-server** legacy sigue funcionando cuando no hay HELLO (fallback pickle/CSV).

---

## Arquitectura

| Parte | Carpeta | Rol |
|-------|---------|-----|
| **Monitor** | `monitor/monitor.py` | FastAPI: `/api/*`, `/ws`, ingest de informes (TCP o MQTT). |
| **Frontend** | `frontend/` | UI web (React). Archivos estáticos tras `npm run build`. |

- El frontend puede ejecutarse sin la API del monitor (sin datos en vivo en el dashboard).
- En producción no hace falta Node en runtime: solo se usa para **compilar** el frontend; luego sirve `frontend/dist/` con Nginx o Apache (o FastAPI puede servir estáticos si está configurado).

---

## Requisitos

- **Node.js** 18+ (solo build del frontend)
- **Python** 3.10+ (`monitor/requirements.txt`: FastAPI, Twisted para ingest TCP, PyYAML, mysqlclient, …)
- **MySQL** (para Self Service y datos del monitor si usas BD)

---

## Configuración

### 1. Config del monitor: `adn-monitor.yaml`

El comportamiento del dashboard y del monitor se define en YAML bajo la carpeta monitor:

- **Ruta típica:** `monitor/adn-monitor.yaml`
- Copia y adapta desde `monitor/adn-monitor.yaml.example`. Configura:
  - **GLOBAL**: bridges, lastheard, conteo de TG, **TIMEZONE** opcional (IANA, p. ej. `Europe/Madrid`) para logs/dashboard; **last_heard / lstheard_log** guardan datetimes **UTC naive**; **tg_count / user_count** usan el **día calendario UTC** para el bucket diario (no `CURDATE()` en la TZ del servidor). La UI convierte UTC almacenado a **TIMEZONE** al mostrar lastheard. Si **TIMEZONE** está vacío, lastheard usa la zona local del servidor para mostrar.
  - **SELF_SERVICE**: credenciales MySQL (API del monitor; misma BD que self-service de adn-server cuando está habilitado).
  - **MONITOR_APP**: `LISTEN_PORT` (REST `/api/*` + WebSocket `/ws` en el mismo puerto), `INGEST` (`tcp` o `mqtt`), bloque MQTT opcional, `FREQUENCY` (resync en background).
  - **ADN_CONNECTION**: IP y puerto del report server ADN; **HELLO_TIMEOUT_MS** opcional (esperar HELLO opcode `0xFF` de **adn-server** antes de asumir **adn-dmr-server** legacy). El modo detectado es **legacy** o **v2** (campo JSON `mode` en mensajes WebSocket con prefijo `v`). Con v2, el footer muestra versiones **Monitor** y **Server** desde HELLO.
  - **ALIASES**: URLs y archivos de alias (peers, suscriptores, talkgroups).
  - **LOGGER**, **DASHBOARD** (título, idioma, enlaces nav/footer/news marquee).
  - **MAP**: página de mapa (`/map`). Teselas (claras/oscuras) y atribución, vista inicial, precisión de coordenadas por tipo de sistema, respaldo por país para los sistemas que no informan posición, feed GPS/APRS externo opcional y coordenadas fijas por peer. Ver la sección **Mapa** más abajo.

Las rutas dentro del YAML (p. ej. `LOG_PATH`, `PATH` de archivos de alias) son relativas al directorio **monitor/** cuando ejecutas el monitor desde ahí.

### 2. Entorno: `.env`

Un único **`.env` en la raíz del proyecto** lo usan todos los componentes. Créalo desde el ejemplo:

```bash
cp .env.example .env
```

Edita `.env` y define al menos:

| Variable | Propósito |
|----------|-----------|
| **ADN_CONFIG_PATH** | Ruta absoluta a `adn-monitor.yaml`. p. ej. `/opt/adn-monitor/monitor/adn-monitor.yaml` |
| **VITE_API_BASE** | Build del frontend: URL base de la API. **Vacío** = mismo origen (Nginx hace proxy de `/api` a `monitor.py`). |
| **VITE_DEFAULT_LANGUAGE** | Idioma por defecto de la UI en build time (`en`, `es`, …). |

Todo lo demás (BD, aliases, ingest, timezone) va en **`adn-monitor.yaml`**, no en `.env`.

- **Monitor** (`monitor.py`, `db_bootstrap.py`): carga automática del `.env` raíz al arrancar; systemd usa `EnvironmentFile`.
- **Frontend (Vite)**: lee el mismo `.env` raíz (solo `VITE_*`). No uses `frontend/.env`.

---

## Ejecución (desarrollo)

Dos terminales.

### Terminal 1: API del monitor

```bash
cd /opt/adn-monitor/monitor
pip install -r requirements.txt
./run.sh
# o: python3 monitor.py -c adn-monitor.yaml
```

Escucha por defecto: **http://localhost:8080** (`MONITOR_APP.LISTEN_PORT`). Health: `GET /api/health`.

### Terminal 2: UI web (React)

```bash
cd /opt/adn-monitor/frontend
npm install
npm run dev
```

Vite hace proxy de `/api` y `/ws` al puerto **8080** (mismo host que la API del monitor).

---

## Despliegue en producción (guía completa)

### 1. Base de datos (MySQL)

Crea usuario y base de datos para el monitor (credenciales en `adn-monitor.yaml`, sección **SELF_SERVICE**). Luego crea o actualiza tablas desde el monitor:

```bash
cd /opt/adn-monitor/monitor
python3 db_bootstrap.py --config adn-monitor.yaml --create   # crear tablas
python3 db_bootstrap.py --config adn-monitor.yaml --update   # migraciones
```

### 2. Configuración

- Coloca **adn-monitor.yaml** en `monitor/` (o la ruta que elijas) y define **ADN_CONFIG_PATH** en `.env`.
- En la raíz del proyecto: `cp .env.example .env` y completa **ADN_CONFIG_PATH**, **VITE_API_BASE**, etc. para producción.

### 3. Build del frontend

```bash
cd /opt/adn-monitor/frontend
npm install
npm run build
```

La salida queda en `frontend/dist/`. Ese directorio es lo que servirá Nginx (o Apache).

### 4. API del monitor como servicio (systemd)

Hay una unidad de ejemplo en el repo:

```bash
sudo cp /opt/adn-monitor/examples/systemd/adn-monitor.service /etc/systemd/system/
# Ajusta WorkingDirectory y ExecStart si tu instalación no está bajo /opt/adn-monitor
sudo systemctl daemon-reload
sudo systemctl enable adn-monitor
sudo systemctl start adn-monitor
```

El ejemplo ejecuta **`monitor.py`**. Instala deps para ese Python: `pip install -r monitor/requirements.txt`.

### 5. Nginx (ejemplo)

Upstream unificado (recomendado): `/api` y `/ws` → `MONITOR_APP.LISTEN_PORT` (por defecto 8080):

```bash
sudo cp /opt/adn-monitor/examples/nginx-adn-monitor.conf /etc/nginx/sites-enabled/
```

Edita el archivo y define:

- **server_name** (tus dominios)
- **root** (ruta a `frontend/dist`)
- **upstream** `adn_monitor_api` (127.0.0.1:8080 o tu `LISTEN_PORT`)
- Si usas HTTPS: rutas de certificados y el bloque `listen 443 ssl` (comentado en el ejemplo)

Luego:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

### 6. Checklist de producción

1. MySQL creado y ejecutado `db_bootstrap.py --create` / `--update`.
2. `adn-monitor.yaml` y `.env` configurados; **ADN_CONFIG_PATH** definido.
3. `npm run build` en `frontend/`; Nginx sirve `frontend/dist/`.
4. `monitor.py` en ejecución (systemd); Nginx hace proxy de `/api` y `/ws` a `LISTEN_PORT`.
5. **adn-server** **2.0.0** (report v2 slim wire + HELLO JSON; actualiza/reinicia si el footer muestra una versión antigua del servidor).

---

## Ejemplos en el repo

| Archivo | Descripción |
|---------|-------------|
| **examples/systemd/adn-monitor.service** | Unidad systemd de ejemplo (`monitor.py`; Python del sistema). |
| **examples/nginx-adn-monitor.conf** | Nginx: frontend estático + FastAPI `/api` + `/ws`. |

Copia y adapta rutas, dominios y certificados a tu servidor.

---

## Mapa

`/map` dibuja la red en un solo mapa y deja que cada visitante elija las capas:
repetidores, hotspots, puentes, el tráfico **en el aire** en ese momento (tanto
los peers de este servidor como las llamadas que entran por OpenBridge) y, si se
configura, un feed **GPS** externo. Recuerda las capas y la vista elegidas, y tiene pantalla completa para
el móvil.

Las teselas son de OpenStreetMap y, con el tema oscuro, se oscurecen con un
filtro CSS: no hace falta un segundo proveedor ni ninguna API key.
`MAP.TILE_URL_DARK` permite usar un basemap oscuro de verdad si lo tienes.

Las posiciones salen de `LATITUDE` / `LONGITUDE` que el peer envía al
conectarse (RPTC). Los peers que no las informan quedan fuera, o se dibujan
discontinuos sobre su país (prefijo del DMR ID) si `APPROX_BY_COUNTRY` está
activo; `OVERRIDES` fija coordenadas exactas para un peer concreto.

Privacidad: las coordenadas de un hotspot suelen ser el domicilio de alguien,
así que `HOTSPOT_PRECISION` (2 decimales, alrededor de 1 km) las redondea
**antes** de enviarlas al navegador. Ponlo a `null` para publicarlas tal cual.

La página se activa y desactiva con `DASHBOARD.SHOW_MAP` (igual que
`SHOW_CONSOLE`) o con `MAP.ENABLED`; si están los dos, manda `SHOW_MAP`.
Desactivada no existen ni la página ni su entrada en el menú.

Con **adn-server** (v2) el mapa necesita un servidor que incluya `latitude` /
`longitude` en su informe `dashboard_state`; con el **adn-dmr-server** legacy ya
vienen en `CONFIG`.

## Soporte IPv6

Para ejecutar todo el proyecto sobre IPv6 (o dual-stack):

| Componente | Qué hacer |
|------------|-----------|
| **API del monitor** | Define `MONITOR_APP.LISTEN_HOST` a `::` para dual-stack (bind uvicorn). |
| **Monitor – conexión a ADN** | Define `ADN_CONNECTION.ADN_IP` a la dirección IPv6 del report server (o hostname que resuelva a IPv6). Sin cambio de código. |
| **Nginx** | Escucha en `[::]:80` / `[::]:443`; proxy a la API del monitor en localhost o `::1`. |
| **Proxy hotspot** | Configura **`PROXY`** en **adn-server.yaml** (ver docs de adn-server). |
| **Frontend** | Sin cambios; usa las mismas URLs de API/WebSocket. Si el servidor es alcanzable por IPv6, el navegador lo usará cuando esté disponible. |

---

## Licencia y créditos

Este proyecto es **GPL v3**. El **monitor** (Python) y el **frontend** (dashboard React) son derivados de las siguientes obras:

| Proyecto | Autor | Descripción |
|----------|-------|-------------|
| **FDMR Monitor** | OA4DOA | FDMR Monitor for FreeDMR Server based on HBMonv2 — [github.com/yuvelq/FDMR-Monitor](https://github.com/yuvelq/FDMR-Monitor) |
| **HBMonv2** | SP2ONG | HBMonitor v2 for DMR Server based on HBlink/FreeDMR — [github.com/sp2ong/HBMonv2](https://github.com/sp2ong/HBMonv2) |
| **hbmonitor3** | KC1AWV | Python 3 implementation of N0MJS HBmonitor for HBlink — [github.com/kc1awv/hbmonitor3](https://github.com/kc1awv/hbmonitor3) |
| **HBmonitor** | Cortney T. Buffington, N0MJS | HBmonitor original (Copyright (C) 2013-2018, n0mjs@me.com) |

**Este código:** Copyright (C) 2026 Rodrigo Pérez, CE5RPY. Las obras originales y estos derivados son software libre bajo la [GNU General Public License v3](https://www.gnu.org/licenses/gpl-3.0.html). Conserva licencia y atribución al distribuir o modificar.

## Agradecimientos

Gracias a **[Esteban Mackay, HP3ICC](https://gitlab.com/hp3icc)**, por las ideas, ayudas, pruebas y sugerencias a lo largo del desarrollo.

---

## Lecturas adicionales

- **Changelog:** [CHANGELOG.md](CHANGELOG.md)
- **Config YAML:** opciones y secciones en `monitor/adn-monitor.yaml.example`
- **adn-server:** report v2 y monitorización — [documentación ADN-DMR-Peer-Server](https://github.com/ce5rpy/ADN-DMR-Peer-Server)

---

[English](README.md)

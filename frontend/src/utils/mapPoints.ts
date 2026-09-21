/*
 * ADN Monitor - Dashboard and backend for ADN Systems.
 * Copyright (C) 2026  Rodrigo Pérez, CE5RPY <ce5rpy@qmd.cl>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * Derived from: FDMR Monitor (OA4DOA, https://github.com/yuvelq/FDMR-Monitor);
 * HBMonv2 (SP2ONG, https://github.com/sp2ong/HBMonv2);
 * hbmonitor3 (KC1AWV, https://github.com/kc1awv/hbmonitor3);
 * HBmonitor (Cortney T. Buffington, N0MJS, Copyright (C) 2013-2018).
 * Original works and this derivative are under GPLv3.
 */

/** Turn the WebSocket ctable and Last Heard rows into markers for the map page. */

import { centroidForDmrId } from './countryCentroids';
import type { MapConfig } from '../context/DashboardConfigContext';

export type TsEntry = {
  TS?: boolean | string;
  TYPE?: string;
  SUB?: string;
  CALL?: string;
  SRC?: string | number;
  DEST?: string;
  TG?: string;
  TRX?: string;
};

export type PeerEntry = Record<string, unknown> & {
  CALLSIGN?: string;
  LOCATION?: string;
  LATITUDE?: string | number;
  LONGITUDE?: string | number;
  RX_FREQ?: string;
  TX_FREQ?: string;
  COLORCODE?: string | number;
  CONNECTED?: string;
  RADIO_ID?: string | number;
  MODE?: string;
  STATS?: { CONNECTION?: string; CONNECTED?: string };
  1?: TsEntry;
  2?: TsEntry;
};

/** OPENBRIDGES[system].STREAMS[id] = [trx, callsign, tg, timeout, sourceDmrId?] */
export type OpenBridgeStream = [string, string, string, number, (string | number)?];

export type Ctable = {
  MASTERS?: Record<string, { PEERS?: Record<string, PeerEntry> }>;
  PEERS?: Record<string, PeerEntry>;
  OPENBRIDGES?: Record<string, { STREAMS?: Record<string, OpenBridgeStream> }>;
};

/** Repeaters and hotspots are told apart the same way as on the Linked Systems page. */
export type PointKind = 'repeater' | 'hotspot' | 'bridge';
/** Where the coordinates came from; anything but ``reported`` is drawn as approximate. */
export type PointSource = 'reported' | 'override' | 'country';

export type PeerPoint = {
  key: string;
  peerId: string;
  system: string;
  callsign: string;
  location: string;
  kind: PointKind;
  lat: number;
  lon: number;
  source: PointSource;
  rxFreq: string;
  txFreq: string;
  colorcode: string;
  connected: string;
  /** A call is passing through this system right now. */
  active: boolean;
  /** The call started on this system's RF side (it is the one being keyed). */
  activeRx: boolean;
  activeCall: string;
  activeTg: string;
};

export type GpsPoint = {
  key: string;
  callsign: string;
  comment: string;
  lat: number;
  lon: number;
};

const ZERO_ISLAND = 0.0005;
/** Degrees of spread for the pseudo-random offset so peers sharing one country
 * centroid do not stack up on the same point. */
const COUNTRY_JITTER_SPREAD_DEG = 1.1;

/** Accept "41.1234", "41,1234", " -3.70 " and the N/S/E/W suffixes some radios send. */
export function parseCoordinate(raw: unknown, max: number): number | null {
  if (raw === null || raw === undefined) return null;
  let text = String(raw).trim().replace(',', '.');
  if (!text) return null;
  let sign = 1;
  const hemisphere = text.match(/^([NSEW])|([NSEW])$/i);
  if (hemisphere) {
    const letter = (hemisphere[1] || hemisphere[2] || '').toUpperCase();
    if (letter === 'S' || letter === 'W') sign = -1;
    text = text.replace(/^[NSEW]|[NSEW]$/i, '').trim();
  }
  const value = Number.parseFloat(text);
  if (!Number.isFinite(value)) return null;
  const signed = sign * value;
  if (Math.abs(signed) > max) return null;
  return signed;
}

/** Coarsen coordinates before they reach the browser-side marker (privacy option). */
export function roundCoordinate(value: number, decimals: number | null): number {
  if (decimals === null || decimals < 0) return value;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function isZeroIsland(lat: number, lon: number): boolean {
  return Math.abs(lat) < ZERO_ISLAND && Math.abs(lon) < ZERO_ISLAND;
}

/** Stable pseudo-random offset so peers sharing one centroid do not stack up. */
function jitter(seed: string, spread: number): [number, number] {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  const a = ((hash >>> 8) & 0xffff) / 0xffff - 0.5;
  const b = ((hash >>> 20) & 0xfff) / 0xfff - 0.5;
  return [a * spread, b * spread * 1.6];
}

export function peerKind(peerId: string, peer: PeerEntry): PointKind {
  const rx = String(peer.RX_FREQ ?? '');
  const tx = String(peer.TX_FREQ ?? '');
  if (rx === 'N/A' && tx === 'N/A') return 'bridge';
  return peerId.length >= 7 ? 'hotspot' : 'repeater';
}

function tsActive(ts: TsEntry | undefined): boolean {
  if (!ts) return false;
  const value = ts.TS;
  if (value === true) return true;
  return typeof value === 'string' && value.toLowerCase() !== 'false' && value !== '';
}

function getTs(peer: PeerEntry, tsNum: 1 | 2): TsEntry | undefined {
  return peer[tsNum] ?? (peer as Record<string, TsEntry | undefined>)[String(tsNum)];
}

function cleanText(value: unknown): string {
  return String(value ?? '').replace(/&nbsp;/g, ' ').trim();
}

type Resolved = { lat: number; lon: number; source: PointSource } | null;

function resolvePosition(
  peerId: string,
  peer: PeerEntry,
  kind: PointKind,
  config: MapConfig,
  allowApprox: boolean,
): Resolved {
  const override = config.overrides[peerId];
  if (override) {
    return { lat: override[0], lon: override[1], source: 'override' };
  }
  const lat = parseCoordinate(peer.LATITUDE, 90);
  const lon = parseCoordinate(peer.LONGITUDE, 180);
  if (lat !== null && lon !== null && !isZeroIsland(lat, lon)) {
    const decimals = kind === 'hotspot' ? config.hotspotPrecision : config.repeaterPrecision;
    return {
      lat: roundCoordinate(lat, decimals),
      lon: roundCoordinate(lon, decimals),
      source: 'reported',
    };
  }
  if (!allowApprox) return null;
  const centroid = centroidForDmrId(peerId);
  if (!centroid) return null;
  const [dLat, dLon] = jitter(peerId, COUNTRY_JITTER_SPREAD_DEG);
  return { lat: centroid.lat + dLat, lon: centroid.lon + dLon, source: 'country' };
}

/** Markers for every connected peer (repeaters, hotspots and bridges/services). */
export function buildPeerPoints(
  ctable: Ctable | null | undefined,
  config: MapConfig,
  allowApprox: boolean,
): PeerPoint[] {
  const points: PeerPoint[] = [];
  if (!ctable) return points;

  const pushPeer = (system: string, peerId: string, peer: PeerEntry, kind: PointKind) => {
    const position = resolvePosition(peerId, peer, kind, config, allowApprox);
    if (!position) return;
    const ts1 = getTs(peer, 1);
    const ts2 = getTs(peer, 2);
    const activeTs = [ts1, ts2].filter(tsActive);
    const rxTs = activeTs.find((ts) => String(ts?.TRX ?? '').toUpperCase() === 'RX');
    const shown = rxTs ?? activeTs[0];
    points.push({
      key: `${system}/${peerId}`,
      peerId,
      system,
      callsign: cleanText(peer.CALLSIGN),
      location: cleanText(peer.LOCATION),
      kind,
      lat: position.lat,
      lon: position.lon,
      source: position.source,
      rxFreq: cleanText(peer.RX_FREQ),
      txFreq: cleanText(peer.TX_FREQ),
      colorcode: cleanText(peer.COLORCODE),
      connected: cleanText(peer.CONNECTED),
      active: activeTs.length > 0,
      activeRx: Boolean(rxTs),
      activeCall: cleanText(shown?.CALL || shown?.SUB),
      activeTg: cleanText(shown?.TG || shown?.DEST),
    });
  };

  for (const [system, master] of Object.entries(ctable.MASTERS ?? {})) {
    for (const [peerId, peer] of Object.entries(master?.PEERS ?? {})) {
      pushPeer(system, String(peerId), peer, peerKind(String(peerId), peer));
    }
  }
  for (const [system, peer] of Object.entries(ctable.PEERS ?? {})) {
    const radioId = String(peer?.RADIO_ID ?? '');
    if (!radioId || radioId === '0') continue;
    pushPeer(system, radioId, peer, 'bridge');
  }
  return points;
}

type GeoJsonFeature = {
  geometry?: { type?: string; coordinates?: unknown };
  properties?: Record<string, unknown>;
};

/**
 * Optional external position feed (MAP.GPS_URL): GeoJSON points, a plain array
 * or ``{ stations: [...] }`` with lat/lon (or lng) plus an optional callsign.
 */
export function parseGpsFeed(data: unknown): GpsPoint[] {
  const points: GpsPoint[] = [];
  const pushRaw = (entry: Record<string, unknown>, index: number) => {
    const lat = parseCoordinate(entry.lat ?? entry.latitude, 90);
    const lon = parseCoordinate(entry.lon ?? entry.lng ?? entry.longitude, 180);
    if (lat === null || lon === null) return;
    points.push({
      key: `gps-${String(entry.callsign ?? entry.name ?? index)}-${index}`,
      callsign: cleanText(entry.callsign ?? entry.name ?? ''),
      comment: cleanText(entry.comment ?? entry.info ?? entry.status ?? ''),
      lat,
      lon,
    });
  };

  if (Array.isArray(data)) {
    data.forEach((entry, index) => {
      if (entry && typeof entry === 'object') pushRaw(entry as Record<string, unknown>, index);
    });
    return points;
  }
  if (!data || typeof data !== 'object') return points;

  const doc = data as Record<string, unknown>;
  if (Array.isArray(doc.features)) {
    (doc.features as GeoJsonFeature[]).forEach((feature, index) => {
      const coords = feature?.geometry?.coordinates;
      if (!Array.isArray(coords) || coords.length < 2) return;
      const lon = parseCoordinate(coords[0], 180);
      const lat = parseCoordinate(coords[1], 90);
      if (lat === null || lon === null) return;
      const properties = feature.properties ?? {};
      points.push({
        key: `gps-${String(properties.callsign ?? properties.name ?? index)}-${index}`,
        callsign: cleanText(properties.callsign ?? properties.name ?? ''),
        comment: cleanText(properties.comment ?? properties.info ?? properties.status ?? ''),
        lat,
        lon,
      });
    });
    return points;
  }
  for (const key of ['stations', 'points', 'entries', 'results']) {
    const list = doc[key];
    if (Array.isArray(list)) {
      list.forEach((entry, index) => {
        if (entry && typeof entry === 'object') pushRaw(entry as Record<string, unknown>, index);
      });
      return points;
    }
  }
  return points;
}

/**
 * Calls arriving right now over OpenBridge, i.e. traffic from the rest of the
 * network. No system on the far side reports coordinates, so each call is
 * placed over the country of the transmitting DMR ID and drawn as approximate.
 */
export function buildOpenBridgePoints(
  ctable: Ctable | null | undefined,
  allowApprox: boolean,
  maxAgeSec = 120,
): PeerPoint[] {
  const points: PeerPoint[] = [];
  if (!ctable?.OPENBRIDGES || !allowApprox) return points;
  const nowSec = Date.now() / 1000;
  const seen = new Set<string>();

  for (const [system, bridge] of Object.entries(ctable.OPENBRIDGES)) {
    for (const [streamId, entry] of Object.entries(bridge?.STREAMS ?? {})) {
      if (!Array.isArray(entry) || entry.length < 3) continue;
      const trx = String(entry[0] ?? '').toUpperCase();
      // RX = the call is coming in from that bridge; TX is our own echo of it.
      if (trx !== 'RX') continue;
      const callsign = cleanText(entry[1]);
      const tg = cleanText(entry[2]);
      const dmrId = cleanText(entry.length >= 5 ? entry[4] : '');
      // Started-at stamp: drop streams whose END never arrived. A clock skew
      // between server and browser only shows them for longer, never less.
      const startedAt = Number(entry[3]);
      if (Number.isFinite(startedAt) && startedAt > 0 && nowSec - startedAt > maxAgeSec) continue;
      const dedupeKey = `${dmrId}/${tg}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      const centroid = centroidForDmrId(dmrId);
      if (!centroid) continue;
      const [dLat, dLon] = jitter(dmrId || streamId, COUNTRY_JITTER_SPREAD_DEG);
      points.push({
        key: `obp-${system}-${streamId}`,
        peerId: dmrId,
        system,
        callsign,
        location: centroid.name,
        kind: 'bridge',
        lat: centroid.lat + dLat,
        lon: centroid.lon + dLon,
        source: 'country',
        rxFreq: '',
        txFreq: '',
        colorcode: '',
        connected: '',
        active: true,
        activeRx: true,
        activeCall: callsign,
        activeTg: tg,
      });
    }
  }
  return points;
}

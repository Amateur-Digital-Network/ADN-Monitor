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

/** Leaflet canvas for the map page: tiles follow the theme, markers are reconciled in place. */

import { useEffect, useMemo, useRef } from 'react';
import { Box, GlobalStyles, useTheme } from '@mui/material';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import type { MapConfig } from '../../context/DashboardConfigContext';
import type { GpsPoint, PeerPoint } from '../../utils/mapPoints';
import { MARKER_COLORS, type MapLabels } from './markerStyles';

type LiveMapProps = {
  peers: PeerPoint[];
  gps: GpsPoint[];
  config: MapConfig;
  labels: MapLabels;
  /** Bumped by the page to re-fit the view to the visible markers. */
  fitSignal: number;
  /** Keep the newest transmitting system in view. */
  follow: boolean;
  onSelect?: (point: PeerPoint) => void;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function qrzLink(callsign: string, label: string): string {
  const call = callsign.split(/[\s,]/)[0]?.toUpperCase() ?? '';
  if (!/^[A-Z0-9]{3,}(\/[A-Z0-9]+)?$/.test(call)) return '';
  return `<a href="https://www.qrz.com/db/${encodeURIComponent(call)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
}

function row(label: string, value: string): string {
  if (!value) return '';
  return `<div class="adn-pop-row"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`;
}

function peerPopup(point: PeerPoint, labels: MapLabels): string {
  const kindLabel = labels[point.kind];
  const title = point.callsign || point.peerId;
  const qrz = qrzLink(point.callsign, labels.qrz);
  const freq = [point.rxFreq, point.txFreq].filter((f) => f && f !== 'N/A').join(' / ');
  return [
    `<div class="adn-pop-title">${escapeHtml(title)} <span>${escapeHtml(point.peerId)}</span></div>`,
    `<div class="adn-pop-kind">${escapeHtml(kindLabel)}${point.source !== 'reported' ? ` · ${escapeHtml(labels.approx)}` : ''}</div>`,
    point.active
      ? `<div class="adn-pop-air">${escapeHtml(labels.onAir)}: ${escapeHtml(point.activeCall || '')} ${escapeHtml(point.activeTg || '')}</div>`
      : '',
    row(labels.location, point.location),
    row(labels.system, point.system),
    row('RX / TX', freq),
    row('CC', point.colorcode),
    row(labels.connected, point.connected),
    qrz ? `<div class="adn-pop-link">${qrz}</div>` : '',
  ].join('');
}

function gpsPopup(point: GpsPoint, labels: MapLabels): string {
  return [
    `<div class="adn-pop-title">${escapeHtml(point.callsign || labels.gps)}</div>`,
    `<div class="adn-pop-kind">${escapeHtml(labels.gps)}</div>`,
    point.comment ? `<div class="adn-pop-row"><b>${escapeHtml(point.comment)}</b></div>` : '',
  ].join('');
}

type MarkerEntry = { marker: L.CircleMarker; signature: string };

/** Add, move or drop markers so open popups and the current view survive updates. */
function reconcile<T extends { key: string; lat: number; lon: number }>(
  layer: L.LayerGroup,
  store: Map<string, MarkerEntry>,
  points: T[],
  signatureOf: (point: T) => string,
  styleOf: (point: T) => L.CircleMarkerOptions,
  popupOf: (point: T) => string,
  onClick?: (point: T) => void,
): void {
  const seen = new Set<string>();
  for (const point of points) {
    seen.add(point.key);
    const signature = signatureOf(point);
    const existing = store.get(point.key);
    if (existing) {
      if (existing.signature === signature) continue;
      existing.marker.setLatLng([point.lat, point.lon]);
      existing.marker.setStyle(styleOf(point));
      existing.marker.setPopupContent(popupOf(point));
      existing.signature = signature;
      continue;
    }
    const marker = L.circleMarker([point.lat, point.lon], styleOf(point));
    marker.bindPopup(popupOf(point), { maxWidth: 260, className: 'adn-popup' });
    if (onClick) marker.on('click', () => onClick(point));
    marker.addTo(layer);
    store.set(point.key, { marker, signature });
  }
  for (const [key, entry] of store) {
    if (seen.has(key)) continue;
    layer.removeLayer(entry.marker);
    store.delete(key);
  }
}

export default function LiveMap({
  peers,
  gps,
  config,
  labels,
  fitSignal,
  follow,
  onSelect,
}: LiveMapProps) {
  const theme = useTheme();
  const dark = theme.palette.mode === 'dark';
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const layersRef = useRef<{ peers: L.LayerGroup; gps: L.LayerGroup } | null>(null);
  const storesRef = useRef({
    peers: new Map<string, MarkerEntry>(),
    gps: new Map<string, MarkerEntry>(),
  });
  const followedRef = useRef<string>('');

  // Map instance: created once, kept across data updates.
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return undefined;
    const saved = (() => {
      try {
        const raw = localStorage.getItem('mapView');
        if (!raw) return null;
        const parsed = JSON.parse(raw) as { lat?: number; lon?: number; zoom?: number };
        if (!Number.isFinite(parsed.lat) || !Number.isFinite(parsed.lon)) return null;
        return parsed;
      } catch {
        return null;
      }
    })();

    const map = L.map(containerRef.current, {
      center: saved ? [saved.lat as number, saved.lon as number] : config.center,
      zoom: saved?.zoom ?? config.zoom,
      preferCanvas: true,
      worldCopyJump: true,
      zoomControl: true,
      attributionControl: true,
    });
    mapRef.current = map;
    layersRef.current = {
      peers: L.layerGroup().addTo(map),
      gps: L.layerGroup().addTo(map),
    };
    map.on('moveend', () => {
      const center = map.getCenter();
      try {
        localStorage.setItem(
          'mapView',
          JSON.stringify({ lat: center.lat, lon: center.lng, zoom: map.getZoom() }),
        );
      } catch {
        /* private mode: view is simply not remembered */
      }
    });

    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      tileRef.current = null;
      layersRef.current = null;
      storesRef.current = {
        peers: new Map<string, MarkerEntry>(),
        gps: new Map<string, MarkerEntry>(),
      };
    };
    // Config center/zoom only seed the first render on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tiles follow the light/dark theme. Without a dark tile URL the light tiles
  // are darkened with a CSS filter, so the dark theme needs no second provider.
  const filterTiles = dark && !config.tileUrlDark;

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (tileRef.current) map.removeLayer(tileRef.current);
    tileRef.current = L.tileLayer(dark && config.tileUrlDark ? config.tileUrlDark : config.tileUrl, {
      attribution: config.attribution,
      maxZoom: config.maxZoom,
    }).addTo(map);
  }, [dark, config.tileUrl, config.tileUrlDark, config.attribution, config.maxZoom]);

  const peerStyle = useMemo(
    () => (point: PeerPoint): L.CircleMarkerOptions => {
      const approx = point.source !== 'reported';
      const color = point.active ? MARKER_COLORS.active : MARKER_COLORS[point.kind];
      return {
        radius: point.active ? 10 : point.kind === 'repeater' ? 7 : 6,
        color,
        weight: point.active ? 3 : 2,
        opacity: approx ? 0.55 : 0.95,
        fillColor: color,
        fillOpacity: point.active ? 0.55 : approx ? 0.15 : 0.35,
        dashArray: approx ? '3 4' : undefined,
      };
    },
    [],
  );

  useEffect(() => {
    const layers = layersRef.current;
    if (!layers) return;
    reconcile(
      layers.peers,
      storesRef.current.peers,
      peers,
      (point) =>
        `${point.lat},${point.lon},${point.active}${point.activeRx}${point.activeCall}${point.activeTg}${point.connected}`,
      peerStyle,
      (point) => peerPopup(point, labels),
      onSelect,
    );
  }, [peers, peerStyle, labels, onSelect]);

  useEffect(() => {
    const layers = layersRef.current;
    if (!layers) return;
    reconcile(
      layers.gps,
      storesRef.current.gps,
      gps,
      (point) => `${point.lat},${point.lon},${point.comment}`,
      () => ({
        radius: 6,
        color: MARKER_COLORS.gps,
        weight: 2,
        opacity: 0.95,
        fillColor: MARKER_COLORS.gps,
        fillOpacity: 0.4,
      }),
      (point) => gpsPopup(point, labels),
    );
  }, [gps, labels]);

  // Fit to what is on screen when the page asks for it.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || fitSignal === 0) return;
    const coords: L.LatLngExpression[] = [
      ...peers.map((p) => [p.lat, p.lon] as L.LatLngExpression),
      ...gps.map((p) => [p.lat, p.lon] as L.LatLngExpression),
    ];
    if (coords.length === 0) return;
    map.fitBounds(L.latLngBounds(coords).pad(0.15), { animate: true });
    // Only the explicit fit request drives this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitSignal]);

  // Follow activity: pan to the system that just keyed up.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !follow) return;
    const active = peers.find((point) => point.activeRx) ?? peers.find((point) => point.active);
    if (!active) {
      followedRef.current = '';
      return;
    }
    if (followedRef.current === active.key) return;
    followedRef.current = active.key;
    map.panTo([active.lat, active.lon], { animate: true });
  }, [peers, follow]);

  return (
    <>
      <GlobalStyles
        styles={{
          '.adn-map-dark .leaflet-tile-pane': {
            filter: 'invert(1) hue-rotate(180deg) brightness(0.92) contrast(0.88) saturate(0.7)',
          },
          '.leaflet-container': {
            width: '100%',
            height: '100%',
            background: dark ? '#0b1120' : '#e8eef3',
            fontFamily: theme.typography.fontFamily,
          },
          '.adn-popup .leaflet-popup-content-wrapper': {
            background: theme.palette.background.paper,
            color: theme.palette.text.primary,
            borderRadius: 12,
            boxShadow: '0 6px 24px rgba(0,0,0,0.25)',
          },
          '.adn-popup .leaflet-popup-tip': { background: theme.palette.background.paper },
          '.adn-popup .leaflet-popup-content': { margin: '10px 12px', lineHeight: 1.45 },
          '.adn-pop-title': { fontWeight: 700, fontSize: '0.95rem' },
          '.adn-pop-title span': { color: theme.palette.text.secondary, fontWeight: 400, fontSize: '0.8rem' },
          '.adn-pop-kind': { color: theme.palette.text.secondary, fontSize: '0.75rem', marginBottom: 4 },
          '.adn-pop-air': {
            color: theme.palette.error.main,
            fontWeight: 600,
            fontSize: '0.8rem',
            marginBottom: 4,
          },
          '.adn-pop-row': {
            display: 'flex',
            gap: 8,
            justifyContent: 'space-between',
            fontSize: '0.8rem',
          },
          '.adn-pop-row span': { color: theme.palette.text.secondary },
          '.adn-pop-link a': { color: theme.palette.primary.main, fontSize: '0.8rem' },
          '.leaflet-control-attribution': {
            background: dark ? 'rgba(15,23,42,0.75)' : 'rgba(255,255,255,0.8)',
            color: theme.palette.text.secondary,
            fontSize: '0.65rem',
          },
          '.leaflet-control-attribution a': { color: theme.palette.primary.main },
          '.leaflet-bar a': {
            background: theme.palette.background.paper,
            color: theme.palette.text.primary,
            borderBottomColor: theme.palette.divider,
          },
          '.leaflet-bar a:hover': { background: theme.palette.action.hover },
        }}
      />
      <Box
        ref={containerRef}
        className={filterTiles ? 'adn-map-dark' : undefined}
        sx={{ width: '100%', height: '100%' }}
      />
    </>
  );
}

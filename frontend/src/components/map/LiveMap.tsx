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

/** Leaflet map for Linked Systems: the background follows MAP.STYLE and the theme, nearby systems are clustered, markers are reconciled in place. */

import { useEffect, useMemo, useRef } from 'react';
import { Box, useTheme } from '@mui/material';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';

import type { MapConfig } from '../../context/DashboardConfigContext';
import type { GpsPoint, PeerPoint } from '../../utils/mapPoints';
import { centroidForDmrId } from '../../utils/countryCentroids';
import { addBasemap, showInitialView, type Basemap } from './basemap';
import MapGlobalStyles from './MapGlobalStyles';
import { clusterIcon, dotIcon, serverIcon, towerIcon } from './markerIcons';
import { escapeHtml, MARKER_COLORS, type MapLabels } from './markerStyles';

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

function qrzLink(callsign: string, label: string): string {
  const call = callsign.split(/[\s,]/)[0]?.toUpperCase() ?? '';
  if (!/^[A-Z0-9]{3,}(\/[A-Z0-9]+)?$/.test(call)) return '';
  return `<a href="https://www.qrz.com/db/${encodeURIComponent(call)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
}

function row(label: string, value: string): string {
  if (!value) return '';
  return `<div class="adn-pop-row"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`;
}

function onAirText(point: PeerPoint): string {
  return [point.activeCall, point.activeId, point.activeTg].filter(Boolean).join(' · ');
}

function peerPopup(point: PeerPoint, labels: MapLabels): string {
  const kindLabel = labels[point.kind];
  const title = point.callsign || point.peerId;
  const qrz = qrzLink(point.callsign, labels.qrz);
  const freq = [point.rxFreq, point.txFreq].filter((f) => f && f !== 'N/A').join(' / ');
  return [
    `<div class="adn-pop-title">${escapeHtml(title)} <span>${escapeHtml(point.peerId)}</span></div>`,
    `<div class="adn-pop-kind">${escapeHtml(kindLabel)}${point.source !== 'reported' ? ` · ${escapeHtml(labels.approx)}` : ''}</div>`,
    point.active ? `<div class="adn-pop-air">${escapeHtml(labels.onAir)}: ${escapeHtml(onAirText(point))}</div>` : '',
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

type MarkerEntry = { marker: L.Marker; layer: L.LayerGroup; signature: string };

/** Add, move or drop markers so open popups and the current view survive updates. */
function reconcile<T extends { key: string; lat: number; lon: number }>(
  layerOf: (point: T) => L.LayerGroup,
  store: Map<string, MarkerEntry>,
  points: T[],
  signatureOf: (point: T) => string,
  iconOf: (point: T) => L.DivIcon,
  popupOf: (point: T) => string,
  onClick?: (point: T) => void,
  raisedOf?: (point: T) => boolean,
): void {
  // Hover shows the details; a click pins them in a popup (phones, and the QRZ link).
  const details = (marker: L.Marker, point: T) => {
    const html = popupOf(point);
    marker.setPopupContent(html);
    marker.setTooltipContent(html);
    marker.setZIndexOffset(raisedOf?.(point) ? 1000 : 0);
  };
  const seen = new Set<string>();
  for (const point of points) {
    seen.add(point.key);
    const signature = signatureOf(point);
    const existing = store.get(point.key);
    if (existing) {
      if (existing.signature === signature) continue;
      const layer = layerOf(point);
      const { lat, lng } = existing.marker.getLatLng();
      // Clusters are built on add: a marker that moves or changes layer is re-added, others keep their open popup.
      if (layer !== existing.layer || lat !== point.lat || lng !== point.lon) {
        existing.layer.removeLayer(existing.marker);
        existing.marker.setLatLng([point.lat, point.lon]);
        layer.addLayer(existing.marker);
        existing.layer = layer;
      }
      existing.marker.setIcon(iconOf(point));
      details(existing.marker, point);
      existing.signature = signature;
      continue;
    }
    const marker = L.marker([point.lat, point.lon], { icon: iconOf(point), keyboard: false });
    marker.bindPopup('', { maxWidth: 260, className: 'adn-popup' });
    marker.bindTooltip('', { direction: 'top', className: 'adn-tooltip adn-details' });
    marker.on('popupopen', () => marker.closeTooltip());
    if (onClick) marker.on('click', () => onClick(point));
    const layer = layerOf(point);
    details(marker, point);
    layer.addLayer(marker);
    store.set(point.key, { marker, layer, signature });
  }
  for (const [key, entry] of store) {
    if (seen.has(key)) continue;
    entry.layer.removeLayer(entry.marker);
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
  const basemapRef = useRef<Basemap | null>(null);
  const layersRef = useRef<{ peers: L.MarkerClusterGroup; onAir: L.LayerGroup; gps: L.LayerGroup } | null>(null);
  const storesRef = useRef({
    peers: new Map<string, MarkerEntry>(),
    gps: new Map<string, MarkerEntry>(),
  });
  const followedRef = useRef<string>('');

  // Map instance: created once, kept across data updates.
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return undefined;
    const map = L.map(containerRef.current, {
      // The vector style has no tile layer to cap the zoom.
      maxZoom: config.maxZoom,
      // Fitting the world to the box needs fractional zoom levels.
      zoomSnap: 0.25,
      preferCanvas: true,
      worldCopyJump: true,
      zoomControl: true,
      attributionControl: true,
    });
    showInitialView(map, config);
    mapRef.current = map;
    layersRef.current = {
      // Same-spot systems (country fallback, one town) fan out on click so every one can be reached.
      peers: L.markerClusterGroup({
        maxClusterRadius: 36,
        showCoverageOnHover: false,
        spiderfyOnMaxZoom: true,
        iconCreateFunction: (cluster) => clusterIcon(cluster.getChildCount()),
      }).addTo(map),
      // Systems on air stay out of the clusters so their label is always on screen.
      onAir: L.layerGroup().addTo(map),
      gps: L.layerGroup().addTo(map),
    };
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      basemapRef.current = null;
      layersRef.current = null;
      storesRef.current = {
        peers: new Map<string, MarkerEntry>(),
        gps: new Map<string, MarkerEntry>(),
      };
    };
    // Config center/zoom only seed the first render on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Countries where one of the shown systems is on air, by the country of its DMR ID.
  const liveCountries = useMemo(() => {
    const isos = new Set<string>();
    for (const point of peers) {
      const iso = point.active ? centroidForDmrId(point.peerId)?.iso : undefined;
      if (iso) isos.add(iso);
    }
    return isos;
  }, [peers]);
  const liveCountriesRef = useRef(liveCountries);
  liveCountriesRef.current = liveCountries;

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;
    const basemap = addBasemap(map, config, dark);
    basemap.highlight(liveCountriesRef.current);
    basemapRef.current = basemap;
    return () => {
      basemap.remove();
      basemapRef.current = null;
    };
    // Only the fields that change the background rebuild it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dark, config.style, config.tileUrl, config.tileUrlDark, config.attribution, config.maxZoom]);

  useEffect(() => {
    basemapRef.current?.highlight(liveCountries);
  }, [liveCountries]);

  const peerIcon = useMemo(
    () => (point: PeerPoint): L.DivIcon => {
      const color = point.active ? MARKER_COLORS.active : MARKER_COLORS[point.kind];
      const faded = !point.active && point.source !== 'reported';
      // On air the label names who is talking; otherwise the system's own callsign.
      const label = point.active ? onAirText(point) : point.callsign || point.peerId;
      if (point.kind === 'bridge') return serverIcon(color, point.active ? 18 : 14, label, point.active, faded);
      const height = (point.kind === 'repeater' ? 30 : 24) + (point.active ? 6 : 0);
      return towerIcon(color, height, label, point.active, faded);
    },
    [],
  );

  useEffect(() => {
    const layers = layersRef.current;
    if (!layers) return;
    reconcile(
      (point) => (point.active ? layers.onAir : layers.peers),
      storesRef.current.peers,
      peers,
      (point) =>
        `${point.lat},${point.lon},${point.callsign},${point.active}${point.activeCall}${point.activeId}${point.activeTg}${point.connected}`,
      peerIcon,
      (point) => peerPopup(point, labels),
      onSelect,
      (point) => point.active,
    );
  }, [peers, peerIcon, labels, onSelect]);

  useEffect(() => {
    const layers = layersRef.current;
    if (!layers) return;
    reconcile(
      () => layers.gps,
      storesRef.current.gps,
      gps,
      (point) => `${point.lat},${point.lon},${point.comment}`,
      () => dotIcon(MARKER_COLORS.gps, 12),
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
    // A lone system (or several in one town) would otherwise land at street level.
    map.fitBounds(L.latLngBounds(coords).pad(0.15), { animate: true, maxZoom: 10 });
    // Only the explicit fit request drives this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitSignal]);

  // Follow activity: pan to the system that just keyed up.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !follow) return;
    const active = peers.find((point) => point.active);
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
      <MapGlobalStyles />
      <Box ref={containerRef} sx={{ width: '100%', height: '100%' }} />
    </>
  );
}

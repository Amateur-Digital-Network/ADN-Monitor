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

/** Home map: a flag and a call card over each country with a call on air right now. */

import { useEffect, useMemo, useRef } from 'react';
import { Box, useTheme } from '@mui/material';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import type { MapConfig } from '../../context/DashboardConfigContext';
import type { QsoCaller, QsoOrigin } from '../../utils/qsoOrigins';
import { addBasemap, showInitialView, type Basemap } from './basemap';
import { placeCallouts } from './calloutLayout';
import MapGlobalStyles from './MapGlobalStyles';
import { escapeHtml } from './markerStyles';

type OriginEntry = { pin: L.Marker; callout: L.Marker; signature: string };

const FLAG_HALF: [number, number] = [15, 10];

const BRIDGE_GLYPH =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6">'
  + '<circle cx="8" cy="8" r="2"/><circle cx="2.5" cy="8" r="1.5"/><circle cx="13" cy="3" r="1.5"/><circle cx="13" cy="13" r="1.5"/>'
  + '<path d="M4 8h2M9.6 6.8l2.2-2.6M9.6 9.2l2.2 2.6"/></svg>';

function flagImg(mcc: string): string {
  return `<img class="adn-qso-flag" src="/img/flags/${mcc}.png" alt="" onerror="this.src='/img/flags/world.png'">`;
}

function callerRow(origin: QsoOrigin, caller: QsoCaller): string {
  if (caller.bridge) {
    return `<div class="adn-qso-row adn-qso-bridge">${flagImg(origin.mcc)}${BRIDGE_GLYPH}`
      + `<span><b>BRIDGE</b><small>TG ${escapeHtml(caller.tg)}</small></span></div>`;
  }
  const meta = [caller.dmrId && caller.dmrId !== caller.call ? `ID ${caller.dmrId}` : '', caller.tg ? `TG ${caller.tg}` : '']
    .filter(Boolean)
    .join(' · ');
  return `<div class="adn-qso-row"><b>${escapeHtml(caller.call)}</b><small>${escapeHtml(meta)}</small></div>`;
}

function bridgeOnly(origin: QsoOrigin): boolean {
  return origin.callers.every((caller) => caller.bridge);
}

/** The flag (a dot when only bridges talk), in a pane above every card so no card hides it. */
function pinIcon(origin: QsoOrigin): L.DivIcon {
  return L.divIcon({
    className: 'adn-qso',
    html: bridgeOnly(origin) ? '<span class="adn-qso-dot"></span>' : flagImg(origin.mcc),
    iconSize: [FLAG_HALF[0] * 2, FLAG_HALF[1] * 2],
  });
}

/** A card per country, one row per call, on a stem whose length ``layoutCallouts`` picks. */
function calloutIcon(origin: QsoOrigin): L.DivIcon {
  return L.divIcon({
    className: bridgeOnly(origin) ? 'adn-qso-callout adn-qso-bridge-only' : 'adn-qso-callout',
    html:
      `<div class="adn-qso-card">${origin.callers.map((caller) => callerRow(origin, caller)).join('')}</div>`
      + '<div class="adn-qso-stem"></div>',
    iconSize: [0, 0],
  });
}

/** Measure the cards, let ``placeCallouts`` pick each one's spot, and apply it. */
function layoutCallouts(map: L.Map, entries: Iterable<OriginEntry>): void {
  const items = [...entries].flatMap((entry) => {
    const root = entry.callout.getElement();
    const card = root?.firstElementChild as HTMLElement | null;
    if (!root || !card) return [];
    const { x, y } = map.latLngToContainerPoint(entry.callout.getLatLng());
    return [{ root, x, y, width: card.offsetWidth, height: card.offsetHeight }];
  });
  const size = map.getSize();
  placeCallouts(items, { width: size.x, height: size.y }).forEach(({ stem, dx, down }, index) => {
    const { root } = items[index];
    root.style.setProperty('--stem', `${stem}px`);
    root.style.setProperty('--dx', `${dx}px`);
    root.classList.toggle('adn-qso-down', down);
  });
}

export default function QsoOriginMap({ origins, config }: { origins: QsoOrigin[]; config: MapConfig }) {
  const dark = useTheme().palette.mode === 'dark';
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const flagsRef = useRef<L.LayerGroup | null>(null);
  const entriesRef = useRef(new Map<string, OriginEntry>());
  const basemapRef = useRef<Basemap | null>(null);

  const liveCountries = useMemo(() => new Set(origins.map((origin) => origin.iso)), [origins]);
  const liveCountriesRef = useRef(liveCountries);
  liveCountriesRef.current = liveCountries;

  useEffect(() => {
    if (mapRef.current || !containerRef.current) return undefined;
    // The wheel keeps scrolling the Home page; zoom stays on the buttons and pinch.
    const map = L.map(containerRef.current, {
      maxZoom: config.maxZoom,
      // Fitting the world to the box needs fractional zoom levels.
      zoomSnap: 0.25,
      preferCanvas: true,
      worldCopyJump: true,
      scrollWheelZoom: false,
    });
    showInitialView(map, config);
    mapRef.current = map;
    flagsRef.current = L.layerGroup().addTo(map);
    map.createPane('adnFlags').style.zIndex = '640';
    map.on('zoomend', () => layoutCallouts(map, entriesRef.current.values()));
    // An overview: maximised, restored or with the phone rotated it shows the world again.
    const observer = new ResizeObserver(() => {
      map.invalidateSize();
      showInitialView(map, config);
      layoutCallouts(map, entriesRef.current.values());
    });
    observer.observe(containerRef.current);
    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      flagsRef.current = null;
      basemapRef.current = null;
      entriesRef.current = new Map();
    };
    // Config center/zoom only seed the first render on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  useEffect(() => {
    const map = mapRef.current;
    const layer = flagsRef.current;
    if (!map || !layer) return;
    const entries = entriesRef.current;
    const seen = new Set<string>();
    for (const origin of origins) {
      seen.add(origin.iso);
      const signature = origin.mcc + '\n' + origin.callers.map(({ call, dmrId, tg, bridge }) => `${call}/${dmrId}/${tg}/${bridge}`).join('\n');
      const existing = entries.get(origin.iso);
      if (existing) {
        if (existing.signature === signature) continue;
        existing.pin.setIcon(pinIcon(origin));
        existing.callout.setIcon(calloutIcon(origin));
        existing.signature = signature;
        continue;
      }
      const options = { keyboard: false, interactive: false };
      const pin = L.marker([origin.lat, origin.lon], { ...options, icon: pinIcon(origin), pane: 'adnFlags' }).addTo(layer);
      const callout = L.marker([origin.lat, origin.lon], { ...options, icon: calloutIcon(origin) }).addTo(layer);
      entries.set(origin.iso, { pin, callout, signature });
    }
    for (const [iso, entry] of entries) {
      if (seen.has(iso)) continue;
      layer.removeLayer(entry.pin);
      layer.removeLayer(entry.callout);
      entries.delete(iso);
    }
    layoutCallouts(map, entries.values());
  }, [origins]);

  return (
    <>
      <MapGlobalStyles />
      <Box ref={containerRef} sx={{ width: '100%', height: '100%' }} />
    </>
  );
}

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

/** Markers for the Linked Systems map: radio towers for repeaters and hotspots, a server for bridges, a dot for GPS, a count for clusters. */

import L from 'leaflet';

import { escapeHtml } from './markerStyles';

// Lattice mast standing on its base, antenna tip at (12, 7) in a 24×28 box.
const MAST = 'M12 9 6.5 26M12 9l5.5 17M6.5 26h11M8.6 19h6.8M9.9 14h4.2M9.9 14l5.5 5M14.1 14l-5.5 5';
const WAVES = 'M8.2 3.6a5 5 0 0 0 0 6.8M15.8 3.6a5 5 0 0 1 0 6.8';
const OUTER_WAVES = 'M5.4 1.2a8.5 8.5 0 0 0 0 11.6M18.6 1.2a8.5 8.5 0 0 1 0 11.6';

// Part of the icon, not a tooltip: the marker's tooltip is left for the hover details.
function labelHtml(label: string, live: boolean): string {
  return label ? `<span class="adn-marker-label${live ? ' adn-live' : ''}">${escapeHtml(label)}</span>` : '';
}

/** ``live``: someone transmits through it, the waves pulse. ``faded``: approximate position. */
export function towerIcon(color: string, height: number, label: string, live: boolean, faded: boolean): L.DivIcon {
  const width = Math.round((height * 24) / 28);
  const waves = live
    ? `<path class="adn-wave" d="${WAVES}"/><path class="adn-wave adn-wave-outer" d="${OUTER_WAVES}"/>`
    : `<path d="${WAVES}" opacity="0.7"/>`;
  return L.divIcon({
    className: faded ? 'adn-marker adn-faded' : 'adn-marker',
    html:
      `<svg viewBox="0 0 24 28" width="${width}" height="${height}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">`
      + `<path d="${MAST}"/>${waves}<circle cx="12" cy="7" r="2" fill="${color}"/></svg>${labelHtml(label, live)}`,
    iconSize: [width, height],
    iconAnchor: [width / 2, height],
    popupAnchor: [0, -height],
    tooltipAnchor: [0, -height],
  });
}

/** Bridges and services (D-APRS, echo, links to other networks): no RF side, so no tower. */
export function serverIcon(color: string, size: number, label: string, live: boolean, faded: boolean): L.DivIcon {
  return L.divIcon({
    className: faded ? 'adn-marker adn-faded' : 'adn-marker',
    html:
      `<svg viewBox="0 0 16 16" width="${size}" height="${size}">`
      + `<rect x="1" y="1" width="14" height="14" rx="3.5" fill="${color}" stroke="#ffffff" stroke-width="1.5"/>`
      + `<path d="M4.5 5.75h7M4.5 10.25h7" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round"/></svg>${labelHtml(label, live)}`,
    iconSize: [size, size],
    tooltipAnchor: [0, -size / 2],
  });
}

export function dotIcon(color: string, size: number): L.DivIcon {
  const r = size / 2 - 1.5;
  return L.divIcon({
    className: 'adn-marker',
    html:
      `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">`
      + `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="${color}" fill-opacity="0.45" stroke="${color}" stroke-width="2"/></svg>`,
    iconSize: [size, size],
    tooltipAnchor: [0, -size / 2],
  });
}

/** Several systems close together; a click zooms in, or fans them out when they share one spot. */
export function clusterIcon(count: number): L.DivIcon {
  const size = count < 10 ? 30 : count < 100 ? 36 : 42;
  return L.divIcon({ className: 'adn-cluster', html: `<span>${count}</span>`, iconSize: [size, size] });
}

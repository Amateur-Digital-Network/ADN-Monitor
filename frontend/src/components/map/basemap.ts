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

/** Map backgrounds picked with MAP.STYLE; every map in the dashboard draws its background here. */

import L from 'leaflet';

import type { MapConfig } from '../../context/DashboardConfigContext';

export type Basemap = {
  /** Outline these countries (ISO 3166 alpha-2); raster tiles have no shapes to outline. */
  highlight(isos: ReadonlySet<string>): void;
  remove(): void;
};

type CountryProps = { iso: string; name: string; label: [number, number] };
type Countries = GeoJSON.FeatureCollection<GeoJSON.MultiPolygon, CountryProps>;

const VECTOR_PALETTE = {
  dark: { sea: '#0b1a2a', land: '#1b3044', border: '#2e4b64', label: '#6f8ba4', live: '#2dd4bf', liveFill: '#13505a' },
  light: { sea: '#cde0ec', land: '#f4f1ea', border: '#b3c1cb', label: '#5d6f7e', live: '#0d9488', liveFill: '#bde8e2' },
};

// Below this zoom the country codes of Europe and the Caribbean pile on top of each other.
const LABEL_MIN_ZOOM = 3;

// The whole of Natural Earth but Antarctica, which would only shrink everything else.
const WORLD_BOUNDS = L.latLngBounds([-57, -180], [83, 180]);

/** First view: the whole world fitted to the map's size, or MAP.CENTER/ZOOM when set. */
export function showInitialView(map: L.Map, config: MapConfig): void {
  if (config.zoom === null) map.fitBounds(WORLD_BOUNDS, { animate: false });
  else map.setView(config.center, config.zoom, { animate: false });
}

let countriesRequest: Promise<Countries> | null = null;

/** One download per page load, shared by every map; a failed one is retried by the next map. */
export function loadCountries(): Promise<Countries> {
  if (!countriesRequest) {
    countriesRequest = fetch('/geo/countries.json').then((res) =>
      res.ok ? (res.json() as Promise<Countries>) : Promise.reject(new Error(String(res.status))),
    );
    countriesRequest.catch(() => {
      countriesRequest = null;
    });
  }
  return countriesRequest;
}

function pane(map: L.Map, name: string, zIndex: number): HTMLElement {
  const existing = map.getPane(name);
  if (existing) return existing;
  const created = map.createPane(name);
  created.style.zIndex = String(zIndex);
  created.style.pointerEvents = 'none';
  return created;
}

function addTiles(map: L.Map, config: MapConfig, dark: boolean): Basemap {
  const layer = L.tileLayer(dark && config.tileUrlDark ? config.tileUrlDark : config.tileUrl, {
    attribution: config.attribution,
    maxZoom: config.maxZoom,
  }).addTo(map);
  // Without dark tiles the light ones are darkened in CSS, so the dark theme needs no second provider.
  map.getContainer().classList.toggle('adn-map-dark', dark && !config.tileUrlDark);
  return {
    highlight() {},
    remove() {
      map.removeLayer(layer);
      map.getContainer().classList.remove('adn-map-dark');
    },
  };
}

function addVector(map: L.Map, dark: boolean): Basemap {
  const palette = dark ? VECTOR_PALETTE.dark : VECTOR_PALETTE.light;
  const container = map.getContainer();
  container.style.background = palette.sea;
  // Above the tile pane, below the markers (overlayPane 400), which keep their own canvas.
  pane(map, 'adnLand', 250);
  const renderer = L.canvas({ pane: 'adnLand' });
  const labelPane = pane(map, 'adnLabels', 390);
  labelPane.style.color = palette.label;

  let live: ReadonlySet<string> = new Set();
  let removed = false;
  let shapes: L.GeoJSON | null = null;
  const labels = L.layerGroup();

  const shapeStyle = (iso: string): L.PathOptions =>
    iso && live.has(iso)
      ? { fillColor: palette.liveFill, color: palette.live, weight: 1.6 }
      : { fillColor: palette.land, color: palette.border, weight: 0.6 };
  const toggleLabels = () => {
    labelPane.style.display = map.getZoom() >= LABEL_MIN_ZOOM ? '' : 'none';
  };

  loadCountries()
    .then((data) => {
      if (removed) return;
      shapes = L.geoJSON(data, {
        renderer,
        interactive: false,
        style: (feature) => ({ fillOpacity: 1, opacity: 1, ...shapeStyle(feature?.properties.iso ?? '') }),
      } as L.GeoJSONOptions).addTo(map);
      for (const { properties } of data.features) {
        if (!properties.iso) continue;
        L.marker([properties.label[1], properties.label[0]], {
          pane: 'adnLabels',
          interactive: false,
          keyboard: false,
          icon: L.divIcon({ className: 'adn-country-code', html: properties.iso, iconSize: [28, 12] }),
        }).addTo(labels);
      }
      labels.addTo(map);
    })
    .catch(() => {
      /* no shapes: the sea colour alone still frames the markers */
    });
  map.on('zoomend', toggleLabels);
  toggleLabels();

  return {
    highlight(isos) {
      if (isos.size === live.size && [...isos].every((iso) => live.has(iso))) return;
      live = new Set(isos);
      shapes?.eachLayer((layer) => {
        const iso = ((layer as L.Polygon).feature?.properties as CountryProps | undefined)?.iso ?? '';
        (layer as L.Polygon).setStyle(shapeStyle(iso));
      });
    },
    remove() {
      removed = true;
      map.off('zoomend', toggleLabels);
      if (shapes) map.removeLayer(shapes);
      map.removeLayer(labels);
      container.style.background = '';
    },
  };
}

export function addBasemap(map: L.Map, config: MapConfig, dark: boolean): Basemap {
  return config.style === 2 ? addVector(map, dark) : addTiles(map, config, dark);
}

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
 */

import { describe, expect, it } from 'vitest';
import type { MapConfig } from '../context/DashboardConfigContext';
import { buildOpenBridgePoints, buildPeerPoints, parseCoordinate, peerKind, roundCoordinate } from './mapPoints';

function mapConfig(overrides: Partial<MapConfig> = {}): MapConfig {
  return {
    enabled: true,
    tileUrl: '',
    tileUrlDark: '',
    attribution: '',
    maxZoom: 18,
    center: [20, 0],
    zoom: 2,
    hotspotPrecision: 2,
    repeaterPrecision: null,
    approxByCountry: true,
    gpsUrl: '',
    gpsLabel: '',
    gpsRefreshSec: 60,
    overrides: {},
    ...overrides,
  };
}

describe('parseCoordinate', () => {
  it('accepts a plain decimal', () => {
    expect(parseCoordinate('42.5341', 90)).toBeCloseTo(42.5341);
  });

  it('accepts a comma decimal', () => {
    expect(parseCoordinate('42,53517', 90)).toBeCloseTo(42.53517);
  });

  it('accepts a leading +', () => {
    expect(parseCoordinate('+42.5341', 90)).toBeCloseTo(42.5341);
  });

  it('applies a leading hemisphere letter', () => {
    expect(parseCoordinate('S33.45', 90)).toBeCloseTo(-33.45);
    expect(parseCoordinate('N33.45', 90)).toBeCloseTo(33.45);
  });

  it('applies a trailing hemisphere letter', () => {
    expect(parseCoordinate('70.6693W', 180)).toBeCloseTo(-70.6693);
    expect(parseCoordinate('70.6693E', 180)).toBeCloseTo(70.6693);
  });

  it('rejects out-of-range values', () => {
    expect(parseCoordinate('190', 180)).toBeNull();
  });

  it('rejects garbage and empty input', () => {
    expect(parseCoordinate('not-a-number', 90)).toBeNull();
    expect(parseCoordinate('', 90)).toBeNull();
    expect(parseCoordinate(null, 90)).toBeNull();
    expect(parseCoordinate(undefined, 90)).toBeNull();
  });
});

describe('roundCoordinate', () => {
  it('rounds to the given decimals', () => {
    expect(roundCoordinate(42.53517, 2)).toBe(42.54);
  });

  it('passes the value through when decimals is null', () => {
    expect(roundCoordinate(42.53517, null)).toBe(42.53517);
  });

  it('passes the value through when decimals is negative', () => {
    expect(roundCoordinate(42.53517, -1)).toBe(42.53517);
  });
});

describe('peerKind', () => {
  it('classifies a 7+ digit DMR ID as hotspot', () => {
    expect(peerKind('3120001', {})).toBe('hotspot');
  });

  it('classifies a shorter DMR ID as repeater', () => {
    expect(peerKind('730002', {})).toBe('repeater');
  });

  it('classifies N/A frequencies as bridge regardless of ID length', () => {
    expect(peerKind('730002', { RX_FREQ: 'N/A', TX_FREQ: 'N/A' })).toBe('bridge');
  });
});

describe('buildPeerPoints', () => {
  it('rounds a hotspot to the configured precision', () => {
    const ctable = {
      MASTERS: {
        'SYS-1': {
          PEERS: {
            '3120001': { LATITUDE: '-33.448912', LONGITUDE: '-70.669266' },
          },
        },
      },
    };
    const points = buildPeerPoints(ctable, mapConfig({ hotspotPrecision: 2 }), true);
    expect(points).toHaveLength(1);
    expect(points[0].lat).toBeCloseTo(-33.45);
    expect(points[0].lon).toBeCloseTo(-70.67);
  });

  it('leaves a repeater unrounded when repeaterPrecision is null', () => {
    const ctable = {
      MASTERS: {
        'SYS-1': {
          PEERS: {
            '730002': { LATITUDE: '-33.448912', LONGITUDE: '-70.669266' },
          },
        },
      },
    };
    const points = buildPeerPoints(ctable, mapConfig({ repeaterPrecision: null }), true);
    expect(points[0].lat).toBeCloseTo(-33.448912);
  });

  it('prefers an override over the reported position', () => {
    const ctable = {
      MASTERS: {
        'SYS-1': {
          PEERS: {
            '3120001': { LATITUDE: '-33.448912', LONGITUDE: '-70.669266' },
          },
        },
      },
    };
    const points = buildPeerPoints(
      ctable,
      mapConfig({ overrides: { '3120001': [1, 2] } }),
      true,
    );
    expect(points[0].lat).toBe(1);
    expect(points[0].lon).toBe(2);
    expect(points[0].source).toBe('override');
  });

  it('falls back to the country centroid for a zero-island position', () => {
    const ctable = {
      MASTERS: {
        'SYS-1': {
          PEERS: {
            '730002': { LATITUDE: '0.0', LONGITUDE: '0.0' },
          },
        },
      },
    };
    const points = buildPeerPoints(ctable, mapConfig(), true);
    expect(points[0].source).toBe('country');
  });

  it('drops a zero-island peer when country fallback is not allowed', () => {
    const ctable = {
      MASTERS: {
        'SYS-1': {
          PEERS: {
            '730002': { LATITUDE: '0.0', LONGITUDE: '0.0' },
          },
        },
      },
    };
    expect(buildPeerPoints(ctable, mapConfig(), false)).toHaveLength(0);
  });
});

describe('buildOpenBridgePoints', () => {
  const streamEntry = (
    trx: string,
    startedAt: number,
    dmrId = '7300012345',
  ): [string, string, string, number, string] => [trx, 'CE5RPY', '647', startedAt, dmrId];

  it('keeps a fresh RX stream', () => {
    const ctable = {
      OPENBRIDGES: { 'OBP-CL': { STREAMS: { s1: streamEntry('RX', Date.now() / 1000) } } },
    };
    expect(buildOpenBridgePoints(ctable, true)).toHaveLength(1);
  });

  it('drops a stream older than the max age', () => {
    const ctable = {
      OPENBRIDGES: { 'OBP-CL': { STREAMS: { s1: streamEntry('RX', Date.now() / 1000 - 200) } } },
    };
    expect(buildOpenBridgePoints(ctable, true, 120)).toHaveLength(0);
  });

  it('ignores TX-direction entries (our own echo)', () => {
    const ctable = {
      OPENBRIDGES: { 'OBP-CL': { STREAMS: { s1: streamEntry('TX', Date.now() / 1000) } } },
    };
    expect(buildOpenBridgePoints(ctable, true)).toHaveLength(0);
  });

  it('collapses duplicate ID+TG streams to one marker', () => {
    const now = Date.now() / 1000;
    const ctable = {
      OPENBRIDGES: {
        'OBP-CL': {
          STREAMS: {
            s1: streamEntry('RX', now),
            s2: streamEntry('RX', now),
          },
        },
      },
    };
    expect(buildOpenBridgePoints(ctable, true)).toHaveLength(1);
  });

  it('returns nothing when approximate positions are not allowed', () => {
    const ctable = {
      OPENBRIDGES: { 'OBP-CL': { STREAMS: { s1: streamEntry('RX', Date.now() / 1000) } } },
    };
    expect(buildOpenBridgePoints(ctable, false)).toHaveLength(0);
  });
});

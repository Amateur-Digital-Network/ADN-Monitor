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
import { isBridge, isHotspot, isRepeater, isTerminal } from './peerKind';

const hotspot = { RX_FREQ: '434.0000', TX_FREQ: '434.0000' };
const terminal = { ...hotspot, TERMINAL: true };

describe('peer kinds', () => {
  it('a terminal is only a terminal', () => {
    expect(isTerminal('213003598', terminal)).toBe(true);
    expect(isHotspot('213003598', terminal)).toBe(false);
    expect(isRepeater('213003', terminal)).toBe(false);
    expect(isBridge({ RX_FREQ: 'N/A', TX_FREQ: 'N/A', TERMINAL: true })).toBe(false);
  });

  it('peers without the flag keep their table', () => {
    expect(isTerminal('213003501', hotspot)).toBe(false);
    expect(isHotspot('213003501', hotspot)).toBe(true);
    expect(isRepeater('213003', hotspot)).toBe(true);
    expect(isBridge({ RX_FREQ: 'N/A', TX_FREQ: 'N/A' })).toBe(true);
  });
});

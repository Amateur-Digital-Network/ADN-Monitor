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
import { placeCallouts, STEM_MIN, type Box } from './calloutLayout';

const overlap = (a: Box, b: Box) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const flag = (x: number, y: number): Box => ({ left: x - 15, right: x + 15, top: y - 10, bottom: y + 10 });

describe('placeCallouts', () => {
  it('keeps a lone card on the shortest stem above its flag', () => {
    expect(placeCallouts([{ x: 400, y: 300, width: 90, height: 30 }], { width: 800, height: 600 })[0])
      .toMatchObject({ stem: STEM_MIN, dx: 0, down: false });
  });

  it('covers no flag and no other card when neighbouring countries talk at once', () => {
    // Central America: six flags a few pixels apart, cards wider than the gaps.
    const points = [[300, 300], [312, 306], [326, 312], [338, 318], [352, 326], [366, 334]];
    const items = points.map(([x, y]) => ({ x, y, width: 96, height: 30 }));
    const spots = placeCallouts(items, { width: 800, height: 600 });
    const flags = points.map(([x, y]) => flag(x, y));
    spots.forEach((spot, i) => {
      flags.forEach((f) => expect(overlap(spot.box, f)).toBe(false));
      spots.forEach((other, j) => j !== i && expect(overlap(spot.box, other.box)).toBe(false));
    });
  });

  it('flips a card below its flag rather than past the top of the map', () => {
    expect(placeCallouts([{ x: 400, y: 40, width: 90, height: 30 }], { width: 800, height: 600 })[0].down).toBe(true);
  });
});

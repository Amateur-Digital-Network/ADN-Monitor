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

/** Where each call card goes on the Home map so it covers no flag, no other card and stays inside the map. */

export type CalloutInput = { x: number; y: number; width: number; height: number };
export type CalloutSpot = { stem: number; dx: number; down: boolean; box: Box };
export type Box = { left: number; right: number; top: number; bottom: number };

export const STEM_MIN = 46;
const STEM_STEP = 8;
const LEVELS = 8;
// Matches the 30×20 flag drawn at each point.
const FLAG_HALF_W = 15;
const FLAG_HALF_H = 10;

/**
 * Tries, per card: above its flag on ever longer stems, or below it, centred or slid sideways
 * along the stem. A crowd with no free spot falls back to the first, shortest one.
 * Results come back in input order.
 */
export function placeCallouts(items: CalloutInput[], map: { width: number; height: number }): CalloutSpot[] {
  const taken: Box[] = items.map(({ x, y }) => ({
    left: x - FLAG_HALF_W,
    right: x + FLAG_HALF_W,
    top: y - FLAG_HALF_H,
    bottom: y + FLAG_HALF_H,
  }));
  const free = (box: Box) =>
    box.left >= 0 && box.top >= 0 && box.right <= map.width && box.bottom <= map.height
    && !taken.some((t) => box.left < t.right && box.right > t.left && box.top < t.bottom && box.bottom > t.top);

  const spots: CalloutSpot[] = new Array(items.length);
  const order = items.map((_, index) => index).sort((a, b) => items[a].x - items[b].x);
  for (const index of order) {
    const { x, y, width, height } = items[index];
    // The stem has to meet the card, so a slide leaves it a few pixels inside the edge.
    const slide = Math.max(width / 2 - 10, 0);
    let chosen: CalloutSpot | null = null;
    let fallback: CalloutSpot | null = null;
    for (let level = 0; level < LEVELS && !chosen; level += 1) {
      const stem = STEM_MIN + level * (height + STEM_STEP);
      for (const down of [false, true]) {
        for (const dx of [0, -slide, slide]) {
          const left = x + dx - width / 2;
          const top = down ? y + stem : y - stem - height;
          const spot: CalloutSpot = { stem, dx, down, box: { left, right: left + width, top, bottom: top + height } };
          fallback ??= spot;
          if (free(spot.box)) {
            chosen = spot;
            break;
          }
        }
        if (chosen) break;
      }
    }
    spots[index] = chosen ?? (fallback as CalloutSpot);
    taken.push(spots[index].box);
  }
  return spots;
}

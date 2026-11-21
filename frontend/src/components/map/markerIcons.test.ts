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

import { describe, expect, it, vi } from 'vitest';

vi.mock('leaflet', () => ({
  default: { divIcon: (options: { html: string }) => options },
}));

const { aprsIcon } = await import('./markerIcons');

function html(icon: unknown): string {
  return (icon as { html: string }).html;
}

describe('aprsIcon', () => {
  it('draws a primary-table symbol from sheet 0', () => {
    const icon = aprsIcon('/', '[', '#000');
    expect(html(icon)).toContain('aprs-symbols-24-0@2x.png');
    expect(html(icon)).not.toContain('aprs-symbols-24-2@2x.png');
  });

  it('draws an overlay as the alternate symbol plus the character on top', () => {
    const out = html(aprsIcon('S', '#', '#000'));
    expect(out).toContain('aprs-symbols-24-1@2x.png');
    expect(out).toContain('aprs-symbols-24-2@2x.png');
    // "#" is index 2 (row 0, column 2); "S" is index 50 (row 3, column 2)
    expect(out).toContain('-48px 0px');
    expect(out).toContain('-48px -72px');
  });

  it('returns null for a symbol out of range', () => {
    expect(aprsIcon('/', ' ', '#000')).toBeNull();
    expect(aprsIcon('/', 'é', '#000')).toBeNull();
  });
});

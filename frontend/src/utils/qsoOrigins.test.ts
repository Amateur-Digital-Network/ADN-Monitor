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
import { activeQsoOrigins } from './qsoOrigins';
import type { Ctable } from './mapPoints';

const rx = (sub: string, call: string, tg = 'TG&nbsp;730') => ({ TS: true, TRX: 'RX', SUB: sub, CALL: call, TG: tg });

describe('activeQsoOrigins', () => {
  it('groups the calls on air by the country of the transmitting DMR ID', () => {
    const ctable: Ctable = {
      MASTERS: {
        SYSTEM: {
          PEERS: {
            '730044401': { 2: rx('Rodrigo (7300444)', 'CE5RPY') },
            '730044402': { 1: rx('Juan (7301234)', 'CA3XYZ', 'TG&nbsp;7301') },
          },
        },
      },
      OPENBRIDGES: { 'OBP-PA': { STREAMS: { a: ['RX', 'HP3ICC', '714', 0, 7140099] } } },
    };
    expect(activeQsoOrigins(ctable)).toEqual([
      { mcc: '714', iso: 'PA', name: 'Panama', lat: 8.538, lon: -80.7821, callers: [{ call: 'HP3ICC', dmrId: '7140099', tg: '714', bridge: false }] },
      {
        mcc: '730',
        iso: 'CL',
        name: 'Chile',
        lat: -35.6751,
        lon: -71.543,
        callers: [
          { call: 'CE5RPY', dmrId: '7300444', tg: '730', bridge: false },
          { call: 'CA3XYZ', dmrId: '7301234', tg: '7301', bridge: false },
        ],
      },
    ]);
  });

  it('leaves out downlinks, idle slots, streams we send and streams without a source ID', () => {
    const ctable: Ctable = {
      MASTERS: {
        SYSTEM: {
          PEERS: {
            '730044401': { 1: { ...rx('Rodrigo (7300444)', 'CE5RPY'), TRX: 'TX' }, 2: { ...rx('Juan (7301234)', 'CA3XYZ'), TS: false } },
          },
        },
      },
      OPENBRIDGES: { OBP: { STREAMS: { a: ['TX', 'CE5RPY', '730', 0, 7300444], b: ['RX', 'EA5GVK', '214', 0] } } },
    };
    expect(activeQsoOrigins(ctable)).toEqual([]);
  });

  it('places a BRIDGE stream on the country of its TG, source ID or not', () => {
    const ctable: Ctable = {
      OPENBRIDGES: { 'OBP-PA': { STREAMS: { a: ['RX', 'BRIDGE', '71491', 0] } } },
    };
    expect(activeQsoOrigins(ctable)).toMatchObject([
      { mcc: '714', iso: 'PA', callers: [{ call: 'BRIDGE', tg: '71491', bridge: true }] },
    ]);
  });

  it('lists a caller on two TGs twice, like the Active QSO box', () => {
    const ctable: Ctable = {
      OPENBRIDGES: { OBP: { STREAMS: { a: ['RX', 'HS2ZY', '52090', 0, 5200386], b: ['RX', 'HS2ZY', '5202', 0, 5200386] } } },
    };
    expect(activeQsoOrigins(ctable)[0].callers.map(({ tg }) => tg)).toEqual(['52090', '5202']);
  });

  it('puts every US prefix on one flag', () => {
    const ctable: Ctable = {
      OPENBRIDGES: { OBP: { STREAMS: { a: ['RX', 'KB8PMY', '3167355', 0, 3139164], b: ['RX', 'KA1VSC', '310905', 0, 3109898] } } },
    };
    const origins = activeQsoOrigins(ctable);
    expect(origins).toHaveLength(1);
    expect(origins[0]).toMatchObject({ iso: 'US', callers: [{ call: 'KB8PMY' }, { call: 'KA1VSC' }] });
  });

  it('counts a caller heard on two systems once', () => {
    const ctable: Ctable = {
      PEERS: { 'XLX-1': { 1: rx('Rodrigo (7300444)', 'CE5RPY') } },
      OPENBRIDGES: { OBP: { STREAMS: { a: ['RX', 'Rodrigo', '730', 0, '7300444'] } } },
    };
    expect(activeQsoOrigins(ctable)[0].callers).toHaveLength(1);
  });
});

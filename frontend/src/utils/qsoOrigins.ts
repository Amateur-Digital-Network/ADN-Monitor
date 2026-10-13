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

/** Countries where the calls on air right now come from, for the flags and call cards on the Home map. */

import { COUNTRY_CENTROIDS } from './countryCentroids';
import { subscriberId, tsActive, type Ctable, type TsEntry } from './mapPoints';

export type QsoOrigin = {
  /** DMR country code: first three digits of the ID, also the name of its flag image. */
  mcc: string;
  iso: string;
  name: string;
  lat: number;
  lon: number;
  callers: QsoCaller[];
};

/** ``bridge``: an OpenBridge stream with no subscriber behind it, placed on the country of its TG. */
export type QsoCaller = { call: string; dmrId: string; tg: string; bridge: boolean };

function tgNumber(text: string): string {
  return /(\d+)\D*$/.exec(text.replace(/&nbsp;/g, ' '))?.[1] ?? '';
}

/** Same calls as the Active QSO box: slots receiving from a radio, and streams arriving over OpenBridge. */
export function activeQsoOrigins(ctable: Ctable | null | undefined): QsoOrigin[] {
  const callers = new Map<string, { mcc: string; caller: QsoCaller }>();
  const addSlot = (ts: TsEntry | undefined) => {
    if (!tsActive(ts) || String(ts?.TRX ?? '').toUpperCase() !== 'RX') return;
    const dmrId = subscriberId(ts?.SUB);
    if (!dmrId) return;
    const caller = { call: (ts?.CALL ?? '').trim() || dmrId, dmrId, tg: tgNumber(ts?.TG || ts?.DEST || ''), bridge: false };
    callers.set(`${dmrId}/${caller.tg}`, { mcc: dmrId.slice(0, 3), caller });
  };

  for (const master of Object.values(ctable?.MASTERS ?? {})) {
    for (const peer of Object.values(master?.PEERS ?? {})) {
      addSlot(peer?.[1]);
      addSlot(peer?.[2]);
    }
  }
  for (const slots of Object.values(ctable?.PEERS ?? {})) {
    addSlot(slots?.[1]);
    addSlot(slots?.[2]);
  }
  for (const bridge of Object.values(ctable?.OPENBRIDGES ?? {})) {
    for (const entry of Object.values(bridge?.STREAMS ?? {})) {
      if (!Array.isArray(entry) || String(entry[0] ?? '').toUpperCase() !== 'RX') continue;
      // Legacy servers send no source ID (fifth field): only their BRIDGE streams get a country, from the TG.
      const dmrId = String(entry[4] ?? '').replace(/\D/g, '');
      const call = String(entry[1] ?? '').trim();
      const tg = tgNumber(String(entry[2] ?? ''));
      if (!call || call.toUpperCase() === 'BRIDGE') {
        if (tg) callers.set(`bridge/${tg}`, { mcc: tg.slice(0, 3), caller: { call: 'BRIDGE', dmrId, tg, bridge: true } });
      } else if (dmrId) {
        callers.set(`${dmrId}/${tg}`, { mcc: dmrId.slice(0, 3), caller: { call, dmrId, tg, bridge: false } });
      }
    }
  }

  // By country, not prefix: the US alone spans 310–319, and two flags on one centroid would stack.
  const byCountry = new Map<string, QsoOrigin>();
  for (const { mcc, caller } of callers.values()) {
    const centroid = COUNTRY_CENTROIDS[mcc];
    if (!centroid) continue;
    const origin = byCountry.get(centroid.iso);
    if (origin) origin.callers.push(caller);
    else byCountry.set(centroid.iso, { mcc, iso: centroid.iso, name: centroid.name, lat: centroid.lat, lon: centroid.lon, callers: [caller] });
  }
  return [...byCountry.values()].sort((a, b) => a.mcc.localeCompare(b.mcc));
}

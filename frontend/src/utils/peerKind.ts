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

// Which table of the linked-systems page a MASTER peer belongs to.

export type PeerEntry = Record<string, unknown>;

/** Phone app or IP terminal logged in through the server's ODTP gateway. */
export function isTerminal(_peerId: string, peer: PeerEntry): boolean {
  return peer.TERMINAL === true;
}
export function isRepeater(peerId: string, peer: PeerEntry): boolean {
  const rx = String(peer.RX_FREQ ?? '');
  const tx = String(peer.TX_FREQ ?? '');
  return peerId.length === 6 && rx !== 'N/A' && tx !== 'N/A' && !isTerminal(peerId, peer);
}
export function isHotspot(peerId: string, peer: PeerEntry): boolean {
  const rx = String(peer.RX_FREQ ?? '');
  const tx = String(peer.TX_FREQ ?? '');
  return peerId.length >= 7 && rx !== 'N/A' && tx !== 'N/A' && !isTerminal(peerId, peer);
}
export function isBridge(peer: PeerEntry): boolean {
  const rx = String(peer.RX_FREQ ?? '');
  const tx = String(peer.TX_FREQ ?? '');
  return rx === 'N/A' && tx === 'N/A' && peer.TERMINAL !== true;
}

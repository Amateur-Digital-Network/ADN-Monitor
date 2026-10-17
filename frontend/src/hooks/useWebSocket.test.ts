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

class FakeSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static last: FakeSocket;
  readyState = FakeSocket.CONNECTING;
  binaryType = 'blob';
  onopen?: () => void;
  onclose?: () => void;
  onerror?: () => void;
  onmessage?: (event: { data: string | ArrayBuffer }) => void;
  sent: string[] = [];
  constructor(public url: string) {
    FakeSocket.last = this;
  }
  send(message: string) {
    this.sent.push(message);
  }
  close() {}
}

vi.stubGlobal('WebSocket', FakeSocket);
vi.stubGlobal('window', { location: { protocol: 'http:', host: 'dash.test' } });
const { decodeFrame, subscribeShared } = await import('./useWebSocket');

/** What WsHub sends a /ws?z=1 tab: a zlib stream (Python zlib.compress). */
function packed(text: string): Promise<ArrayBuffer> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Response(stream).arrayBuffer();
}

describe('compressed dashboard frames', () => {
  it('inflates a binary frame and passes text through', async () => {
    expect(await decodeFrame(await packed('h{"rows":[]}'))).toBe('h{"rows":[]}');
    expect(await decodeFrame('l a log line')).toBe('l a log line');
  });

  it('asks for binary frames and hands messages over in arrival order', async () => {
    const got: string[] = [];
    const unsubscribe = subscribeShared(['main', 'log'], (opcode, payload) => got.push(opcode + payload));
    const ws = FakeSocket.last;
    expect(ws.url).toBe('ws://dash.test/ws?z=1');
    expect(ws.binaryType).toBe('arraybuffer');

    ws.onmessage?.({ data: await packed('i{"lastheard":[]}') });
    ws.onmessage?.({ data: 'l a log line' });

    await vi.waitFor(() => expect(got).toHaveLength(2));
    expect(got).toEqual(['i{"lastheard":[]}', 'l a log line']);
    unsubscribe();
  });
});

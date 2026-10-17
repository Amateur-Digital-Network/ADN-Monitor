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

import { useEffect, useRef, useState, useCallback } from 'react';

const WS_GROUPS = ['main', 'bridge', 'lnksys', 'opb', 'statictg', 'log', 'lsthrd_log', 'tgcount', 'server_info'] as const;
export type WsGroup = (typeof WS_GROUPS)[number];

const GROUP_OPCODE: Record<WsGroup, string> = {
  main: 'i',
  lnksys: 'c',
  opb: 'o',
  statictg: 's',
  bridge: 'b',
  log: 'l',
  lsthrd_log: 'h',
  tgcount: 't',
  server_info: 'v',
};

const RECONNECT_INITIAL_MS = 2000;
const RECONNECT_MAX_DELAY_MS = 15000;

/** The server then sends large messages as zlib binary frames, compressed once for every tab. */
const INFLATES = typeof DecompressionStream !== 'undefined';

function getWsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  return `${proto}//${host}/ws${INFLATES ? '?z=1' : ''}`;
}

export async function decodeFrame(data: string | ArrayBuffer): Promise<string> {
  if (typeof data === 'string') return data;
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Response(stream).text();
}

type MessageHandler = (opcode: string, payload: string) => void;

type SharedSubscription = {
  groups: WsGroup[];
  handler: MessageHandler;
};

/** One browser tab shares a single WebSocket; groups are ref-counted per subscriber. */
const shared = {
  ws: null as WebSocket | null,
  groupRefCount: new Map<WsGroup, number>(),
  subscriptions: new Set<SharedSubscription>(),
  reconnectTimer: null as ReturnType<typeof setTimeout> | null,
  attempt: 0,
  connectedListeners: new Set<(connected: boolean) => void>(),
};

function activeGroups(): WsGroup[] {
  return WS_GROUPS.filter((g) => (shared.groupRefCount.get(g) ?? 0) > 0);
}

function notifyConnected(connected: boolean) {
  for (const listener of shared.connectedListeners) {
    listener(connected);
  }
}

function sendConf(groups: WsGroup[]) {
  if (shared.ws?.readyState === WebSocket.OPEN && groups.length > 0) {
    shared.ws.send('conf,' + groups.join(','));
  }
}

function adjustGroupRefs(groups: WsGroup[], delta: number): WsGroup[] {
  const newlyActive: WsGroup[] = [];
  for (const group of groups) {
    const prev = shared.groupRefCount.get(group) ?? 0;
    const next = prev + delta;
    if (delta > 0 && prev === 0) newlyActive.push(group);
    if (next <= 0) shared.groupRefCount.delete(group);
    else shared.groupRefCount.set(group, next);
  }
  return newlyActive;
}

function connectShared() {
  if (
    shared.ws?.readyState === WebSocket.OPEN
    || shared.ws?.readyState === WebSocket.CONNECTING
  ) {
    return;
  }
  if (activeGroups().length === 0) return;

  const ws = new WebSocket(getWsUrl());
  ws.binaryType = 'arraybuffer';
  shared.ws = ws;
  // Inflating is asynchronous: chain every message so handlers still see them in order.
  let inbox: Promise<void> = Promise.resolve();

  ws.onopen = () => {
    shared.attempt = 0;
    notifyConnected(true);
    sendConf(activeGroups());
  };

  ws.onclose = () => {
    shared.ws = null;
    notifyConnected(false);
    if (activeGroups().length === 0) return;
    const delay = Math.min(
      RECONNECT_INITIAL_MS * Math.pow(1.5, shared.attempt),
      RECONNECT_MAX_DELAY_MS,
    );
    shared.attempt += 1;
    shared.reconnectTimer = setTimeout(() => {
      shared.reconnectTimer = null;
      connectShared();
    }, delay);
  };

  ws.onerror = () => {
    // Close will follow; no extra handling needed
  };

  ws.onmessage = (event: MessageEvent<string | ArrayBuffer>) => {
    const frame = event.data;
    inbox = inbox
      .then(() => decodeFrame(frame))
      .then((data) => {
        const opcode = data.slice(0, 1);
        const payload = data.slice(1);
        for (const sub of shared.subscriptions) {
          sub.handler(opcode, payload);
        }
      })
      .catch((err) => console.error(err));
  };
}

export function subscribeShared(groups: WsGroup[], handler: MessageHandler): () => void {
  const sub: SharedSubscription = { groups, handler };
  const newlyActive = adjustGroupRefs(groups, 1);
  shared.subscriptions.add(sub);
  connectShared();
  if (newlyActive.length > 0) sendConf(newlyActive);

  return () => {
    shared.subscriptions.delete(sub);
    adjustGroupRefs(groups, -1);
    if (activeGroups().length === 0) {
      if (shared.reconnectTimer) {
        clearTimeout(shared.reconnectTimer);
        shared.reconnectTimer = null;
      }
      shared.ws?.close();
      shared.ws = null;
      shared.attempt = 0;
    }
  };
}

function useSharedConnected(): boolean {
  const [connected, setConnected] = useState(shared.ws?.readyState === WebSocket.OPEN);
  useEffect(() => {
    shared.connectedListeners.add(setConnected);
    setConnected(shared.ws?.readyState === WebSocket.OPEN);
    return () => {
      shared.connectedListeners.delete(setConnected);
    };
  }, []);
  return connected;
}

export interface UseWebSocketOptions {
  groups: WsGroup[];
  onMessage?: (opcode: string, payload: string) => void;
}

export function useWebSocket({ groups, onMessage }: UseWebSocketOptions) {
  const [lastMessage, setLastMessage] = useState<{ opcode: string; payload: string } | null>(null);
  const connected = useSharedConnected();
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  const groupsKey = groups.join(',');

  useEffect(() => {
    const subscribedGroups = groupsKey.split(',').filter(Boolean) as WsGroup[];
    if (subscribedGroups.length === 0) return undefined;
    return subscribeShared(subscribedGroups, (opcode, payload) => {
      setLastMessage({ opcode, payload });
      onMessageRef.current?.(opcode, payload);
    });
  }, [groupsKey]);

  const reconnect = useCallback(() => {
    if (shared.reconnectTimer) {
      clearTimeout(shared.reconnectTimer);
      shared.reconnectTimer = null;
    }
    shared.ws?.close();
    shared.ws = null;
    shared.attempt = 0;
    connectShared();
  }, []);

  return { connected, lastMessage, reconnect };
}

/** Payload is JSON for opcodes i,c,o,s,b,h,t,v; plain string for q,l */
function parsePayload(opcode: string, payload: string): unknown {
  if (opcode === 'q' || opcode === 'l') return payload;
  try {
    return JSON.parse(payload) as unknown;
  } catch {
    return payload;
  }
}

export function useWebSocketGroup(group: WsGroup) {
  const [data, setData] = useState<unknown>(null);
  const wantOpcode = GROUP_OPCODE[group];

  useEffect(() => {
    return subscribeShared([group], (opcode, payload) => {
      if (opcode !== wantOpcode) return;
      setData(parsePayload(opcode, payload));
    });
  }, [group, wantOpcode]);

  return { data };
}

export type ServerInfoPayload = { mode?: string; info?: Record<string, unknown> };

/** Opcode v (server_info): one WS group subscription, many React consumers. */
const serverInfoStore = {
  data: null as ServerInfoPayload | null,
  listeners: new Set<(data: ServerInfoPayload | null) => void>(),
  unsubscribe: null as (() => void) | null,
  consumers: 0,
};

function pushServerInfo(data: ServerInfoPayload | null) {
  serverInfoStore.data = data;
  for (const listener of serverInfoStore.listeners) listener(data);
}

function ensureServerInfoSubscription() {
  if (serverInfoStore.unsubscribe) return;
  serverInfoStore.unsubscribe = subscribeShared(['server_info'], (opcode, payload) => {
    if (opcode !== 'v') return;
    pushServerInfo(parsePayload(opcode, payload) as ServerInfoPayload);
  });
}

function releaseServerInfoSubscription() {
  serverInfoStore.unsubscribe?.();
  serverInfoStore.unsubscribe = null;
}

export function useServerInfo(): ServerInfoPayload | null {
  const [data, setData] = useState<ServerInfoPayload | null>(serverInfoStore.data);

  useEffect(() => {
    serverInfoStore.consumers += 1;
    ensureServerInfoSubscription();
    serverInfoStore.listeners.add(setData);
    setData(serverInfoStore.data);
    return () => {
      serverInfoStore.listeners.delete(setData);
      serverInfoStore.consumers -= 1;
      if (serverInfoStore.consumers === 0) releaseServerInfoSubscription();
    };
  }, []);

  return data;
}

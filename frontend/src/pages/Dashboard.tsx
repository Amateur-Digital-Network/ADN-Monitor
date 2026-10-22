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

import { lazy, Suspense, useMemo } from 'react';
import {
  Box,
  Typography,
  Chip,
  Card,
  CardContent,
  Grid,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useWebSocketGroup } from '../hooks/useWebSocket';
import QrzLink, { isCallsignLike } from '../components/QrzLink';
import ActiveQsoBox, { type Ctable, type PeerEntry } from '../components/ActiveQsoBox';
import LastHeardTable, { type LastHeardRow } from '../components/LastHeardTable';
import { useDashboardConfig } from '../context/DashboardConfigContext';
import { activeQsoOrigins } from '../utils/qsoOrigins';

import MapFrame from '../components/map/MapFrame';

const QsoOriginMap = lazy(() => import('../components/map/QsoOriginMap'));

type MainPayload = { lastheard?: LastHeardRow[]; ctable?: Ctable };

type PeerChipItem = { callsign: string; system: string; activeTrx: 'RX' | 'TX' | null };

/** Classify MASTERS peers into repeaters (id length 6), hotspots (7+), bridges (freq N/A). Include activeTrx from timeslots for chip color. */
function getRepeatersHotspotsBridges(ctable: Ctable | null | undefined) {
  const repeaters: PeerChipItem[] = [];
  const hotspots: PeerChipItem[] = [];
  const bridges: PeerChipItem[] = [];
  if (!ctable?.MASTERS) return { repeaters, hotspots, bridges };
  for (const [system, master] of Object.entries(ctable.MASTERS)) {
    const peers = master?.PEERS ?? {};
    for (const [peerId, peer] of Object.entries(peers)) {
      const p = peer as PeerEntry & { RX_FREQ?: string; TX_FREQ?: string };
      const rx = p.RX_FREQ ?? '';
      const tx = p.TX_FREQ ?? '';
      const call = (p.CALLSIGN ?? '').trim() || peerId;
      const ts1 = p[1] ?? (p as Record<string, { TRX?: string } | undefined>)[String(1)];
      const ts2 = p[2] ?? (p as Record<string, { TRX?: string } | undefined>)[String(2)];
      const trx1 = String(ts1?.TRX ?? '').toUpperCase();
      const trx2 = String(ts2?.TRX ?? '').toUpperCase();
      const activeTrx: 'RX' | 'TX' | null = trx1 === 'RX' || trx2 === 'RX' ? 'RX' : trx1 === 'TX' || trx2 === 'TX' ? 'TX' : null;
      const item: PeerChipItem = { callsign: call, system, activeTrx };
      const idLen = String(peerId).length;
      const hasFreq = rx !== 'N/A' && tx !== 'N/A';
      if (hasFreq && idLen === 6) repeaters.push(item);
      else if (hasFreq && idLen >= 7) hotspots.push(item);
      else if (rx === 'N/A' && tx === 'N/A') bridges.push(item);
    }
  }
  return { repeaters, hotspots, bridges };
}

function ConnectedChips({ ctable }: { ctable: Ctable | null | undefined }) {
  const { t } = useTranslation();
  const { repeaters, hotspots, bridges } = getRepeatersHotspotsBridges(ctable);
  const chipSx = { mx: 0.25, mb: 0.5 };
  const chipFilledSx = (color: 'error' | 'success') => ({
    ...chipSx,
    color: (theme: { palette: { error: { contrastText: string }; success: { contrastText: string } } }) => theme.palette[color].contrastText,
    '& .MuiChip-label, & a': { color: 'inherit' },
  });
  return (
    <Grid container spacing={2} sx={{ mb: 2 }}>
      <Grid item xs={12} md={4}>
        <Card variant="outlined" sx={{ borderColor: 'divider', height: '100%' }}>
          <CardContent>
            <Typography variant="subtitle2" fontWeight={600} color="text.primary" sx={{ mb: 1 }}>
              {t('crd_rptrs', { defaultValue: 'Repeaters' })} ({repeaters.length})
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              {repeaters.length === 0 ? (
                <Typography variant="body2" color="text.secondary">—</Typography>
              ) : (
                repeaters.map(({ callsign, system, activeTrx }, i) => (
                  <Chip
                    key={`r-${system}-${callsign}-${i}`}
                    size="small"
                    label={isCallsignLike(callsign) ? <QrzLink callsign={callsign}>{callsign}</QrzLink> : callsign}
                    sx={activeTrx ? chipFilledSx(activeTrx === 'RX' ? 'error' : 'success') : chipSx}
                    variant={activeTrx ? 'filled' : 'outlined'}
                    color={activeTrx === 'RX' ? 'error' : activeTrx === 'TX' ? 'success' : 'default'}
                  />
                ))
              )}
            </Box>
          </CardContent>
        </Card>
      </Grid>
      <Grid item xs={12} md={4}>
        <Card variant="outlined" sx={{ borderColor: 'divider', height: '100%' }}>
          <CardContent>
            <Typography variant="subtitle2" fontWeight={600} color="text.primary" sx={{ mb: 1 }}>
              {t('crd_htspts', { defaultValue: 'HotSpots' })} ({hotspots.length})
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              {hotspots.length === 0 ? (
                <Typography variant="body2" color="text.secondary">—</Typography>
              ) : (
                hotspots.map(({ callsign, system, activeTrx }, i) => (
                  <Chip
                    key={`h-${system}-${callsign}-${i}`}
                    size="small"
                    label={isCallsignLike(callsign) ? <QrzLink callsign={callsign}>{callsign}</QrzLink> : callsign}
                    sx={activeTrx ? chipFilledSx(activeTrx === 'RX' ? 'error' : 'success') : chipSx}
                    variant={activeTrx ? 'filled' : 'outlined'}
                    color={activeTrx === 'RX' ? 'error' : activeTrx === 'TX' ? 'success' : 'default'}
                  />
                ))
              )}
            </Box>
          </CardContent>
        </Card>
      </Grid>
      <Grid item xs={12} md={4}>
        <Card variant="outlined" sx={{ borderColor: 'divider', height: '100%' }}>
          <CardContent>
            <Typography variant="subtitle2" fontWeight={600} color="text.primary" sx={{ mb: 1 }}>
              {t('crd_brdg', { defaultValue: 'Bridges' })} ({bridges.length})
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              {bridges.length === 0 ? (
                <Typography variant="body2" color="text.secondary">—</Typography>
              ) : (
                bridges.map(({ callsign, system, activeTrx }, i) => (
                  <Chip key={`b-${system}-${callsign}-${i}`} size="small" label={callsign} sx={activeTrx ? chipFilledSx(activeTrx === 'RX' ? 'error' : 'success') : chipSx} variant={activeTrx ? 'filled' : 'outlined'} color={activeTrx === 'RX' ? 'error' : activeTrx === 'TX' ? 'success' : 'default'} />
                ))
              )}
            </Box>
          </CardContent>
        </Card>
      </Grid>
    </Grid>
  );
}

export default function Dashboard() {
  const { t } = useTranslation();
  const { data } = useWebSocketGroup('main');
  const payload = data as MainPayload | null;
  const rows = payload?.lastheard ?? [];
  const ctable = payload?.ctable;
  const { map: mapConfig } = useDashboardConfig();
  const origins = useMemo(() => activeQsoOrigins(ctable), [ctable]);

  return (
    <Box>
      {!data && (
        <Typography color="text.secondary" sx={{ py: 2 }}>{t('pre_wait')}</Typography>
      )}
      {data != null ? <ActiveQsoBox ctable={ctable ?? undefined} /> : null}
      {data != null && mapConfig.enabled ? (
        <Box sx={{ mb: 2 }} aria-label={t('map_qso_origins', { defaultValue: 'Where the calls on air come from' })}>
          <MapFrame height={{ xs: 280, sm: 420, md: 520 }}>
            <Suspense fallback={null}>
              <QsoOriginMap origins={origins} config={mapConfig} />
            </Suspense>
          </MapFrame>
        </Box>
      ) : null}
      {rows.length > 0 && (
        <LastHeardTable rows={rows} caption={t('nav_dash', { defaultValue: 'Dashboard' })} mb={2} />
      )}
      {data != null && ctable ? <ConnectedChips ctable={ctable} /> : null}
    </Box>
  );
}

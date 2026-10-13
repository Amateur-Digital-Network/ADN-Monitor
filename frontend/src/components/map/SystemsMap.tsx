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

/**
 * Map page: one map with switchable layers (repeaters, hotspots, bridges,
 * live traffic, Last Heard stations and an optional external GPS feed) so each
 * operator picks what to see. Laid out for phones as much as for desktops.
 */

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Chip,
  CircularProgress,
  FormControlLabel,
  IconButton,
  Paper,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import CloseFullscreenIcon from '@mui/icons-material/CloseFullscreen';
import OpenInFullIcon from '@mui/icons-material/OpenInFull';
import ZoomOutMapIcon from '@mui/icons-material/ZoomOutMap';
import { useTranslation } from 'react-i18next';

import { useWebSocketGroup } from '../hooks/useWebSocket';
import { useDashboardConfig } from '../context/DashboardConfigContext';
import {
  buildOpenBridgePoints,
  buildPeerPoints,
  parseGpsFeed,
  type Ctable,
  type GpsPoint,
  type PeerPoint,
} from '../utils/mapPoints';
import { MARKER_COLORS, type MapLabels } from '../components/map/markerStyles';

const LiveMap = lazy(() => import('../components/map/LiveMap'));

type LnksysPayload = { ctable?: Ctable };
type OpbPayload = { ctable?: Ctable };

const LAYER_IDS = ['repeaters', 'hotspots', 'bridges', 'onair', 'gps'] as const;
type LayerId = (typeof LAYER_IDS)[number];

const DEFAULT_LAYERS: LayerId[] = ['repeaters', 'hotspots', 'onair'];

function readStoredLayers(): Set<LayerId> {
  try {
    const raw = localStorage.getItem('mapLayers');
    if (raw) {
      const parsed = JSON.parse(raw) as string[];
      const valid = parsed.filter((id): id is LayerId => (LAYER_IDS as readonly string[]).includes(id));
      if (valid.length > 0) return new Set(valid);
    }
  } catch {
    /* private mode: fall back to the defaults */
  }
  return new Set(DEFAULT_LAYERS);
}

function readStoredFlag(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === '1';
  } catch {
    return fallback;
  }
}

function storeFlag(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    /* private mode: preference is simply not remembered */
  }
}

export default function MapView() {
  const { t } = useTranslation();
  const theme = useTheme();
  const isNarrow = useMediaQuery(theme.breakpoints.down('sm'));
  const { map: mapConfig } = useDashboardConfig();

  const { data: lnksysData } = useWebSocketGroup('lnksys');
  // OpenBridge streams: live traffic from the rest of the network.
  const { data: opbData } = useWebSocketGroup('opb');

  const [layers, setLayers] = useState<Set<LayerId>>(readStoredLayers);
  const [approx, setApprox] = useState(() => readStoredFlag('mapApprox', mapConfig.approxByCountry));
  const [follow, setFollow] = useState(() => readStoredFlag('mapFollow', false));
  const [fullscreen, setFullscreen] = useState(false);
  const [search, setSearch] = useState('');
  const [fitSignal, setFitSignal] = useState(0);
  const [gpsPoints, setGpsPoints] = useState<GpsPoint[]>([]);
  const firstFitDone = useRef(false);

  const gpsEnabled = layers.has('gps') && Boolean(mapConfig.gpsUrl);

  const toggleLayer = useCallback((id: LayerId) => {
    setLayers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem('mapLayers', JSON.stringify([...next]));
      } catch {
        /* private mode: layer choice is simply not remembered */
      }
      return next;
    });
  }, []);

  // Optional external position feed (MAP.GPS_URL), polled while its layer is on.
  useEffect(() => {
    if (!gpsEnabled) {
      setGpsPoints([]);
      return undefined;
    }
    let cancelled = false;
    const load = () => {
      fetch(mapConfig.gpsUrl)
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
        .then((data) => {
          if (!cancelled) setGpsPoints(parseGpsFeed(data));
        })
        .catch(() => {
          if (!cancelled) setGpsPoints([]);
        });
    };
    load();
    const timer = setInterval(load, Math.max(mapConfig.gpsRefreshSec, 15) * 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [gpsEnabled, mapConfig.gpsUrl, mapConfig.gpsRefreshSec]);

  const ctable = (lnksysData as LnksysPayload | null)?.ctable ?? null;
  const opbCtable = (opbData as OpbPayload | null)?.ctable ?? null;

  const allPeers = useMemo(
    () => buildPeerPoints(ctable, mapConfig, approx),
    [ctable, mapConfig, approx],
  );

  const needle = search.trim().toLowerCase();
  const matches = useCallback(
    (haystack: string[]) => !needle || haystack.some((value) => value.toLowerCase().includes(needle)),
    [needle],
  );

  const onairOnly =
    layers.has('onair') && !layers.has('repeaters') && !layers.has('hotspots') && !layers.has('bridges');

  const networkCalls = useMemo(
    () => (layers.has('onair') ? buildOpenBridgePoints(opbCtable, approx) : []),
    [opbCtable, approx, layers],
  );

  const peers = useMemo(() => {
    const own = allPeers.filter((point) => {
      const kindShown =
        (point.kind === 'repeater' && layers.has('repeaters'))
        || (point.kind === 'hotspot' && layers.has('hotspots'))
        || (point.kind === 'bridge' && layers.has('bridges'));
      const airShown = point.active && layers.has('onair');
      if (!kindShown && !airShown) return false;
      if (onairOnly && !airShown) return false;
      return true;
    });
    return [...own, ...networkCalls].filter((point) =>
      matches([point.callsign, point.peerId, point.location, point.system, point.activeCall, point.activeTg]),
    );
  }, [allPeers, networkCalls, layers, matches, onairOnly]);

  const gps = useMemo(
    () => (gpsEnabled ? gpsPoints.filter((point) => matches([point.callsign, point.comment])) : []),
    [gpsEnabled, gpsPoints, matches],
  );

  // First data: frame everything once, then leave the view to the operator.
  useEffect(() => {
    if (firstFitDone.current || peers.length === 0) return;
    firstFitDone.current = true;
    let stored = false;
    try {
      stored = localStorage.getItem('mapView') !== null;
    } catch {
      stored = false;
    }
    if (!stored) setFitSignal((value) => value + 1);
  }, [peers.length]);

  const labels: MapLabels = useMemo(
    () => ({
      repeater: t('lnksys_repeaters', { defaultValue: 'Repeaters' }),
      hotspot: t('lnksys_hotspots', { defaultValue: 'Hotspots' }),
      bridge: t('crd_brdg', { defaultValue: 'Bridges' }),
      gps: mapConfig.gpsLabel || t('map_layer_gps', { defaultValue: 'GPS' }),
      onAir: t('map_on_air', { defaultValue: 'On air' }),
      approx: t('map_approx', { defaultValue: 'approximate position' }),
      connected: t('lnksys_connected', { defaultValue: 'Time Connected' }),
      location: t('lnksys_loc', { defaultValue: 'Location' }),
      tg: t('lnksys_static_tg', { defaultValue: 'TG' }),
      system: t('map_system', { defaultValue: 'System' }),
      qrz: t('map_qrz', { defaultValue: 'QRZ profile' }),
    }),
    [t, mapConfig.gpsLabel],
  );

  const layerChips: { id: LayerId; label: string; color: string; hidden?: boolean }[] = [
    { id: 'repeaters', label: labels.repeater, color: MARKER_COLORS.repeater },
    { id: 'hotspots', label: labels.hotspot, color: MARKER_COLORS.hotspot },
    { id: 'bridges', label: labels.bridge, color: MARKER_COLORS.bridge },
    { id: 'onair', label: labels.onAir, color: MARKER_COLORS.active },
    { id: 'gps', label: labels.gps, color: MARKER_COLORS.gps, hidden: !mapConfig.gpsUrl },
  ];

  if (!mapConfig.enabled) {
    return (
      <Typography color="text.secondary">
        {t('map_disabled', { defaultValue: 'The map is disabled in this dashboard.' })}
      </Typography>
    );
  }

  const activeCount = peers.filter((point: PeerPoint) => point.active).length;
  const nothingVisible = peers.length + gps.length === 0;

  const controls = (
    <Stack spacing={1.25}>
      <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" alignItems="center">
        {layerChips
          .filter((chip) => !chip.hidden)
          .map((chip) => {
            const on = layers.has(chip.id);
            return (
              <Chip
                key={chip.id}
                label={chip.label}
                onClick={() => toggleLayer(chip.id)}
                variant={on ? 'filled' : 'outlined'}
                sx={{
                  cursor: 'pointer',
                  fontWeight: 600,
                  borderColor: chip.color,
                  color: on ? theme.palette.getContrastText(chip.color) : 'text.primary',
                  bgcolor: on ? chip.color : 'transparent',
                  '&:hover': { bgcolor: on ? chip.color : theme.palette.action.hover },
                }}
              />
            );
          })}
      </Stack>

      <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" alignItems="center">
        <TextField
          size="small"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('map_search', { defaultValue: 'Callsign, DMR ID, location…' })}
          sx={{ flex: '1 1 200px', minWidth: 160 }}
          inputProps={{ 'aria-label': t('map_search', { defaultValue: 'Callsign, DMR ID, location…' }) }}
        />
        <Tooltip title={t('map_fit', { defaultValue: 'Fit to markers' })}>
          <IconButton onClick={() => setFitSignal((value) => value + 1)} size="small">
            <ZoomOutMapIcon />
          </IconButton>
        </Tooltip>
        <Tooltip
          title={
            fullscreen
              ? t('map_exit_fullscreen', { defaultValue: 'Exit full screen' })
              : t('map_fullscreen', { defaultValue: 'Full screen' })
          }
        >
          <IconButton onClick={() => setFullscreen((value) => !value)} size="small">
            {fullscreen ? <CloseFullscreenIcon /> : <OpenInFullIcon />}
          </IconButton>
        </Tooltip>
      </Stack>

      <Stack direction="row" spacing={2} useFlexGap flexWrap="wrap" alignItems="center">
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={follow}
              onChange={(event) => {
                setFollow(event.target.checked);
                storeFlag('mapFollow', event.target.checked);
              }}
            />
          }
          label={
            <Typography variant="body2">{t('map_follow', { defaultValue: 'Follow traffic' })}</Typography>
          }
        />
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={approx}
              onChange={(event) => {
                setApprox(event.target.checked);
                storeFlag('mapApprox', event.target.checked);
              }}
            />
          }
          label={
            <Typography variant="body2">
              {t('map_approx_toggle', { defaultValue: 'Approximate by country' })}
            </Typography>
          }
        />
        <Typography variant="caption" color="text.secondary">
          {t('map_counts', {
            defaultValue: '{{systems}} systems · {{active}} on air',
            systems: peers.length,
            active: activeCount,
          })}
          {gps.length > 0
            ? ` · ${t('map_counts_gps', { defaultValue: '{{n}} GPS', n: gps.length })}`
            : ''}
        </Typography>
      </Stack>
    </Stack>
  );

  const mapBox = (
    <Box
      sx={
        fullscreen
          ? {
              position: 'fixed',
              inset: 0,
              zIndex: theme.zIndex.modal,
              bgcolor: 'background.default',
            }
          : {
              position: 'relative',
              height: { xs: 'min(70dvh, 520px)', sm: 'min(72dvh, 620px)', md: 'min(75dvh, 760px)' },
              minHeight: 320,
              borderRadius: 2,
              overflow: 'hidden',
              border: '1px solid',
              borderColor: 'divider',
            }
      }
    >
      <Suspense
        fallback={
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <CircularProgress />
          </Box>
        }
      >
        <LiveMap
          peers={peers}
          gps={gps}
          config={mapConfig}
          labels={labels}
          fitSignal={fitSignal}
          follow={follow}
        />
      </Suspense>
      {nothingVisible && (
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            p: 2,
            pointerEvents: 'none',
            zIndex: 500,
          }}
        >
          <Paper sx={{ px: 2, py: 1.25, maxWidth: 360, textAlign: 'center', opacity: 0.94 }}>
            <Typography variant="body2" color="text.secondary">
              {onairOnly
                ? t('map_empty_onair', {
                    defaultValue: 'Nobody is transmitting through this server right now.',
                  })
                : t('map_empty', {
                    defaultValue: 'Nothing to show with these layers and filters.',
                  })}
            </Typography>
          </Paper>
        </Box>
      )}
      {fullscreen && (
        <IconButton
          onClick={() => setFullscreen(false)}
          aria-label={t('map_exit_fullscreen', { defaultValue: 'Exit full screen' })}
          sx={{
            position: 'absolute',
            top: 10,
            right: 10,
            zIndex: 1000,
            bgcolor: 'background.paper',
            boxShadow: 2,
            '&:hover': { bgcolor: 'background.paper' },
          }}
        >
          <CloseFullscreenIcon />
        </IconButton>
      )}
    </Box>
  );

  return (
    <Box>
      {!fullscreen && (
        <Typography variant="h6" sx={{ mb: 1.5 }}>
          {t('map_title', { defaultValue: 'Map' })}
        </Typography>
      )}
      {!fullscreen && (
        <Paper sx={{ p: { xs: 1.5, sm: 2 }, mb: 2 }}>{controls}</Paper>
      )}
      {mapBox}
      {!fullscreen && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          {t('map_note', {
            defaultValue:
              'Systems are placed where they report their coordinates; dashed markers are approximate.',
          })}
          {' '}
          {t('map_note_scope', {
            defaultValue:
              'Only systems connected to this server report coordinates; calls arriving over OpenBridge are placed over the country of the transmitting DMR ID.',
          })}
          {isNarrow
            ? ` ${t('map_note_mobile', { defaultValue: 'Tap a marker for details.' })}`
            : ''}
        </Typography>
      )}
    </Box>
  );
}

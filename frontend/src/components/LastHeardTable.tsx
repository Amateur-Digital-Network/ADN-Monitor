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

import {
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  useMediaQuery,
  type SxProps,
  type Theme,
} from '@mui/material';
import TimerOutlinedIcon from '@mui/icons-material/TimerOutlined';
import { useTranslation } from 'react-i18next';
import QrzLink from './QrzLink';
import { TableCaptionTitle } from './TableCaptionTitle';

export type LastHeardRow = {
  date: string;
  qso_time: number | string;
  qso_type: string;
  system: string;
  tg_num: number;
  tg_callsign: string;
  dmr_id: number;
  subscriber: string[];
};

/** Country code from numeric id (first 2-3 digits). */
function getCountryCodeFromId(id: number): string {
  const n = String(id).replace(/\D/g, '');
  if (n.length >= 3) return n.slice(0, 3);
  if (n.length >= 2) return n.slice(0, 2);
  return n || '';
}

/** Country code from TG number (e.g. 21472 -> 214). */
function getCountryCode(tgNum: number): string {
  return getCountryCodeFromId(tgNum);
}

const PROTOCOL_ICONS = ['allstar', 'dstar', 'echolink', 'm17', 'nxdn', 'tetra', 'xlx', 'yaesu'] as const;

function protocolIconsFromText(text: string): string[] {
  const s = (text || '').toLowerCase();
  return PROTOCOL_ICONS.filter((name) => s.includes(name));
}

function FlagImg({ code, fallback = 'world' }: { code: string; fallback?: string }) {
  const src = code ? `/img/flags/${code}.png` : `/img/flags/${fallback}.png`;
  return (
    <Box
      component="img"
      src={src}
      alt=""
      onError={(e) => { (e.target as HTMLImageElement).src = `/img/flags/world.png`; }}
      sx={{ width: 20, height: 14, objectFit: 'contain', flexShrink: 0 }}
    />
  );
}

function ProtocolIcon({ name }: { name: string }) {
  return (
    <Box
      component="img"
      src={`/img/bridges/${name}.png`}
      alt={name}
      sx={{ width: 18, height: 18, objectFit: 'contain', ml: 0.25 }}
    />
  );
}

function IdChip({ id, sx }: { id: number; sx?: SxProps<Theme> }) {
  return (
    <Chip
      label={id}
      size="small"
      variant="outlined"
      sx={[{ height: 20, fontSize: '0.7rem', fontWeight: 500 }, ...(Array.isArray(sx) ? sx : [sx])]}
    />
  );
}

const headSx = { fontWeight: 600 } as const;

type Props = {
  rows: LastHeardRow[];
  caption: string;
  /** Adds the System (source) column, used by the full Last Heard log. */
  showSystem?: boolean;
  mb?: number;
};

/**
 * Last-heard table shared by the Dashboard and the Last Heard log.
 * On phones (xs) Date/Time/Name/System collapse: the operator name moves under
 * the callsign, the TG flag is dropped and the TG name is clamped to two lines,
 * so the table fits the viewport. From sm up the layout is unchanged.
 * The phone variant is chosen with useMediaQuery rather than CSS, so only the
 * active cells are rendered on every WebSocket push.
 */
export default function LastHeardTable({ rows, caption, showSystem = false, mb = 0 }: Props) {
  const { t } = useTranslation();
  const durationLabel = t('lh_duration');
  const isPhone = useMediaQuery((theme: Theme) => theme.breakpoints.down('sm'), { noSsr: true });

  return (
    <TableContainer
      component={Paper}
      sx={{
        mt: 0,
        mb,
        overflow: 'auto',
        boxShadow: (theme) => (theme.palette.mode === 'dark' ? 'none' : '0 1px 3px rgba(0,0,0,0.08)'),
      }}
    >
      <Table size="small" stickyHeader sx={isPhone ? { '& .MuiTableCell-root': { px: 1 } } : undefined}>
        <TableCaptionTitle>{caption}</TableCaptionTitle>
        <TableHead>
          <TableRow sx={{ bgcolor: 'action.hover' }}>
            {!isPhone && <TableCell sx={{ ...headSx, whiteSpace: 'nowrap' }}>{t('lh_date')}</TableCell>}
            {!isPhone && <TableCell sx={{ ...headSx, whiteSpace: 'nowrap' }}>{t('lh_time')}</TableCell>}
            <TableCell sx={headSx}>{t('lh_callsignid', { defaultValue: 'Callsign (ID)' })}</TableCell>
            {!isPhone && <TableCell sx={headSx}>{t('lh_name', { defaultValue: 'Name' })}</TableCell>}
            <TableCell sx={headSx}>{t('lh_tgnum', { defaultValue: 'TG#' })}</TableCell>
            <TableCell sx={headSx}>{t('lh_tgname', { defaultValue: 'TG Name' })}</TableCell>
            <TableCell sx={{ ...headSx, whiteSpace: 'nowrap', textAlign: isPhone ? 'right' : 'left' }}>
              {isPhone ? (
                <TimerOutlinedIcon titleAccess={durationLabel} fontSize="small" sx={{ verticalAlign: 'middle' }} />
              ) : (
                durationLabel
              )}
            </TableCell>
            {showSystem && !isPhone && <TableCell sx={headSx}>{t('lh_system')}</TableCell>}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((r, i) => {
            const dateStr = String(r.date ?? '');
            const [datePart, timePart] = dateStr.includes(' ') ? dateStr.split(' ', 2) : [dateStr, ''];
            const durationSec = r.qso_time != null && r.qso_time !== '' ? Math.round(Number(r.qso_time)) : null;
            const isBridge = r.subscriber?.[0]?.toUpperCase() === 'BRIDGE';
            const operatorName = r.subscriber?.[1];
            const callFlagCode = getCountryCodeFromId(r.dmr_id);
            const tgFlagCode = getCountryCode(r.tg_num);
            const protocolIcons = protocolIconsFromText(`${r.tg_callsign} ${r.system}`);
            return (
              <TableRow key={i} sx={{ '&:hover': { bgcolor: 'action.hover' } }}>
                {!isPhone && <TableCell sx={{ width: 105, minWidth: 105, whiteSpace: 'nowrap' }}>{datePart}</TableCell>}
                {!isPhone && <TableCell sx={{ whiteSpace: 'nowrap' }}>{timePart}</TableCell>}
                <TableCell sx={{ minWidth: isPhone ? undefined : 220 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'nowrap' }}>
                    <FlagImg code={callFlagCode} />
                    {isBridge ? (
                      <Typography component="span" variant="body2" fontWeight={600}>Bridge</Typography>
                    ) : r.subscriber?.length ? (
                      <QrzLink callsign={r.subscriber[0]}>
                        <Typography component="span" fontWeight={600}>{r.subscriber[0]}</Typography>
                      </QrzLink>
                    ) : null}
                    {!isPhone && <IdChip id={r.dmr_id} />}
                  </Box>
                  {/* Phones: the ID chip and the operator name share a second line. */}
                  {isPhone && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap', mt: 0.25 }}>
                      <IdChip id={r.dmr_id} sx={{ height: 18, fontSize: '0.65rem' }} />
                      {operatorName ? (
                        <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.3 }}>
                          {operatorName}
                        </Typography>
                      ) : null}
                    </Box>
                  )}
                </TableCell>
                {!isPhone && (
                  <TableCell>
                    <Typography component="span" variant="body2" fontWeight={600}>
                      {operatorName ?? '—'}
                    </Typography>
                  </TableCell>
                )}
                <TableCell>
                  <Typography component="span" variant="body2" fontWeight={600}>
                    {r.tg_num}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, flexWrap: 'wrap' }}>
                    {!isPhone && <FlagImg code={tgFlagCode} />}
                    <Typography
                      component="span"
                      variant="body2"
                      fontWeight={600}
                      sx={isPhone ? {
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                        wordBreak: 'break-word',
                      } : undefined}
                    >
                      {r.tg_callsign || '—'}
                    </Typography>
                    {protocolIcons.map((name) => (
                      <ProtocolIcon key={name} name={name} />
                    ))}
                  </Box>
                </TableCell>
                <TableCell sx={{ width: 60, textAlign: isPhone ? 'right' : 'left' }}>
                  {durationSec != null ? durationSec : '—'}
                </TableCell>
                {showSystem && !isPhone && <TableCell>{r.system ?? '—'}</TableCell>}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

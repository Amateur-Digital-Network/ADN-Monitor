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

import { Box, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useWebSocketGroup } from '../hooks/useWebSocket';
import ActiveQsoBox, { type Ctable } from '../components/ActiveQsoBox';
import LastHeardTable, { type LastHeardRow } from '../components/LastHeardTable';

type MainPayload = { ctable?: Ctable };
type LogPayload = { rows?: LastHeardRow[] };

export default function LastHeardLog() {
  const { t } = useTranslation();
  const { data: mainData } = useWebSocketGroup('main');
  const { data: logData } = useWebSocketGroup('lsthrd_log');
  const mainPayload = mainData as MainPayload | null;
  const logPayload = logData as LogPayload | null;
  const logRows = logPayload?.rows ?? [];
  const ctable = mainPayload?.ctable;
  const hasAnyData = mainData != null || logData != null;

  return (
    <Box>
      {!hasAnyData && (
        <Typography color="text.secondary" sx={{ py: 2 }}>{t('pre_wait')}</Typography>
      )}
      {mainData != null && <ActiveQsoBox ctable={ctable ?? undefined} />}
      {logRows.length > 0 && (
        <LastHeardTable rows={logRows} caption={t('nav_lsthrd', { defaultValue: 'Last Heard Log' })} showSystem />
      )}
    </Box>
  );
}

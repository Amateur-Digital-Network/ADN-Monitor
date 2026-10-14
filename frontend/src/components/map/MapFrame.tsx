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

/** Map box with a maximise button that lifts the same map into a modal: Leaflet is never rebuilt. */

import { useEffect, useState, type ReactNode } from 'react';
import { Box, IconButton, Tooltip } from '@mui/material';
import CloseFullscreenIcon from '@mui/icons-material/CloseFullscreen';
import OpenInFullIcon from '@mui/icons-material/OpenInFull';
import { useTranslation } from 'react-i18next';

type MapFrameProps = {
  /** Height in the page; the box keeps it while the map is maximised so nothing below jumps. */
  height: number | string | Record<string, number | string>;
  children: ReactNode;
  /** Drawn over the map, e.g. an empty-state notice. */
  overlay?: ReactNode;
};

export default function MapFrame({ height, children, overlay }: MapFrameProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!expanded) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false);
    };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [expanded]);

  const label = expanded
    ? t('map_exit_fullscreen', { defaultValue: 'Exit full screen' })
    : t('map_fullscreen', { defaultValue: 'Full screen' });

  return (
    <Box sx={{ position: 'relative', height, minHeight: 240 }}>
      {expanded && (
        <Box
          onClick={() => setExpanded(false)}
          sx={{ position: 'fixed', inset: 0, zIndex: (theme) => theme.zIndex.modal, bgcolor: 'rgba(0,0,0,0.6)' }}
        />
      )}
      <Box
        sx={
          expanded
            ? {
                position: 'fixed',
                inset: { xs: 0, md: '4vh 4vw' },
                zIndex: (theme) => theme.zIndex.modal,
                borderRadius: { xs: 0, md: 2 },
                overflow: 'hidden',
                boxShadow: 24,
                bgcolor: 'background.default',
              }
            : {
                position: 'absolute',
                inset: 0,
                borderRadius: 2,
                overflow: 'hidden',
                border: '1px solid',
                borderColor: 'divider',
              }
        }
      >
        {children}
        {overlay}
        <Tooltip title={label}>
          <IconButton
            onClick={() => setExpanded((value) => !value)}
            aria-label={label}
            size="small"
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
            {expanded ? <CloseFullscreenIcon fontSize="small" /> : <OpenInFullIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
      </Box>
    </Box>
  );
}

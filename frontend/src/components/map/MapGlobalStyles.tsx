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

/** Leaflet look shared by every map: popups, controls, tile darkening, country codes and flags. */

import { GlobalStyles, useTheme } from '@mui/material';

import { MARKER_COLORS } from './markerStyles';

export default function MapGlobalStyles() {
  const theme = useTheme();
  const dark = theme.palette.mode === 'dark';
  return (
    <GlobalStyles
      styles={{
        '.adn-map-dark .leaflet-tile-pane': {
          filter: 'invert(1) hue-rotate(180deg) brightness(0.92) contrast(0.88) saturate(0.7)',
        },
        '.adn-country-code': {
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '0.04em',
          lineHeight: '12px',
          textAlign: 'center',
          whiteSpace: 'nowrap',
        },
        // Doubled class: leaflet.css loads after these styles and would win a tie (white tooltip).
        '.leaflet-tooltip.adn-tooltip': {
          background: theme.palette.background.paper,
          color: theme.palette.text.primary,
          border: `1px solid ${theme.palette.divider}`,
          borderRadius: 8,
          boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
        },
        '.adn-tooltip.leaflet-tooltip-top::before': { borderTopColor: theme.palette.background.paper },
        '.adn-tooltip.leaflet-tooltip-right::before': { borderRightColor: theme.palette.background.paper },
        // Same card as the click popup.
        '.leaflet-tooltip.adn-details': {
          width: 'max-content',
          minWidth: 200,
          maxWidth: 260,
          padding: '10px 12px',
          borderRadius: 12,
          boxShadow: '0 6px 24px rgba(0,0,0,0.25)',
          whiteSpace: 'normal',
          lineHeight: 1.45,
          fontSize: 13,
        },
        '.adn-marker-label': {
          position: 'absolute',
          left: '50%',
          top: '100%',
          marginTop: 2,
          transform: 'translateX(-50%)',
          whiteSpace: 'nowrap',
          fontSize: 11,
          fontWeight: 600,
          color: theme.palette.text.primary,
          textShadow: dark
            ? '0 0 3px #000, 0 0 2px #000'
            : '0 0 3px #fff, 0 0 2px #fff',
        },
        '.adn-marker-label.adn-live': {
          padding: '1px 6px',
          borderRadius: 6,
          background: theme.palette.error.main,
          color: theme.palette.error.contrastText,
          textShadow: 'none',
          boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
        },
        '.adn-marker': { background: 'none', border: 'none' },
        '.adn-marker svg': { display: 'block', overflow: 'visible', filter: 'drop-shadow(0 1px 1.5px rgba(0,0,0,0.65))' },
        '.adn-faded': { opacity: 0.55 },
        '@keyframes adnWave': { from: { opacity: 1 }, to: { opacity: 0.1 } },
        '.adn-wave': { animation: 'adnWave 0.8s ease-in-out infinite alternate' },
        '.adn-wave-outer': { animationDelay: '0.4s' },
        '.adn-cluster span': {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          height: '100%',
          borderRadius: '50%',
          background: MARKER_COLORS.hotspot,
          color: '#ffffff',
          fontWeight: 700,
          fontSize: '0.8rem',
          border: '2px solid #ffffff',
          boxShadow: `0 0 0 4px ${MARKER_COLORS.hotspot}55, 0 2px 8px rgba(0,0,0,0.45)`,
        },
        '.adn-qso': { background: 'none', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' },
        '.adn-qso > .adn-qso-flag': {
          position: 'relative',
          width: 30,
          height: 20,
          objectFit: 'cover',
          borderRadius: 3,
          boxShadow: `0 0 0 2px ${theme.palette.background.paper}, 0 2px 8px rgba(0,0,0,0.45)`,
        },
        '.adn-qso-dot': {
          position: 'relative',
          width: 12,
          height: 12,
          borderRadius: '50%',
          background: MARKER_COLORS.bridge,
          border: '2px solid #ffffff',
          boxShadow: '0 2px 6px rgba(0,0,0,0.45)',
        },
        '.adn-qso-callout': { '--stem': '46px', '--dx': '0px' },
        // Runs from the card down to the centre of the flag, which (in the pane above) covers its end.
        '.adn-qso-stem': {
          position: 'absolute',
          left: 0,
          bottom: 0,
          width: 1,
          height: 'var(--stem)',
          background: dark ? '#e2e8f0' : '#334155',
        },
        '.adn-qso-card': {
          position: 'absolute',
          left: 'var(--dx)',
          bottom: 'var(--stem)',
          transform: 'translateX(-50%)',
          padding: '3px 8px',
          borderRadius: 6,
          border: `1px solid ${dark ? '#e2e8f0' : '#334155'}`,
          background: dark ? 'rgba(11,17,32,0.94)' : 'rgba(255,255,255,0.96)',
          boxShadow: '0 4px 14px rgba(0,0,0,0.35)',
          whiteSpace: 'nowrap',
          textAlign: 'center',
          lineHeight: 1.25,
        },
        '.adn-qso-down .adn-qso-stem': { bottom: 'auto', top: 0 },
        '.adn-qso-down .adn-qso-card': { bottom: 'auto', top: 'var(--stem)' },
        '.adn-qso-bridge-only .adn-qso-card': { borderColor: MARKER_COLORS.bridge },
        '.adn-qso-bridge-only .adn-qso-stem': { background: MARKER_COLORS.bridge },
        '.adn-qso-row b': { display: 'block', fontSize: 12, fontWeight: 700, color: MARKER_COLORS.hotspot },
        '.adn-qso-row small': { display: 'block', fontSize: 10, color: theme.palette.text.primary, opacity: 0.85 },
        '.adn-qso-row + .adn-qso-row': { marginTop: 3, paddingTop: 3, borderTop: `1px solid ${theme.palette.divider}` },
        '.adn-qso-bridge': { display: 'flex', alignItems: 'center', gap: 6, textAlign: 'left', color: MARKER_COLORS.bridge },
        '.adn-qso-bridge b': { color: MARKER_COLORS.bridge },
        '.adn-qso-bridge .adn-qso-flag': { width: 18, height: 12, objectFit: 'cover', borderRadius: 2 },
        '.leaflet-container.leaflet-container': {
          width: '100%',
          height: '100%',
          background: dark ? '#0b1120' : '#e8eef3',
          fontFamily: theme.typography.fontFamily,
        },
        '.adn-popup .leaflet-popup-content-wrapper': {
          background: theme.palette.background.paper,
          color: theme.palette.text.primary,
          borderRadius: 12,
          boxShadow: '0 6px 24px rgba(0,0,0,0.25)',
        },
        '.adn-popup .leaflet-popup-tip': { background: theme.palette.background.paper },
        '.adn-popup .leaflet-popup-content': { margin: '10px 12px', lineHeight: 1.45 },
        '.adn-pop-title': { fontWeight: 700, fontSize: '0.95rem' },
        '.adn-pop-title span': { color: theme.palette.text.secondary, fontWeight: 400, fontSize: '0.8rem' },
        '.adn-pop-kind': { color: theme.palette.text.secondary, fontSize: '0.75rem', marginBottom: 4 },
        '.adn-pop-air': {
          color: theme.palette.error.main,
          fontWeight: 600,
          fontSize: '0.8rem',
          marginBottom: 4,
        },
        '.adn-pop-row': {
          display: 'flex',
          gap: 8,
          justifyContent: 'space-between',
          fontSize: '0.8rem',
        },
        '.adn-pop-row span': { color: theme.palette.text.secondary },
        '.adn-pop-link a': { color: theme.palette.primary.main, fontSize: '0.8rem' },
        '.leaflet-control-attribution.leaflet-control-attribution': {
          background: dark ? 'rgba(15,23,42,0.75)' : 'rgba(255,255,255,0.8)',
          color: theme.palette.text.secondary,
          fontSize: '0.65rem',
        },
        '.leaflet-control-attribution a': { color: theme.palette.primary.main },
        '.leaflet-bar.leaflet-bar a': {
          background: theme.palette.background.paper,
          color: theme.palette.text.primary,
          borderBottomColor: theme.palette.divider,
        },
        '.leaflet-bar.leaflet-bar a:hover': { background: theme.palette.action.hover },
      }}
    />
  );
}

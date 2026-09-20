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

import { useMemo, useState, lazy, Suspense } from 'react';
import { Routes, Route, Link, useNavigate, Navigate } from 'react-router-dom';
import {
  ThemeProvider,
  createTheme,
  CssBaseline,
  AppBar,
  Toolbar,
  Typography,
  IconButton,
  Button,
  Menu,
  MenuItem,
  Select,
  FormControl,
  SelectChangeEvent,
  Box,
  Container,
  CircularProgress,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import Brightness4Icon from '@mui/icons-material/Brightness4';
import Brightness7Icon from '@mui/icons-material/Brightness7';
import { useTranslation } from 'react-i18next';

import Footer from './components/Footer';
import NewsMarquee from './components/NewsMarquee';
import UiZoomControl from './components/UiZoomControl';
import { getUiZoom } from './utils/uiZoom';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Systems = lazy(() => import('./pages/Systems'));
const MapView = lazy(() => import('./pages/MapView'));
const OpenBridge = lazy(() => import('./pages/OpenBridge'));
const TopTg = lazy(() => import('./pages/TopTg'));
const LastHeardLog = lazy(() => import('./pages/LastHeardLog'));
const Console = lazy(() => import('./pages/Console'));
const Calc = lazy(() => import('./pages/Calc'));
const TgList = lazy(() => import('./pages/TgList'));
const WorldServersStatus = lazy(() => import('./pages/WorldServersStatus'));
const Login = lazy(() => import('./pages/Login'));
const SelfService = lazy(() => import('./pages/SelfService'));
const Help = lazy(() => import('./pages/Help'));
const RadioManual = lazy(() => import('./pages/RadioManual'));
import { useDashboardConfig } from './context/DashboardConfigContext';

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'pt', label: 'Português' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'it', label: 'Italiano' },
  { code: 'nl', label: 'Nederlands' },
  { code: 'ca', label: 'Català' },
  { code: 'bg', label: 'Български' },
  { code: 'zh', label: '中文' },
  { code: 'et', label: 'Eesti' },
  { code: 'el', label: 'Ελληνικά' },
  { code: 'pl', label: 'Polski' },
  { code: 'sr', label: 'Српски' },
  { code: 'th', label: 'ไทย' },
  { code: 'tr', label: 'Türkçe' },
  { code: 'uk', label: 'Українська' },
];

function App() {
  const { t, i18n } = useTranslation();
  const dashboard = useDashboardConfig();
  const navigate = useNavigate();
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('mode');
    return saved !== 'light';
  });
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [infoAnchor, setInfoAnchor] = useState<null | HTMLElement>(null);
  const [linksAnchor, setLinksAnchor] = useState<null | HTMLElement>(null);
  const [helpAnchor, setHelpAnchor] = useState<null | HTMLElement>(null);
  const [uiZoom, setUiZoom] = useState(() => getUiZoom());

  const theme = useMemo(
    () =>
      createTheme({
        palette: {
          mode: darkMode ? 'dark' : 'light',
          primary: {
            main: darkMode ? '#2dd4bf' : '#0d9488',
            light: darkMode ? '#5eead4' : '#14b8a6',
            dark: darkMode ? '#14b8a6' : '#0f766e',
          },
          secondary: {
            main: darkMode ? '#a78bfa' : '#7c3aed',
          },
          background: {
            default: darkMode ? '#0f172a' : '#f8fafc',
            paper: darkMode ? '#1e293b' : '#ffffff',
          },
        },
        typography: {
          fontFamily: '"Plus Jakarta Sans", "Source Sans 3", "Roboto", sans-serif',
          fontSize: 14,
          h6: { fontWeight: 600 },
          subtitle1: { fontWeight: 600 },
          subtitle2: { fontWeight: 600 },
        },
        shape: {
          borderRadius: 12,
        },
        components: {
          MuiButton: {
            styleOverrides: {
              root: {
                textTransform: 'none',
                borderRadius: 10,
                fontWeight: 600,
              },
            },
          },
          MuiPaper: {
            styleOverrides: {
              root: ({ theme }) => ({
                borderRadius: 12,
                backgroundImage: 'none',
                ...(theme.palette.mode === 'light' && {
                  border: '1px solid',
                  borderColor: theme.palette.divider,
                  boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
                }),
              }),
            },
          },
          MuiCard: {
            styleOverrides: {
              root: {
                borderRadius: 12,
              },
            },
          },
          MuiChip: {
            styleOverrides: {
              root: {
                overflow: 'visible',
                height: 'auto',
                minHeight: 32,
              },
              label: {
                overflow: 'visible',
                whiteSpace: 'normal',
                textOverflow: 'clip',
                wordBreak: 'break-word',
              },
            },
          },
          MuiAppBar: {
            styleOverrides: {
              root: {
                borderRadius: 0,
              },
            },
          },
          MuiTableRow: {
            styleOverrides: {
              root: {
                '&:last-child td': { borderBottom: 0 },
              },
            },
          },
          MuiTableCell: {
            styleOverrides: {
              root: {
                borderBottom: '1px solid',
                borderColor: 'divider',
              },
            },
          },
        },
      }),
    [darkMode]
  );

  const toggleTheme = () => {
    const next = !darkMode;
    setDarkMode(next);
    localStorage.setItem('mode', next ? 'dark' : 'light');
  };

  const handleLanguageChange = (e: SelectChangeEvent<string>) => {
    i18n.changeLanguage(e.target.value);
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          minHeight: '100%',
          height: '100%',
          ...(dashboard.background && {
            backgroundImage: 'url(/img/bk.jpg)',
            backgroundAttachment: 'fixed',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }),
        }}
      >
        <AppBar
          position="sticky"
          color="default"
          elevation={0}
          sx={{
            borderBottom: '1px solid',
            borderColor: 'divider',
            bgcolor: 'background.paper',
          }}
        >
          <Toolbar
            sx={{
              flexWrap: 'wrap',
              gap: 0.5,
              minHeight: { xs: 56, sm: 64 },
              py: 0.5,
              '@media (orientation: landscape) and (max-height: 500px)': {
                minHeight: 40,
                py: 0.25,
              },
            }}
          >
            <IconButton
              edge="start"
              color="inherit"
              sx={{ mr: 0.5, display: { md: 'none' } }}
              onClick={(e) => setAnchorEl(e.currentTarget)}
              aria-label={t('nav_menu', { defaultValue: 'Open menu' })}
            >
              <MenuIcon />
            </IconButton>
            <Box
              component={Link}
              to="/"
              sx={{
                display: 'flex',
                alignItems: 'center',
                flexGrow: 1,
                textDecoration: 'none',
                color: 'primary.main',
              }}
            >
              <Typography variant="h6" component="span" fontWeight={700} color="inherit">
                {dashboard.title}
              </Typography>
            </Box>

            <Box sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'center', gap: 0.25 }}>
              <Button color="inherit" component={Link} to="/" sx={{ fontWeight: 500 }}>
                {t('nav_dash', { defaultValue: 'Dashboard' })}
              </Button>
              <Button color="inherit" component={Link} to="/systems">
                {t('nav_lnksys', { defaultValue: 'Linked Systems' })}
              </Button>
              {dashboard.map.enabled && (
                <Button color="inherit" component={Link} to="/map">
                  {t('nav_map', { defaultValue: 'Map' })}
                </Button>
              )}
              <Button color="inherit" component={Link} to="/openbridge">
                {t('nav_opb', { defaultValue: 'OpenBridge' })}
              </Button>
              <Button color="inherit" component={Link} to="/toptg">
                {t('nav_tptg', { defaultValue: "Top TG's" })}
              </Button>
              {dashboard.selfService && (
                <Button color="inherit" component={Link} to="/self-service" onClick={() => navigate('/self-service')}>
                  {t('self_service', { defaultValue: 'Self-service' })}
                </Button>
              )}
              <Button
                color="inherit"
                component="a"
                href="https://selfcare.adn.systems/"
                target="_blank"
                rel="noopener noreferrer"
                sx={{ fontWeight: 500 }}
              >
                {t('selfcare', { defaultValue: 'SelfCare' })}
              </Button>
              <Button color="inherit" onClick={(e) => setInfoAnchor(e.currentTarget)}>
                {t('nav_info', { defaultValue: 'Info' })}
              </Button>
              <Button color="inherit" onClick={(e) => setHelpAnchor(e.currentTarget)}>
                {t('nav_help', { defaultValue: 'Help' })}
              </Button>
              {(dashboard.navLinks?.items?.length ?? 0) === 1 && (
                <Button
                  color="inherit"
                  component="a"
                  href={dashboard.navLinks!.items[0].url}
                  target="_blank"
                  rel="noopener noreferrer"
                  sx={{ fontWeight: 500 }}
                >
                  {dashboard.navLinks!.items[0].name}
                </Button>
              )}
              {(dashboard.navLinks?.items?.length ?? 0) > 1 && (
                <Button color="inherit" onClick={(e) => setLinksAnchor(e.currentTarget)}>
                  {t('nav_links', { defaultValue: dashboard.navLinks?.name || 'Links' })}
                </Button>
              )}
            </Box>

            <FormControl size="small" sx={{ minWidth: 120, mx: 0.5, display: { xs: 'none', md: 'block' } }}>
              <Select
                value={LANGUAGES.find((l) => l.code === i18n.language || l.code === i18n.language?.split(/[-_]/)[0])?.code ?? 'en'}
                onChange={handleLanguageChange}
                variant="outlined"
                sx={{
                  height: 36,
                  fontSize: '0.875rem',
                  borderRadius: 2,
                  '& .MuiOutlinedInput-notchedOutline': { borderColor: 'divider' },
                }}
              >
                {LANGUAGES.map(({ code, label }) => (
                  <MenuItem key={code} value={code}>
                    {label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <UiZoomControl zoom={uiZoom} onZoomChange={setUiZoom} />
            <IconButton onClick={toggleTheme} color="inherit" aria-label={darkMode ? 'Light mode' : 'Dark mode'}>
              {darkMode ? <Brightness7Icon /> : <Brightness4Icon />}
            </IconButton>
          </Toolbar>
        </AppBar>

        <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}>
          <MenuItem component={Link} to="/" onClick={() => setAnchorEl(null)}>
            {t('nav_dash')}
          </MenuItem>
          <MenuItem component={Link} to="/systems" onClick={() => setAnchorEl(null)}>
            {t('nav_lnksys')}
          </MenuItem>
          {dashboard.map.enabled && (
            <MenuItem component={Link} to="/map" onClick={() => setAnchorEl(null)}>
              {t('nav_map', { defaultValue: 'Map' })}
            </MenuItem>
          )}
          <MenuItem component={Link} to="/openbridge" onClick={() => setAnchorEl(null)}>
            {t('nav_opb')}
          </MenuItem>
          <MenuItem component={Link} to="/toptg" onClick={() => setAnchorEl(null)}>
            {t('nav_tptg')}
          </MenuItem>
          {dashboard.selfService && (
            <MenuItem component={Link} to="/self-service" onClick={() => setAnchorEl(null)}>
              {t('self_service', { defaultValue: 'Self-service' })}
            </MenuItem>
          )}
          <MenuItem
            component="a"
            href="https://selfcare.adn.systems/"
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setAnchorEl(null)}
          >
            {t('selfcare', { defaultValue: 'SelfCare' })}
          </MenuItem>
          <MenuItem component={Link} to="/help" onClick={() => setAnchorEl(null)}>
            {t('nav_help_faq', { defaultValue: 'FAQ' })}
          </MenuItem>
          <MenuItem component={Link} to="/manual" onClick={() => setAnchorEl(null)}>
            {t('nav_help_manual', { defaultValue: 'Manual' })}
          </MenuItem>
          {dashboard.showConsole && (
            <MenuItem component={Link} to="/console" onClick={() => setAnchorEl(null)}>
              {t('nav_console')}
            </MenuItem>
          )}
          <MenuItem component={Link} to="/lastheard" onClick={() => setAnchorEl(null)}>
            {t('nav_lsthrd')}
          </MenuItem>
          <MenuItem component={Link} to="/calc" onClick={() => setAnchorEl(null)}>
            {t('nav_calc')}
          </MenuItem>
          <MenuItem component={Link} to="/wwtg" onClick={() => setAnchorEl(null)}>
            {t('nav_tglst')}
          </MenuItem>
          <MenuItem component={Link} to="/serverstatus" onClick={() => setAnchorEl(null)}>
            {t('nav_serverstatus')}
          </MenuItem>
          {(dashboard.navLinks?.items?.length ?? 0) === 1 && (
            <MenuItem
              component="a"
              href={dashboard.navLinks!.items[0].url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setAnchorEl(null)}
            >
              {dashboard.navLinks!.items[0].name}
            </MenuItem>
          )}
          {(dashboard.navLinks?.items?.length ?? 0) > 1 && (
            <>
              <MenuItem disabled sx={{ borderTop: 1, borderColor: 'divider', mt: 0.5, pt: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  {t('nav_links', { defaultValue: dashboard.navLinks?.name || 'Links' })}
                </Typography>
              </MenuItem>
              {dashboard.navLinks!.items.map((item, idx) => (
                <MenuItem
                  key={idx}
                  component="a"
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setAnchorEl(null)}
                >
                  {item.name}
                </MenuItem>
              ))}
            </>
          )}
          <MenuItem disabled sx={{ borderTop: 1, borderColor: 'divider', mt: 0.5, pt: 1 }}>
            <Typography variant="caption" color="text.secondary">
              {t('nav_language', { defaultValue: 'Language' })}
            </Typography>
          </MenuItem>
          {LANGUAGES.map(({ code, label }) => (
            <MenuItem
              key={code}
              onClick={() => {
                i18n.changeLanguage(code);
                setAnchorEl(null);
              }}
            >
              {label}
            </MenuItem>
          ))}
        </Menu>

        <Menu anchorEl={infoAnchor} open={Boolean(infoAnchor)} onClose={() => setInfoAnchor(null)}>
          {dashboard.showConsole && (
            <MenuItem component={Link} to="/console" onClick={() => setInfoAnchor(null)}>
              {t('nav_console')}
            </MenuItem>
          )}
          <MenuItem component={Link} to="/calc" onClick={() => setInfoAnchor(null)}>
            {t('nav_calc')}
          </MenuItem>
          <MenuItem component={Link} to="/wwtg" onClick={() => setInfoAnchor(null)}>
            {t('nav_tglst')}
          </MenuItem>
          <MenuItem component={Link} to="/serverstatus" onClick={() => setInfoAnchor(null)}>
            {t('nav_serverstatus')}
          </MenuItem>
          <MenuItem component={Link} to="/lastheard" onClick={() => setInfoAnchor(null)}>
            {t('nav_lsthrd')}
          </MenuItem>
        </Menu>

        <Menu anchorEl={linksAnchor} open={Boolean(linksAnchor)} onClose={() => setLinksAnchor(null)}>
          {(dashboard.navLinks?.items ?? []).map((item, idx) => (
            <MenuItem
              key={idx}
              component="a"
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setLinksAnchor(null)}
            >
              {item.name}
            </MenuItem>
          ))}
        </Menu>

        <Menu anchorEl={helpAnchor} open={Boolean(helpAnchor)} onClose={() => setHelpAnchor(null)}>
          <MenuItem component={Link} to="/help" onClick={() => setHelpAnchor(null)}>
            {t('nav_help_faq', { defaultValue: 'FAQ' })}
          </MenuItem>
          <MenuItem component={Link} to="/manual" onClick={() => setHelpAnchor(null)}>
            {t('nav_help_manual', { defaultValue: 'Manual' })}
          </MenuItem>
        </Menu>

        <Box
          component="main"
          sx={{
            flex: 1,
            minHeight: 0,
            overflowX: 'hidden',
            overflowY: 'scroll',
            WebkitOverflowScrolling: 'touch',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Logo scrolls with content on all viewports */}
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              py: { xs: 1.5, sm: 2 },
              px: 2,
              bgcolor: 'transparent',
              flexShrink: 0,
              '@media (orientation: landscape) and (max-height: 500px)': {
                py: 0.5,
              },
            }}
          >
            <Container maxWidth="xl" sx={{ display: 'flex', justifyContent: 'center' }}>
              <Box
                component="img"
                src="/img/logo.png"
                alt=""
                sx={{
                  width: '100%',
                  maxWidth: { xs: 200, sm: 320, md: '100%' },
                  height: 'auto',
                  objectFit: 'contain',
                  display: 'block',
                  borderRadius: 2,
                  '@media (orientation: landscape) and (max-height: 500px)': {
                    maxWidth: 160,
                    maxHeight: '10vh',
                  },
                }}
              />
            </Container>
          </Box>
          <Container
            sx={{
              flex: 1,
              py: 3,
              px: { xs: 1.5, sm: 2, md: 3 },
              '@media (orientation: landscape) and (max-height: 500px)': {
                py: 1,
              },
            }}
            maxWidth="xl"
          >
            <NewsMarquee />
            <Suspense fallback={<Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>}>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/systems" element={<Systems />} />
                <Route path="/map" element={<MapView />} />
                <Route path="/systemstg" element={<Navigate to="/systems" replace />} />
                <Route path="/openbridge" element={<OpenBridge />} />
                <Route path="/toptg" element={<TopTg />} />
                <Route path="/lastheard" element={<LastHeardLog />} />
                <Route path="/console" element={<Console />} />
                <Route path="/calc" element={<Calc />} />
                <Route path="/wwtg" element={<TgList />} />
                <Route path="/serverstatus" element={<WorldServersStatus />} />
                <Route path="/wwbridges" element={<Navigate to="/serverstatus" replace />} />
                <Route path="/login" element={<Login />} />
                <Route path="/self-service" element={<SelfService />} />
                <Route path="/help" element={<Help />} />
                <Route path="/manual" element={<RadioManual />} />
              </Routes>
            </Suspense>
          </Container>
          <Footer />
        </Box>
      </Box>
    </ThemeProvider>
  );
}

export default App;

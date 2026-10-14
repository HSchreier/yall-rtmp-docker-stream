import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CssBaseline, ThemeProvider, createTheme } from '@mui/material';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';
import { NotificationSnackbar } from './components/NotificationSnackbar';
import { useAuthStore } from './store/auth.store';
import './i18n/config';

const darkTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#F62902',
      light: '#FB7A5E',
      dark: '#C71F00',
    },
    background: {
      default: '#0A0B0D',
      paper: '#101217',
    },
    divider: '#272B33',
    text: {
      primary: '#E7EAEE',
      secondary: '#9CA3AE',
      disabled: '#6B727D',
    },
    success: {
      main: '#46A06A',
    },
    error: {
      main: '#C95A52',
    },
  },
  typography: {
    fontFamily: [
      '-apple-system',
      'BlinkMacSystemFont',
      '"Segoe UI"',
      'Roboto',
      '"Helvetica Neue"',
      'Arial',
      'sans-serif',
    ].join(','),
  },
});

export function App() {
  const { i18n } = useTranslation();
  const [isHydrated, setIsHydrated] = useState(false);
  const { token } = useAuthStore();

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  if (!isHydrated) {
    return null;
  }

  return (
    <ThemeProvider theme={darkTheme}>
      <CssBaseline />
      <NotificationSnackbar />
      {token ? <Dashboard /> : <Login />}
    </ThemeProvider>
  );
}

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Button,
  Container,
  TextField,
  Typography,
  Alert,
  Paper,
} from '@mui/material';
import { useAuthStore } from '../store/auth.store';

export function Login() {
  const { t } = useTranslation();
  const { setToken, setError, setLoading, error, isLoading } = useAuthStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const data = (await response.json()) as Record<string, unknown>;
        const errorMsg = (data.error as Record<string, string>)?.message || t('auth.loginError');
        throw new Error(errorMsg);
      }

      const data = (await response.json()) as { token: string; role?: string };
      const userResponse = await fetch('/api/users/me', {
        headers: { Authorization: `Bearer ${data.token}` },
      });
      const user = (await userResponse.json()) as { userId: string };

      setToken(data.token, user.userId, data.role as 'admin' | 'user' || 'user', email);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.loginError'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container maxWidth="sm" sx={{ py: 8 }}>
      <Paper elevation={0} sx={{ p: 4, background: '#101217', border: '1px solid #272B33' }}>
        <Typography variant="h4" component="h1" sx={{ mb: 2, color: '#F62902' }}>
          {t('common.appName')}
        </Typography>

        <Typography variant="h5" component="h2" sx={{ mb: 1 }}>
          {t('auth.loginTitle')}
        </Typography>

        <Typography variant="body2" color="textSecondary" sx={{ mb: 3 }}>
          {t('auth.loginDescription')}
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <Box component="form" onSubmit={handleLogin} noValidate sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
            label={t('auth.email')}
            type="email"
            value={email}
            onChange={(e) => setEmail((e.target as HTMLInputElement).value)}
            fullWidth
            required
            disabled={isLoading}
          />

          <TextField
            label={t('auth.password')}
            type="password"
            value={password}
            onChange={(e) => setPassword((e.target as HTMLInputElement).value)}
            fullWidth
            required
            disabled={isLoading}
          />

          <Button
            type="submit"
            variant="contained"
            size="large"
            disabled={isLoading || !email || !password}
            sx={{ mt: 2 }}
          >
            {isLoading ? 'Logging in...' : t('common.login')}
          </Button>
        </Box>
      </Paper>
    </Container>
  );
}

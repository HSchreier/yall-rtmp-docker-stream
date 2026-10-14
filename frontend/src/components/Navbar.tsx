import { AppBar, Toolbar, Typography, Button, Box, Select, MenuItem } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../store/auth.store';

export function Navbar() {
  const { t, i18n } = useTranslation();
  const { email, clearToken } = useAuthStore();

  const currentLang = i18n.language.split('-')[0]; // Handle en-GB → en

  return (
    <AppBar position="static" sx={{ background: '#101217', borderBottom: '1px solid #272B33' }}>
      <Toolbar>
        <Typography variant="h6" sx={{ flex: 1, color: '#F62902', fontWeight: 700 }}>
          {t('common.appName')}
        </Typography>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Select
            value={currentLang}
            onChange={(e) => i18n.changeLanguage(e.target.value)}
            sx={{ width: 100, height: 40 }}
          >
            <MenuItem value="en">English</MenuItem>
            <MenuItem value="es">Español</MenuItem>
          </Select>

          <Typography variant="body2" sx={{ color: '#9CA3AE' }}>
            {email}
          </Typography>

          <Button
            variant="outlined"
            size="small"
            onClick={clearToken}
            sx={{ borderColor: '#272B33', color: '#E7EAEE' }}
          >
            {t('common.logout')}
          </Button>
        </Box>
      </Toolbar>
    </AppBar>
  );
}

import { useTranslation } from 'react-i18next';
import { Box, Button, Container, Typography } from '@mui/material';
import { useAuthStore } from '../store/auth.store';

export function Dashboard() {
  const { t } = useTranslation();
  const { clearToken, email } = useAuthStore();

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
        <Typography variant="h4">{t('dashboard.streamingStatus')}</Typography>
        <Box>
          <Typography variant="body2" sx={{ mr: 2 }}>
            {email}
          </Typography>
          <Button variant="outlined" onClick={clearToken} size="small">
            {t('common.logout')}
          </Button>
        </Box>
      </Box>

      <Typography variant="body1" color="textSecondary">
        Dashboard coming soon...
      </Typography>
    </Container>
  );
}

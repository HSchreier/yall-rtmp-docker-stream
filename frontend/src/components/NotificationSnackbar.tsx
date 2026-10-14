import { useEffect, useState } from 'react';
import { Snackbar, Alert } from '@mui/material';
import { eventBus } from '../infra/event-bus';

type AlertSeverity = 'success' | 'info' | 'warning' | 'error';

export function NotificationSnackbar() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [severity, setSeverity] = useState<AlertSeverity>('info');

  useEffect(() => {
    const unsubscribe = eventBus.on('notification:show', ({ message, type }) => {
      setMessage(message);
      setSeverity(type as AlertSeverity);
      setOpen(true);
    });

    return unsubscribe;
  }, []);

  return (
    <Snackbar
      open={open}
      autoHideDuration={4000}
      onClose={() => setOpen(false)}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
    >
      <Alert onClose={() => setOpen(false)} severity={severity} sx={{ width: '100%' }}>
        {message}
      </Alert>
    </Snackbar>
  );
}

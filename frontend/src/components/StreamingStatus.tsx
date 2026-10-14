import { useEffect, useState } from 'react';
import { Box, Typography, Button } from '@mui/material';
import { useTranslation } from 'react-i18next';

export function StreamingStatus() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<'offline' | 'live' | 'idle'>('offline');
  const [startTime, setStartTime] = useState<Date | null>(null);
  const [elapsed, setElapsed] = useState('00:00:00');

  // Poll health endpoint
  useEffect(() => {
    const checkStatus = async () => {
      try {
        const res = await fetch('/api/health');
        const data = (await res.json()) as Record<string, unknown>;
        const ingestStatus = data.ingestStatus as 'offline' | 'live' | 'idle' || 'offline';
        setStatus(ingestStatus);

        if (ingestStatus === 'live' && !startTime) {
          setStartTime(new Date());
        } else if (ingestStatus !== 'live') {
          setStartTime(null);
        }
      } catch (err) {
        console.error('Failed to check stream status:', err);
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, 2000);
    return () => clearInterval(interval);
  }, [startTime]);

  // Update timer
  useEffect(() => {
    if (!startTime) {
      setElapsed('00:00:00');
      return;
    }

    const updateTimer = () => {
      const now = new Date().getTime();
      const start = startTime.getTime();
      const ms = now - start;

      const hours = Math.floor(ms / (60 * 60 * 1000));
      const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
      const seconds = Math.floor((ms % (60 * 1000)) / 1000);

      setElapsed(
        `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
      );
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [startTime]);

  const isLive = status === 'live';
  const isDot = isLive ? '🔴' : '🟢';
  const label = isLive ? t('dashboard.currentlyStreaming') : t('dashboard.readyToStream');

  return (
    <Box sx={{ p: 3, background: '#101217', border: '1px solid #272B33', borderRadius: 1 }}>
      <Typography variant="h6" sx={{ mb: 2, color: '#9CA3AE' }}>
        {t('dashboard.streamingStatus')}
      </Typography>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
        <Typography variant="h2">{isDot}</Typography>
        <Box>
          <Typography variant="body1" sx={{ color: isLive ? '#F62902' : '#46A06A' }}>
            {label}
          </Typography>
          {isLive && (
            <Typography variant="h4" sx={{ fontFamily: '"JetBrains Mono", monospace', color: '#E7EAEE' }}>
              {elapsed}
            </Typography>
          )}
        </Box>
      </Box>

      {isLive && (
        <Button variant="contained" color="error" fullWidth>
          {t('dashboard.stopStreaming')}
        </Button>
      )}
    </Box>
  );
}

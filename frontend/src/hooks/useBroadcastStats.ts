import { useEffect } from 'react';
import { useStatsStore } from '../stores/stats.store';
import { useSlotStore } from '../stores/slot.store';
import { httpClient } from '../infra/http';
import type { Destination } from '../types/broadcaster';

export function useBroadcastStats() {
  const { setInputKbps, setAudioKbps, setVideoKbps, setFormat, setDestinations, setSentKbps, setRelayRunning, addBitrateBar } = useStatsStore();
  const { updateStatusBand } = useSlotStore();

  useEffect(() => {
    let eventSource: EventSource | null = null;

    const fetchInitialStats = async () => {
      try {
        const response = await httpClient.get('/api/broadcast/stats');
        const data = response.data as Record<string, unknown>;

        if (data.inputKbps) setInputKbps(Number(data.inputKbps));
        if (data.audioKbps) setAudioKbps(Number(data.audioKbps));
        if (data.videoKbps) setVideoKbps(Number(data.videoKbps));
        if (data.format) setFormat(String(data.format));
        if (data.sentKbps) setSentKbps(Number(data.sentKbps));
        if (data.destinations) setDestinations(data.destinations as Destination[]);
      } catch {
        // Stats not available yet
      }
    };

    const subscribeToStats = () => {
      // Get the auth token to pass in SSE URL
      const token = localStorage.getItem('auth-token');
      if (!token) return;

      const apiBase = (import.meta.env as Record<string, unknown>).VITE_API_BASE_URL as string | undefined;
      const streamUrl = apiBase
        ? `${apiBase}/api/broadcast/stream?token=${encodeURIComponent(token)}`
        : `/api/broadcast/stream?token=${encodeURIComponent(token)}`;

      eventSource = new EventSource(streamUrl);

      eventSource.addEventListener('message', (event) => {
        try {
          const data = JSON.parse(event.data) as Record<string, unknown>;

          if (data.type === 'stat-update') {
            if (data.inputKbps) setInputKbps(Number(data.inputKbps));
            if (data.audioKbps) setAudioKbps(Number(data.audioKbps));
            if (data.videoKbps) setVideoKbps(Number(data.videoKbps));
            if (data.format) setFormat(String(data.format));
            if (data.sentKbps) setSentKbps(Number(data.sentKbps));
            if (data.relayRunning !== undefined) setRelayRunning(Boolean(data.relayRunning));

            if (data.destinations) setDestinations(data.destinations as Destination[]);

            if (data.bitrate) {
              addBitrateBar({ timestamp: Date.now(), kbps: Number(data.bitrate) });
            }
          }
        } catch {
          // Ignore parse errors
        }
      });

      eventSource.addEventListener('error', () => {
        eventSource?.close();
        eventSource = null;
      });
    };

    fetchInitialStats();
    subscribeToStats();

    return () => {
      eventSource?.close();
    };
  }, [setInputKbps, setAudioKbps, setVideoKbps, setFormat, setDestinations, setSentKbps, setRelayRunning, addBitrateBar, updateStatusBand]);
}

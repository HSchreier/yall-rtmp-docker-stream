import { create } from "zustand";
import type { BitrateBar, Destination, StatsTile } from "../types/broadcaster";

interface StatsStore {
  inputKbps: number;
  audioKbps: number;
  videoKbps: number;
  format: string;
  destinations: Destination[];
  sentKbps: number;
  relayRunning: boolean;

  // Bitrate history (last 60 bars)
  bitrateBars: BitrateBar[];

  // Actions
  setInputKbps: (kbps: number) => void;
  setAudioKbps: (kbps: number) => void;
  setVideoKbps: (kbps: number) => void;
  setFormat: (format: string) => void;
  setDestinations: (destinations: Destination[]) => void;
  setSentKbps: (kbps: number) => void;
  setRelayRunning: (running: boolean) => void;
  addBitrateBar: (bar: BitrateBar) => void;

  // Computed stats
  getStatsTiles: () => StatsTile[];
}

export const useStatsStore = create<StatsStore>((set, get) => ({
  inputKbps: 0,
  audioKbps: 0,
  videoKbps: 0,
  format: "—",
  destinations: [
    { name: "YouTube", enabled: false, status: "Off", kbps: 0 },
    { name: "Twitch", enabled: false, status: "Off", kbps: 0 },
    { name: "Mixcloud", enabled: false, status: "Off", kbps: 0 },
  ],
  sentKbps: 0,
  relayRunning: false,
  bitrateBars: [],

  setInputKbps: (kbps) => set({ inputKbps: kbps }),
  setAudioKbps: (kbps) => set({ audioKbps: kbps }),
  setVideoKbps: (kbps) => set({ videoKbps: kbps }),
  setFormat: (format) => set({ format }),
  setDestinations: (destinations) => set({ destinations }),
  setSentKbps: (kbps) => set({ sentKbps: kbps }),
  setRelayRunning: (running) => set({ relayRunning: running }),

  addBitrateBar: (bar) => {
    set((state) => {
      const bars = [...state.bitrateBars, bar];
      // Keep only last 60 bars
      if (bars.length > 60) {
        bars.shift();
      }
      return { bitrateBars: bars };
    });
  },

  getStatsTiles: () => {
    const state = get();
    return [
      { label: "Input", value: String(state.inputKbps), unit: "kbps" },
      { label: "Audio", value: String(state.audioKbps), unit: "kbps" },
      { label: "Video", value: String(state.videoKbps), unit: "kbps" },
      { label: "Format", value: state.format },
      { label: "Sent", value: String(state.sentKbps), unit: "kbps" },
    ];
  },
}));

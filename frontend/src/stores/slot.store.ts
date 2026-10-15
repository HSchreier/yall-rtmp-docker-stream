import { create } from "zustand";
import type { SlotStatus } from "../types/slot";

interface SlotStore {
  activeEmail: string | null;
  myStatus: SlotStatus;
  statusBand: {
    label: string;
    actionLabel: string;
    timer: string;
    isActive: boolean;
  };

  // Actions
  setActiveEmail: (email: string | null) => void;
  setMyStatus: (status: SlotStatus) => void;
  updateStatusBand: (band: {
    label: string;
    actionLabel: string;
    timer: string;
    isActive: boolean;
  }) => void;
}

export const useSlotStore = create<SlotStore>((set) => ({
  activeEmail: null,
  myStatus: "relay-stopped",
  statusBand: {
    label: "Relay Stopped",
    actionLabel: "Start relay",
    timer: "—",
    isActive: false,
  },

  setActiveEmail: (email) => set({ activeEmail: email }),

  setMyStatus: (status) => set({ myStatus: status }),

  updateStatusBand: (band) => set({ statusBand: band }),
}));

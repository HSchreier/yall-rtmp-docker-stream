export type SlotStatus = "relay-stopped" | "free" | "waiting" | "live" | "taken";

export interface SlotState {
  activeEmail: string | null;
  myStatus: SlotStatus;
  statusBand: {
    label: string;
    actionLabel: string;
    timer: string;
    isActive: boolean;
  };
}

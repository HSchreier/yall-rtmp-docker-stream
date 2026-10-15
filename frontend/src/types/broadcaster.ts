export interface StatsTile {
  label: string;
  value: string;
  unit?: string;
}

export interface Destination {
  name: "YouTube" | "Twitch" | "Mixcloud";
  enabled: boolean;
  status: "Off" | "Standby" | "Sending" | "KeyRejected";
  kbps: number;
}

export interface Session {
  id: string;
  started: Date;
  duration: number; // ms
  destinations: Destination[];
  avgInputKbps: number;
  sentKbps: number;
}

export interface User {
  id: string;
  email: string;
  role: "admin" | "user";
  profileStatus: "inactive" | "active";
}

export interface BitrateBar {
  timestamp: number;
  kbps: number;
}

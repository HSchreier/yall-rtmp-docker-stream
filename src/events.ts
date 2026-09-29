// Event taxonomy — docs/TECHNICAL.md §Sidecar software design, "Event taxonomy".
// Typed objects per domain, not bare strings with loose payloads: the payload
// shape is part of the event's identity, enforced here at the type level.

export type Destination = "mixcloud" | "youtube" | "twitch";
export type Role = "user" | "admin";
export type IngestStatus = "offline" | "live" | "idle";

// User events
export interface UserLoggedIn {
  userId: string;
  at: Date;
}
export interface UserLoggedOut {
  userId: string;
  at: Date;
}
export interface UserRegistered {
  userId: string;
  email: string;
  role: Role;
  registeredBy: string | null;
  at: Date;
}
export interface DestinationCredentialsUpdated {
  userId: string;
  destination: Destination;
  at: Date;
}
export interface ActiveProfileChanged {
  userId: string;
  activatedBy: string;
  at: Date;
}

// Client events — RTMP connection lifecycle below the level of an authorized publish
export interface IngestClientConnected {
  address: string;
  at: Date;
}
export interface IngestClientDisconnected {
  address: string;
  at: Date;
}

// Stream events
export interface StreamStarted {
  streamKey: string;
  at: Date;
  // Sourcing unverified — docs/TECHNICAL.md open questions. May not be
  // populated until confirmed against a real nginx-rtmp build.
  dataType?: { video?: string; audio?: string };
  chunkSize?: number;
}
export interface StreamEnded {
  streamKey: string;
  at: Date;
  durationMs: number;
  totalBytesIn: number;
}
export interface StreamIdle {
  streamKey: string;
  since: Date;
  at: Date;
}
export interface StreamResumed {
  streamKey: string;
  at: Date;
}

// Stat events — owned by a per-broadcast submodule, not a global poller
export interface StreamStatUpdated {
  streamKey: string;
  bytesIn: number;
  bitrateKbps: number;
  at: Date;
}

// Log events — cross-cutting, wraps any event above for audit/observability
export interface LogEvent {
  source: string;
  payload: unknown;
  at: Date;
}

// Process/infra — not a domain of their own, but on the same bus
export interface NginxStarted {
  at: Date;
}
export interface NginxExited {
  code: number | null;
  at: Date;
}
export interface NginxCrashed {
  error: string;
  at: Date;
}

/** The full map of event name -> payload type. EventBus is generic over this. */
export interface EventMap {
  UserLoggedIn: UserLoggedIn;
  UserLoggedOut: UserLoggedOut;
  UserRegistered: UserRegistered;
  DestinationCredentialsUpdated: DestinationCredentialsUpdated;
  ActiveProfileChanged: ActiveProfileChanged;
  IngestClientConnected: IngestClientConnected;
  IngestClientDisconnected: IngestClientDisconnected;
  StreamStarted: StreamStarted;
  StreamEnded: StreamEnded;
  StreamIdle: StreamIdle;
  StreamResumed: StreamResumed;
  StreamStatUpdated: StreamStatUpdated;
  LogEvent: LogEvent;
  "nginx.started": NginxStarted;
  "nginx.exited": NginxExited;
  "nginx.crashed": NginxCrashed;
}

// BroadcastService — owns the slot-based broadcast session state machine.
// Manages: go-live transitions, set/session ending, active slot tracking,
// one-broadcaster-at-a-time invariant, and in-memory session history.
//
// State machine:
//   relay-stopped | free → waiting (admin waiting to go-live)
//                       → live (broadcast active)
//                       → taken (other broadcaster active)
// Only one email can be active/live at a time. Admin can kick any session.

import { ForbiddenError, ValidationError } from "../../infra/errors.ts";
import type { EventBus } from "../../infra/event-bus.ts";
import type { Logger } from "../../infra/logger.ts";
import type { RelayStateRepository } from "../relay/relay.repository.ts";
import type { UserRepository } from "../users/users.repository.ts";

export interface SessionHistoryEntry {
  email: string;
  date: string;
  duration: string;
  destinations: string[];
  avgInput: number;
  sent: number;
}

export interface BroadcastStats {
  inputKbps: number;
  audioKbps: number;
  videoKbps: number;
  format: string;
  destinations: string[];
  sentKbps: number;
  relayRunning: boolean;
}

export interface GoLiveResponse {
  success: boolean;
  slotExpiry: Date;
  activeEmail: string;
  myStatus: "waiting" | "live" | "taken";
}

export interface EndSetResponse {
  success: boolean;
  sessionHistory: SessionHistoryEntry[];
}

export interface SlotState {
  activeEmail: string | null;
  myStatus: "relay-stopped" | "free" | "waiting" | "live" | "taken";
  slotExpiry: Date | null;
}

export class BroadcastService {
  private activeEmail: string | null = null;
  private sessionStartTime: Date | null = null;
  private slotExpiry: Date | null = null;
  private sessionHistory: SessionHistoryEntry[] = [];
  private relayRunning = false;

  constructor(
    private readonly users: UserRepository,
    private readonly relayState: RelayStateRepository,
    private readonly eventBus: EventBus,
    private readonly logger: Logger,
  ) {
    // Listen for relay events to track state
    this.eventBus.on("StreamStarted", () => {
      this.relayRunning = true;
    });

    this.eventBus.on("StreamEnded", () => {
      this.relayRunning = false;
    });

    // Clean up on active profile changes (slot taken by someone else)
    this.eventBus.on("ActiveProfileChanged", (payload) => {
      if (this.activeEmail && payload.userId !== this.activeEmail) {
        this.activeEmail = payload.userId;
        this.sessionStartTime = new Date();
      }
    });
  }

  async getSlotState(userId: string): Promise<SlotState> {
    const user = await this.users.findById(userId);
    if (!user) {
      throw new ValidationError("User not found");
    }

    const relayState = await this.relayState.getActiveUserId();

    return {
      activeEmail: this.activeEmail || relayState,
      myStatus: this.computeMyStatus(userId, relayState),
      slotExpiry: this.slotExpiry,
    };
  }

  private computeMyStatus(
    userId: string,
    relayState: string | null,
  ): "relay-stopped" | "free" | "waiting" | "live" | "taken" {
    if (!this.relayRunning) {
      return "relay-stopped";
    }
    if (!relayState) {
      return "free";
    }
    if (relayState === userId) {
      return "live";
    }
    return "taken";
  }

  async goLive(userId: string, userEmail: string): Promise<GoLiveResponse> {
    const relayState = await this.relayState.getActiveUserId();

    // Only one active at a time
    if (relayState && relayState !== userId) {
      return {
        success: false,
        slotExpiry: new Date(),
        activeEmail: relayState,
        myStatus: "taken",
      };
    }

    // Activate this user
    await this.relayState.setActive(userId, userId);

    // Update internal slot state
    this.activeEmail = userId;
    this.sessionStartTime = new Date();
    const expiryTime = new Date();
    expiryTime.setHours(expiryTime.getHours() + 4); // 4-hour slot by default
    this.slotExpiry = expiryTime;

    this.logger.info({ userId, email: userEmail, expiryTime }, "Broadcast: go-live");

    this.eventBus.emit("BroadcastStarted", {
      userId,
      email: userEmail,
      at: new Date(),
    });

    return {
      success: true,
      slotExpiry: expiryTime,
      activeEmail: userId,
      myStatus: "live",
    };
  }

  async endSet(userId: string): Promise<EndSetResponse> {
    if (this.activeEmail !== userId) {
      throw new ForbiddenError("Only the active broadcaster can end their set");
    }

    // Record the session
    const duration = this.sessionStartTime
      ? Math.round((Date.now() - this.sessionStartTime.getTime()) / 1000)
      : 0;

    const historyEntry: SessionHistoryEntry = {
      email: this.activeEmail,
      date: new Date().toISOString(),
      duration: `${Math.floor(duration / 60)}m ${duration % 60}s`,
      destinations: ["YouTube", "Twitch", "Mixcloud"], // mock
      avgInput: 5000, // mock: 5 Mbps
      sent: 2500, // mock: 2.5 Mbps
    };

    this.sessionHistory.push(historyEntry);
    this.activeEmail = null;
    this.sessionStartTime = null;
    this.slotExpiry = null;

    this.logger.info({ userId, duration }, "Broadcast: end-set");

    this.eventBus.emit("BroadcastEnded", {
      userId,
      at: new Date(),
      durationSeconds: duration,
    });

    return {
      success: true,
      sessionHistory: this.sessionHistory,
    };
  }

  async endSessionAdmin(email: string, adminId: string): Promise<{ success: boolean }> {
    // Admin can kick any session
    const user = await this.users.findByEmail(email);
    if (!user) {
      throw new ValidationError("User with that email not found");
    }

    if (this.activeEmail === user.userId) {
      this.activeEmail = null;
      this.sessionStartTime = null;
      this.slotExpiry = null;

      this.logger.info(
        { userId: user.userId, email, kickedBy: adminId },
        "Broadcast: end-session (admin kick)",
      );

      this.eventBus.emit("BroadcastKicked", {
        userId: user.userId,
        email,
        kickedBy: adminId,
        at: new Date(),
      });
    }

    return { success: true };
  }

  async getStats(): Promise<BroadcastStats> {
    // Mock stats — would be read from nginx-rtmp /stat in production
    return {
      inputKbps: 5000,
      audioKbps: 128,
      videoKbps: 4872,
      format: "h264+aac",
      destinations: ["YouTube", "Twitch", "Mixcloud"],
      sentKbps: 2500,
      relayRunning: this.relayRunning,
    };
  }

  async getHistory(userEmail: string, limit: number = 50): Promise<SessionHistoryEntry[]> {
    // Filter by email if provided, return limited results
    return this.sessionHistory.filter((h) => h.email === userEmail || !userEmail).slice(-limit);
  }

  getSessionHistory(): SessionHistoryEntry[] {
    return this.sessionHistory;
  }
}

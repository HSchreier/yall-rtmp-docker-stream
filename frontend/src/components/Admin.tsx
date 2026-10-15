import { useState } from "react";
import type { User } from "../types/broadcaster";

// Mock data
const mockUsers: User[] = [
  { id: "1", email: "alice@example.com", role: "user", profileStatus: "active" },
  { id: "2", email: "bob@example.com", role: "user", profileStatus: "inactive" },
  { id: "3", email: "carol@example.com", role: "admin", profileStatus: "active" },
];

const mockActiveUser = { email: "alice@example.com", since: new Date("2026-10-15T20:00:00") };

export function Admin() {
  const [users, setUsers] = useState<User[]>(mockUsers);
  const [newUserEmail, setNewUserEmail] = useState("");
  const [relayRunning, setRelayRunning] = useState(false);

  const handleAddUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserEmail) return;

    const newUser: User = {
      id: String(users.length + 1),
      email: newUserEmail,
      role: "user",
      profileStatus: "inactive",
    };

    setUsers([...users, newUser]);
    setNewUserEmail("");
  };

  const handleActivateUser = (id: string) => {
    setUsers(users.map((u) => (u.id === id ? { ...u, profileStatus: "active" } : u)));
  };

  const formatTime = (date: Date) =>
    date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

  return (
    <div
      style={{
        padding: "var(--space-6)",
        minHeight: "calc(100vh - 60px)",
        backgroundColor: "var(--color-bg)",
      }}
    >
      <h2 style={{ marginTop: 0, marginBottom: "var(--space-6)" }}>Admin</h2>

      {/* Relay Card */}
      <div className="card" style={{ marginBottom: "var(--space-6)", maxWidth: "400px" }}>
        <h3 style={{ marginTop: 0, fontSize: "17px" }}>Relay Control</h3>
        <p style={{ margin: "0 0 var(--space-4)", opacity: 0.8, fontSize: "14px" }}>
          {relayRunning ? "Relay is active and accepting streams" : "Relay is stopped"}
        </p>
        <div style={{ display: "flex", gap: "var(--space-2)" }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setRelayRunning(true)}
            disabled={relayRunning}
            style={{
              opacity: relayRunning ? 0.5 : 1,
              cursor: relayRunning ? "not-allowed" : "pointer",
            }}
          >
            Start
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setRelayRunning(false)}
            disabled={!relayRunning}
            style={{
              opacity: !relayRunning ? 0.5 : 1,
              cursor: !relayRunning ? "not-allowed" : "pointer",
            }}
          >
            Stop
          </button>
        </div>
      </div>

      {/* On Air Card */}
      {mockActiveUser && (
        <div
          className="card"
          style={{
            marginBottom: "var(--space-6)",
            maxWidth: "400px",
            backgroundColor: "var(--color-accent-100)",
          }}
        >
          <h3 style={{ marginTop: 0, fontSize: "17px", color: "var(--color-accent-800)" }}>
            On Air
          </h3>
          <p style={{ margin: "0 0 var(--space-2)", color: "var(--color-accent-800)" }}>
            <strong>{mockActiveUser.email}</strong>
          </p>
          <p
            style={{ margin: 0, fontSize: "13px", color: "var(--color-accent-700)", opacity: 0.8 }}
          >
            Since {formatTime(mockActiveUser.since)}
          </p>
        </div>
      )}

      {/* Users Table */}
      <div style={{ marginBottom: "var(--space-6)" }}>
        <h3 style={{ marginTop: 0, marginBottom: "var(--space-4)" }}>Users</h3>
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th>Profile Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>{user.email}</td>
                  <td style={{ textTransform: "capitalize" }}>{user.role}</td>
                  <td>
                    <span
                      className="tag"
                      style={{
                        backgroundColor:
                          user.profileStatus === "active"
                            ? "var(--color-accent-100)"
                            : "var(--color-neutral-200)",
                        color:
                          user.profileStatus === "active"
                            ? "var(--color-accent-800)"
                            : "var(--color-neutral-800)",
                      }}
                    >
                      {user.profileStatus === "active" ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td>
                    {user.profileStatus === "inactive" && (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => handleActivateUser(user.id)}
                        style={{ fontSize: "13px", padding: "4px 8px" }}
                      >
                        Activate
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add User Form */}
      <div style={{ maxWidth: "400px" }}>
        <h3 style={{ marginTop: 0, marginBottom: "var(--space-4)" }}>Add User</h3>
        <form onSubmit={handleAddUser} className="card">
          <div className="field">
            <label htmlFor="new-email" style={{ marginBottom: "var(--space-2)" }}>
              Email
            </label>
            <input
              id="new-email"
              className="input"
              type="email"
              value={newUserEmail}
              onChange={(e) => setNewUserEmail(e.currentTarget.value)}
              placeholder="user@example.com"
            />
          </div>
          <button type="submit" className="btn btn-primary btn-block">
            Add User
          </button>
        </form>
      </div>
    </div>
  );
}

import type { Session } from "../types/broadcaster";

// Mock data for demo
const mockSessions: Session[] = [
  {
    id: "1",
    started: new Date("2026-10-15T20:00:00"),
    duration: 3600000,
    destinations: [
      { name: "YouTube", enabled: true, status: "Sending", kbps: 4500 },
      { name: "Twitch", enabled: true, status: "Sending", kbps: 4200 },
    ],
    avgInputKbps: 4500,
    sentKbps: 8700,
  },
  {
    id: "2",
    started: new Date("2026-10-14T19:30:00"),
    duration: 5400000,
    destinations: [{ name: "YouTube", enabled: true, status: "Sending", kbps: 4800 }],
    avgInputKbps: 4800,
    sentKbps: 4800,
  },
];

export function History() {
  const formatDate = (date: Date) =>
    date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const formatTime = (date: Date) =>
    date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  const formatDuration = (ms: number) => {
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    return `${hours}h ${minutes}m`;
  };

  return (
    <div
      style={{
        padding: "var(--space-6)",
        minHeight: "calc(100vh - 60px)",
        backgroundColor: "var(--color-bg)",
      }}
    >
      <h2 style={{ marginTop: 0, marginBottom: "var(--space-4)" }}>History</h2>

      {mockSessions.length === 0 ? (
        <div style={{ opacity: 0.6, padding: "var(--space-4)" }}>No sessions yet.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Started</th>
                <th>Duration</th>
                <th>Destinations</th>
                <th>Avg Input</th>
                <th>Sent</th>
              </tr>
            </thead>
            <tbody>
              {mockSessions.map((session) => (
                <tr key={session.id}>
                  <td>{formatDate(session.started)}</td>
                  <td>{formatTime(session.started)}</td>
                  <td>{formatDuration(session.duration)}</td>
                  <td>
                    {session.destinations
                      .filter((d) => d.enabled)
                      .map((d) => d.name)
                      .join(", ")}
                  </td>
                  <td>{session.avgInputKbps} kbps</td>
                  <td>{session.sentKbps} kbps</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

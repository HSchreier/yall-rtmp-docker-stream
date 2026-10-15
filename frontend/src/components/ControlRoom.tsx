import { useSlotStore } from "../stores/slot.store";
import { useStatsStore } from "../stores/stats.store";

export function ControlRoom() {
  const { bitrateBars, getStatsTiles, destinations } = useStatsStore();
  const { statusBand } = useSlotStore();

  const statsTiles = getStatsTiles();

  // Calculate max bitrate for scaling (use 6000 kbps as max)
  const maxBitrate = 6000;
  const dashed4000Line = 4000 / maxBitrate;

  return (
    <div
      style={{
        backgroundColor: "#1a1a1a",
        color: "var(--color-text)",
        padding: "var(--space-6)",
        minHeight: "calc(100vh - 60px)",
        overflow: "auto",
      }}
    >
      {/* Status Band */}
      <div
        style={{
          padding: "var(--space-4)",
          marginBottom: "var(--space-6)",
          backgroundColor: "var(--color-accent)",
          color: "white",
          borderRadius: "0px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div>
          <div style={{ fontSize: "12px", opacity: 0.9 }}>STATUS</div>
          <div style={{ fontSize: "18px", fontWeight: 600, marginTop: "4px" }}>
            {statusBand.label}
          </div>
          {statusBand.isActive && (
            <div style={{ fontSize: "13px", marginTop: "4px", opacity: 0.9 }}>
              Duration: {statusBand.timer}
            </div>
          )}
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          style={{
            backgroundColor: "rgba(255,255,255,0.2)",
            borderColor: "rgba(255,255,255,0.4)",
            color: "white",
          }}
        >
          {statusBand.actionLabel}
        </button>
      </div>

      {/* Bitrate Graph */}
      <div
        style={{
          padding: "var(--space-4)",
          marginBottom: "var(--space-6)",
          backgroundColor: "var(--color-surface)",
          borderRadius: "0px",
        }}
      >
        <h3
          style={{ fontSize: "13px", marginTop: 0, marginBottom: "var(--space-3)", opacity: 0.8 }}
        >
          BITRATE (6000 kbps scale)
        </h3>
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: "2px",
            height: "120px",
            backgroundColor: "#f3f2f2",
            padding: "var(--space-2)",
            borderRadius: "0px",
            position: "relative",
          }}
        >
          {/* Dashed 4000 line */}
          <div
            style={{
              position: "absolute",
              left: 0,
              top: `${(1 - dashed4000Line) * 100}%`,
              width: "100%",
              height: "1px",
              borderTop: "2px dashed #ccc",
              pointerEvents: "none",
            }}
          />

          {/* Bars */}
          {bitrateBars.length === 0 ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#ccc",
              }}
            >
              No data
            </div>
          ) : (
            bitrateBars.map((bar) => {
              const height = (bar.kbps / maxBitrate) * 100;
              return (
                <div
                  key={bar.timestamp}
                  style={{
                    flex: 1,
                    height: `${Math.max(height, 2)}%`,
                    backgroundColor: "var(--color-accent)",
                    minWidth: "4px",
                  }}
                />
              );
            })
          )}
        </div>
      </div>

      {/* Stats Tiles */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: "var(--space-4)",
          marginBottom: "var(--space-6)",
        }}
      >
        {statsTiles.map((tile) => (
          <div
            key={tile.label}
            style={{
              padding: "var(--space-4)",
              backgroundColor: "var(--color-surface)",
              borderRadius: "0px",
              textAlign: "center",
            }}
          >
            <div
              style={{
                fontSize: "11px",
                opacity: 0.7,
                marginBottom: "8px",
                textTransform: "uppercase",
              }}
            >
              {tile.label}
            </div>
            <div style={{ fontSize: "24px", fontWeight: 600, marginBottom: "4px" }}>
              {tile.value}
            </div>
            {tile.unit && <div style={{ fontSize: "11px", opacity: 0.6 }}>{tile.unit}</div>}
          </div>
        ))}
      </div>

      {/* Destination Rail */}
      <div style={{ marginBottom: "var(--space-4)" }}>
        <h3
          style={{ fontSize: "13px", marginTop: 0, marginBottom: "var(--space-3)", opacity: 0.8 }}
        >
          DESTINATIONS
        </h3>
        {destinations.map((dest) => (
          <div
            key={dest.name}
            style={{
              padding: "var(--space-3)",
              marginBottom: "var(--space-2)",
              backgroundColor: "var(--color-surface)",
              borderRadius: "0px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <div style={{ fontSize: "14px", fontWeight: 600 }}>{dest.name}</div>
              <div style={{ fontSize: "12px", opacity: 0.7 }}>
                {dest.kbps} kbps ·{" "}
                <span style={{ textTransform: "capitalize" }}>{dest.status}</span>
              </div>
            </div>
            <div
              style={{
                width: "12px",
                height: "12px",
                borderRadius: "50%",
                backgroundColor:
                  dest.status === "Off"
                    ? "#ccc"
                    : dest.status === "Standby"
                      ? "#999"
                      : dest.status === "Sending"
                        ? "var(--color-accent)"
                        : "#f99",
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

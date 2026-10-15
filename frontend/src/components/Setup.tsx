import { useState } from "react";
import { useStatsStore } from "../stores/stats.store";

type EncoderGuide = "obs" | "mixxx" | "larix";

export function Setup() {
  const [showKey, setShowKey] = useState(false);
  const [selectedGuide, setSelectedGuide] = useState<EncoderGuide>("obs");
  const { destinations, setDestinations } = useStatsStore();

  const streamKey = "rtmp://example.com/live/your-stream-key";

  const toggleDestination = (name: "YouTube" | "Twitch" | "Mixcloud") => {
    setDestinations(destinations.map((d) => (d.name === name ? { ...d, enabled: !d.enabled } : d)));
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(streamKey);
  };

  return (
    <div
      style={{
        padding: "var(--space-6)",
        minHeight: "calc(100vh - 60px)",
        backgroundColor: "var(--color-bg)",
      }}
    >
      <h2 style={{ marginTop: 0, marginBottom: "var(--space-6)" }}>Setup</h2>

      {/* Ingest URL */}
      <div className="card" style={{ marginBottom: "var(--space-6)", maxWidth: "600px" }}>
        <h3 style={{ marginTop: 0, fontSize: "17px" }}>Ingest URL</h3>

        <div className="field">
          <label htmlFor="stream-key" style={{ marginBottom: "var(--space-2)" }}>
            Stream Key
          </label>
          <div
            style={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              gap: "var(--space-2)",
            }}
          >
            <input
              id="stream-key"
              type={showKey ? "text" : "password"}
              value={streamKey}
              readOnly
              className="input"
              style={{ flex: 1 }}
            />
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setShowKey(!showKey)}
              style={{ padding: "var(--space-2) var(--space-3)", whiteSpace: "nowrap" }}
            >
              {showKey ? "Hide" : "Show"}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={copyToClipboard}
              style={{ padding: "var(--space-2) var(--space-3)", whiteSpace: "nowrap" }}
            >
              Copy
            </button>
          </div>
        </div>
      </div>

      {/* Destinations */}
      <div className="card" style={{ marginBottom: "var(--space-6)", maxWidth: "600px" }}>
        <h3 style={{ marginTop: 0, fontSize: "17px" }}>Enable Destinations</h3>

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          {destinations.map((dest) => (
            <label key={dest.name} className="radio">
              <input
                type="checkbox"
                checked={dest.enabled}
                onChange={() => toggleDestination(dest.name)}
              />
              <div style={{ flex: 1 }}>
                <span style={{ fontWeight: 600 }}>{dest.name}</span>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Encoder Guides */}
      <div style={{ maxWidth: "600px" }}>
        <h3 style={{ marginTop: 0, marginBottom: "var(--space-4)" }}>Encoder Guides</h3>

        <div className="seg" style={{ marginBottom: "var(--space-4)" }}>
          <label className="seg-opt">
            <input
              type="radio"
              name="encoder"
              value="obs"
              checked={selectedGuide === "obs"}
              onChange={() => setSelectedGuide("obs")}
            />
            OBS
          </label>
          <label className="seg-opt">
            <input
              type="radio"
              name="encoder"
              value="mixxx"
              checked={selectedGuide === "mixxx"}
              onChange={() => setSelectedGuide("mixxx")}
            />
            Mixxx
          </label>
          <label className="seg-opt">
            <input
              type="radio"
              name="encoder"
              value="larix"
              checked={selectedGuide === "larix"}
              onChange={() => setSelectedGuide("larix")}
            />
            Larix
          </label>
        </div>

        <div className="card">
          {selectedGuide === "obs" && (
            <div>
              <h4 style={{ marginTop: 0 }}>OBS Studio Setup</h4>
              <ol style={{ marginTop: "var(--space-3)", opacity: 0.8 }}>
                <li>Go to Settings &gt; Stream</li>
                <li>Select "RTMP" service</li>
                <li>Paste the stream key above</li>
                <li>Click "Start Streaming"</li>
              </ol>
            </div>
          )}

          {selectedGuide === "mixxx" && (
            <div>
              <h4 style={{ marginTop: 0 }}>Mixxx Setup</h4>
              <ol style={{ marginTop: "var(--space-3)", opacity: 0.8 }}>
                <li>Go to Preferences &gt; Live Broadcasting</li>
                <li>Select "RTMP" and enter the stream key</li>
                <li>Save settings</li>
                <li>Click "Enable Live Broadcasting"</li>
              </ol>
            </div>
          )}

          {selectedGuide === "larix" && (
            <div>
              <h4 style={{ marginTop: 0 }}>Larix Broadcaster Setup</h4>
              <ol style={{ marginTop: "var(--space-3)", opacity: 0.8 }}>
                <li>Create a new RTMP connection</li>
                <li>Paste the stream key</li>
                <li>Set bitrate to 4000–6000 kbps</li>
                <li>Start broadcast</li>
              </ol>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

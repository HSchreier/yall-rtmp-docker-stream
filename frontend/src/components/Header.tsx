import { useTranslation } from "react-i18next";
import { useAuthStore } from "../store/auth.store";
import { useSlotStore } from "../stores/slot.store";

interface HeaderProps {
  activeTab: "control-room" | "setup" | "history" | "admin";
  onTabChange: (tab: "control-room" | "setup" | "history" | "admin") => void;
}

export function Header({ activeTab, onTabChange }: HeaderProps) {
  const { t, i18n } = useTranslation();
  const { email, clearToken, role } = useAuthStore();
  const { myStatus } = useSlotStore();

  const currentLang = i18n.language.split("-")[0];

  const handleLogout = () => {
    clearToken();
  };

  return (
    <nav
      className="nav"
      style={{ backgroundColor: "var(--color-bg)", borderBottom: "2px solid var(--color-divider)" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)" }}>
        {/* Brand */}
        <img src="/assets/brand/lockup-transparent.svg" alt="Ya'll Cast" style={{ height: "28px" }} />
      </div>

      {/* Slot chip in center */}
      <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
        <div
          className="tag tag-accent"
          style={{
            padding: "6px 12px",
            fontSize: "12px",
            fontWeight: 600,
          }}
        >
          {myStatus === "relay-stopped" && "Relay Stopped"}
          {myStatus === "free" && "Free"}
          {myStatus === "waiting" && "Waiting..."}
          {myStatus === "live" && "Live"}
          {myStatus === "taken" && "Taken"}
        </div>
      </div>

      {/* Navigation tabs */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-4)",
          marginRight: "auto",
        }}
      >
        <button
          type="button"
          onClick={() => onTabChange("control-room")}
          style={{
            background: "none",
            border: "none",
            color: activeTab === "control-room" ? "var(--color-accent)" : "inherit",
            cursor: "pointer",
            fontSize: "14px",
            textDecoration: activeTab === "control-room" ? "underline" : "none",
          }}
        >
          Control room
        </button>
        <button
          type="button"
          onClick={() => onTabChange("setup")}
          style={{
            background: "none",
            border: "none",
            color: activeTab === "setup" ? "var(--color-accent)" : "inherit",
            cursor: "pointer",
            fontSize: "14px",
            textDecoration: activeTab === "setup" ? "underline" : "none",
          }}
        >
          Setup
        </button>
        <button
          type="button"
          onClick={() => onTabChange("history")}
          style={{
            background: "none",
            border: "none",
            color: activeTab === "history" ? "var(--color-accent)" : "inherit",
            cursor: "pointer",
            fontSize: "14px",
            textDecoration: activeTab === "history" ? "underline" : "none",
          }}
        >
          History
        </button>
        {role === "admin" && (
          <button
            type="button"
            onClick={() => onTabChange("admin")}
            style={{
              background: "none",
              border: "none",
              color: activeTab === "admin" ? "var(--color-accent)" : "inherit",
              cursor: "pointer",
              fontSize: "14px",
              textDecoration: activeTab === "admin" ? "underline" : "none",
            }}
          >
            Admin
          </button>
        )}
      </div>

      {/* Right side: language, email, logout */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-3)",
          marginLeft: "var(--space-4)",
        }}
      >
        <select
          value={currentLang}
          onChange={(e) => i18n.changeLanguage(e.currentTarget.value)}
          className="input"
          style={{
            width: "80px",
            padding: "6px 8px",
            fontSize: "12px",
          }}
        >
          <option value="en">English</option>
          <option value="es">Español</option>
        </select>

        <span style={{ fontSize: "13px", color: "var(--color-text)", whiteSpace: "nowrap" }}>
          {email}
        </span>

        <button
          type="button"
          className="btn btn-ghost"
          onClick={handleLogout}
          style={{ fontSize: "13px" }}
        >
          {t("common.logout")}
        </button>
      </div>
    </nav>
  );
}

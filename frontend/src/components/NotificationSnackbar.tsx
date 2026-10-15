import { useEffect, useState } from "react";
import { eventBus } from "../infra/event-bus";

type AlertType = "success" | "info" | "warning" | "error";

export function NotificationSnackbar() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [type, setType] = useState<AlertType>("info");

  useEffect(() => {
    const unsubscribe = eventBus.on("notification:show", ({ message, type }) => {
      setMessage(message);
      setType(type as AlertType);
      setOpen(true);

      // Auto-hide after 4 seconds
      const timeout = setTimeout(() => {
        setOpen(false);
      }, 4000);

      return () => clearTimeout(timeout);
    });

    return unsubscribe;
  }, []);

  if (!open) return null;

  const bgColor = {
    success: "var(--color-accent-600)",
    info: "#0066cc",
    warning: "var(--color-accent-400)",
    error: "var(--color-accent)",
  }[type];

  const textColor = {
    success: "white",
    info: "white",
    warning: "white",
    error: "white",
  }[type];

  return (
    <div
      style={{
        position: "fixed",
        bottom: "var(--space-4)",
        right: "var(--space-4)",
        padding: "var(--space-3)",
        backgroundColor: bgColor,
        color: textColor,
        borderRadius: "0px",
        fontSize: "14px",
        maxWidth: "400px",
        zIndex: 9999,
        boxShadow: "var(--shadow-lg)",
        animation: "slideIn 0.3s ease-out",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>{message}</div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          style={{
            background: "none",
            border: "none",
            color: "inherit",
            cursor: "pointer",
            fontSize: "18px",
            marginLeft: "var(--space-3)",
            padding: 0,
            opacity: 0.8,
          }}
        >
          ×
        </button>
      </div>

      <style>{`
        @keyframes slideIn {
          from {
            transform: translateX(400px);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
}

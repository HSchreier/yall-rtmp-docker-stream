import { useState } from "react";
import { Admin } from "../components/Admin";
import { ControlRoom } from "../components/ControlRoom";
import { Header } from "../components/Header";
import { History } from "../components/History";
import { Setup } from "../components/Setup";
import { useAuthStore } from "../store/auth.store";

type TabName = "control-room" | "setup" | "history" | "admin";

export function Dashboard() {
  const [activeTab, setActiveTab] = useState<TabName>("control-room");
  const { role } = useAuthStore();

  const handleTabChange = (tab: TabName) => {
    if (tab === "admin" && role !== "admin") {
      return;
    }
    setActiveTab(tab);
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        backgroundColor: "var(--color-bg)",
      }}
    >
      <Header activeTab={activeTab} onTabChange={handleTabChange} />

      <div style={{ flex: 1, overflow: "auto" }}>
        {activeTab === "control-room" && <ControlRoom />}
        {activeTab === "setup" && <Setup />}
        {activeTab === "history" && <History />}
        {activeTab === "admin" && role === "admin" && <Admin />}
      </div>
    </div>
  );
}

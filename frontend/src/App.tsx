import { useEffect, useState } from "react";
import { NotificationSnackbar } from "./components/NotificationSnackbar";
import { Dashboard } from "./pages/Dashboard";
import { Login } from "./pages/Login";
import { Setup } from "./pages/Setup";
import { useAuthStore } from "./store/auth.store";
import "./i18n/config";

export function App() {
  const [isHydrated, setIsHydrated] = useState(false);
  const [isFirstInstall, setIsFirstInstall] = useState<boolean | null>(null);
  const { token } = useAuthStore();

  useEffect(() => {
    const checkFirstInstall = async () => {
      try {
        const res = await fetch("/api/auth/check-setup");
        const data = await res.json() as { needsSetup: boolean };
        setIsFirstInstall(data.needsSetup);
      } catch {
        setIsFirstInstall(false);
      }
      setIsHydrated(true);
    };
    checkFirstInstall();
  }, []);

  if (!isHydrated || isFirstInstall === null) {
    return null;
  }

  return (
    <>
      <NotificationSnackbar />
      {isFirstInstall ? <Setup /> : token ? <Dashboard /> : <Login />}
    </>
  );
}

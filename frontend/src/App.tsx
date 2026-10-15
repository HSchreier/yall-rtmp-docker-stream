import { useEffect, useState } from "react";
import { NotificationSnackbar } from "./components/NotificationSnackbar";
import { Dashboard } from "./pages/Dashboard";
import { Login } from "./pages/Login";
import { useAuthStore } from "./store/auth.store";
import "./i18n/config";

export function App() {
  const [isHydrated, setIsHydrated] = useState(false);
  const { token } = useAuthStore();

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  if (!isHydrated) {
    return null;
  }

  return (
    <>
      <NotificationSnackbar />
      {token ? <Dashboard /> : <Login />}
    </>
  );
}

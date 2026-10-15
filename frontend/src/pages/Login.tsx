import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../store/auth.store";

export function Login() {
  const { t } = useTranslation();
  const { setToken, setError, setLoading, error, isLoading } = useAuthStore();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const data = (await response.json()) as Record<string, unknown>;
        const errorMsg = (data.error as Record<string, string>)?.message || t("auth.loginError");
        throw new Error(errorMsg);
      }

      const data = (await response.json()) as { token: string; role?: string };
      const userResponse = await fetch("/api/users/me", {
        headers: { Authorization: `Bearer ${data.token}` },
      });
      const user = (await userResponse.json()) as { userId: string };

      setToken(data.token, user.userId, (data.role as "admin" | "user") || "user", email);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.loginError"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        backgroundColor: "var(--color-bg)",
      }}
    >
      <div
        className="card"
        style={{
          width: "100%",
          maxWidth: "440px",
          padding: "var(--space-6)",
        }}
      >
        <h1
          style={{ fontSize: "28px", marginBottom: "var(--space-4)", color: "var(--color-accent)" }}
        >
          {t("common.appName")}
        </h1>

        <h2 style={{ fontSize: "20px", marginBottom: "var(--space-2)" }}>{t("auth.loginTitle")}</h2>

        <p style={{ marginBottom: "var(--space-4)", opacity: 0.8, fontSize: "14px" }}>
          {t("auth.loginDescription")}
        </p>

        {error && (
          <div
            style={{
              padding: "var(--space-3)",
              marginBottom: "var(--space-4)",
              backgroundColor: "var(--color-accent-100)",
              color: "var(--color-accent-800)",
              border: "1px solid var(--color-accent-200)",
              borderRadius: "0px",
              fontSize: "14px",
            }}
          >
            {error}
          </div>
        )}

        <form
          onSubmit={handleLogin}
          style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}
        >
          <div className="field">
            <label htmlFor="email" style={{ marginBottom: "var(--space-2)", display: "block" }}>
              {t("auth.email")}
            </label>
            <input
              id="email"
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.currentTarget.value)}
              required
              disabled={isLoading}
              autoComplete="email"
            />
          </div>

          <div className="field">
            <label htmlFor="password" style={{ marginBottom: "var(--space-2)", display: "block" }}>
              {t("auth.password")}
            </label>
            <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
              <input
                id="password"
                className="input"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.currentTarget.value)}
                required
                disabled={isLoading}
                autoComplete="current-password"
                style={{ paddingRight: "40px" }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="btn-ghost"
                style={{
                  position: "absolute",
                  right: "8px",
                  fontSize: "12px",
                  padding: "4px 8px",
                }}
                disabled={isLoading}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-block"
            disabled={isLoading || !email || !password}
            style={{
              marginTop: "var(--space-4)",
              opacity: isLoading || !email || !password ? 0.5 : 1,
              cursor: isLoading || !email || !password ? "not-allowed" : "pointer",
            }}
          >
            {isLoading ? t("auth.loggingIn") || "Logging in..." : t("common.login")}
          </button>
        </form>
      </div>
    </div>
  );
}

import { useState, useMemo } from "react";
import { httpClient } from "../infra/http";

const PASSWORD_MIN_LENGTH = 12;
const COMPLEXITY_RE = /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[@$!%*?&])/;

export function Setup() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const passwordValidation = useMemo(() => {
    if (!password) return { isValid: false, checks: [] };

    return {
      isValid: password.length >= PASSWORD_MIN_LENGTH && COMPLEXITY_RE.test(password),
      checks: [
        { label: "At least 12 characters", met: password.length >= PASSWORD_MIN_LENGTH },
        { label: "One uppercase letter", met: /[A-Z]/.test(password) },
        { label: "One lowercase letter", met: /[a-z]/.test(password) },
        { label: "One digit", met: /\d/.test(password) },
        { label: "One special char (@$!%*?&)", met: /[@$!%*?&]/.test(password) },
      ],
    };
  }, [password]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!email || !password || !confirmPassword) {
      setError("All fields required");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords don't match");
      return;
    }

    if (!passwordValidation.isValid) {
      setError("Password must meet all requirements (see checklist below)");
      return;
    }

    setLoading(true);
    try {
      await httpClient.post("/auth/register", {
        email,
        password,
        role: "admin",
      });
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Setup failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>Setup Ya'll Cast</h1>
        <p style={styles.subtitle}>
          Create the admin account — password must be 12+ chars with uppercase, lowercase, digit, and special char
        </p>

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.field}>
            <label style={styles.label}>Admin Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@example.com"
              style={styles.input}
              disabled={loading}
            />
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Password</label>
            <div style={styles.passwordWrapper}>
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                style={{
                  ...styles.input,
                  borderColor: password && !passwordValidation.isValid ? "#c95a52" : "#201e1d",
                }}
                disabled={loading}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={styles.toggleBtn}
                disabled={loading}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
            {password && (
              <div style={styles.checks}>
                {passwordValidation.checks.map((check) => (
                  <div
                    key={check.label}
                    style={{
                      ...styles.check,
                      color: check.met ? "#46a06a" : "#9ca3ae",
                    }}
                  >
                    <span style={{ marginRight: "8px" }}>{check.met ? "✓" : "○"}</span>
                    {check.label}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Confirm Password</label>
            <input
              type={showPassword ? "text" : "password"}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              style={{
                ...styles.input,
                borderColor:
                  confirmPassword && password !== confirmPassword ? "#c95a52" : "#201e1d",
              }}
              disabled={loading}
            />
            {confirmPassword && password !== confirmPassword && (
              <div style={styles.error} className="no-padding">
                Passwords don't match
              </div>
            )}
            {confirmPassword && password === confirmPassword && passwordValidation.isValid && (
              <div
                style={{
                  ...styles.checks,
                  backgroundColor: "#f0fff4",
                  borderColor: "#46a06a",
                  color: "#46a06a",
                }}
              >
                ✓ Passwords match
              </div>
            )}
          </div>

          {error && <div style={styles.error}>{error}</div>}

          <button
            type="submit"
            style={{ ...styles.button, opacity: loading ? 0.6 : 1 }}
            disabled={loading}
          >
            {loading ? "Creating..." : "Create Admin"}
          </button>
        </form>
      </div>
    </div>
  );
}

const styles = {
  container: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "100vh",
    backgroundColor: "#f3f2f2",
    fontFamily: "Archivo, system-ui, sans-serif",
  } as const,
  card: {
    backgroundColor: "white",
    border: "2px solid #201e1d",
    borderRadius: "0",
    padding: "48px 40px",
    maxWidth: "400px",
    width: "100%",
  } as const,
  title: {
    fontSize: "28px",
    fontWeight: 700,
    color: "#201e1d",
    margin: "0 0 8px 0",
  } as const,
  subtitle: {
    fontSize: "14px",
    color: "#6b727d",
    margin: "0 0 32px 0",
  } as const,
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "20px",
  } as const,
  field: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  } as const,
  label: {
    fontSize: "13px",
    fontWeight: 600,
    color: "#201e1d",
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
  } as const,
  input: {
    padding: "10px 12px",
    border: "2px solid #201e1d",
    borderRadius: "0",
    fontSize: "14px",
    fontFamily: "inherit",
    backgroundColor: "white",
    color: "#201e1d",
  } as const,
  passwordWrapper: {
    position: "relative" as const,
    display: "flex",
  } as const,
  toggleBtn: {
    position: "absolute" as const,
    right: "12px",
    top: "50%",
    transform: "translateY(-50%)",
    background: "none",
    border: "none",
    fontSize: "12px",
    color: "#ec3013",
    cursor: "pointer",
    padding: "4px 8px",
    fontWeight: 600,
  } as const,
  button: {
    padding: "12px 16px",
    backgroundColor: "#ec3013",
    color: "white",
    border: "none",
    borderRadius: "0",
    fontSize: "14px",
    fontWeight: 700,
    cursor: "pointer",
    marginTop: "8px",
  } as const,
  error: {
    padding: "12px",
    backgroundColor: "#fff0f0",
    border: "2px solid #c95a52",
    color: "#c95a52",
    fontSize: "13px",
    borderRadius: "0",
  } as const,
  checks: {
    marginTop: "8px",
    padding: "12px",
    backgroundColor: "#f9f9f9",
    border: "2px solid #e7eaee",
    borderRadius: "0",
    display: "flex",
    flexDirection: "column" as const,
    gap: "6px",
  } as const,
  check: {
    fontSize: "13px",
    display: "flex",
    alignItems: "center",
    fontFamily: "inherit",
  } as const,
};

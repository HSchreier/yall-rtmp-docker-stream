// Shared client JS. No framework, no build step — matches docs/TECHNICAL.md's
// "no SPA" decision. Cookie-based auth: the browser sends the HttpOnly
// session cookie automatically on same-origin requests, this code never
// reads or sets it directly.
window.Yallcast = (() => {
  async function api(method, path, body) {
    const res = await fetch(path, {
      method,
      credentials: "include",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      // no/invalid JSON body — fine for some 204-ish responses
    }
    return { ok: res.ok, status: res.status, data };
  }

  function formToJson(form) {
    const obj = {};
    for (const [key, value] of new FormData(form).entries()) {
      if (value === "") continue;
      obj[key] = value;
    }
    return obj;
  }

  function bindForm(selector, handler) {
    const form = document.querySelector(selector);
    if (!form) return;
    const errorEl = form.querySelector(".error-text");
    const submitBtn = form.querySelector('button[type="submit"]');

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (errorEl) {
        errorEl.hidden = true;
        errorEl.textContent = "";
      }
      if (submitBtn) submitBtn.disabled = true;
      try {
        const data = formToJson(form);
        const res = await handler(data);
        if (res && !res.ok && errorEl) {
          errorEl.textContent = res.data?.error?.message ?? "Something went wrong.";
          errorEl.hidden = false;
        }
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  async function me() {
    const res = await api("GET", "/me");
    return res.ok ? res.data : null;
  }

  async function requireAuth() {
    const session = await me();
    if (!session) {
      location.href = "/login.html";
      return null;
    }
    return session;
  }

  async function logout() {
    await api("POST", "/auth/logout");
    location.href = "/login.html";
  }

  return { api, bindForm, me, requireAuth, logout };
})();

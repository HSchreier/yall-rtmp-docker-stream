# Screens & User Journeys — Design Brief

Companion to `docs/TECHNICAL.md` — that doc owns the data/API contracts (routes, payloads, events); this one owns what a person actually sees and does. Every screen below maps to a route already defined in TECHNICAL.md's Data objects section — nothing here invents new endpoints.

Local only — not pushed until code lands on the branch that needs it (matches how design briefs are handled elsewhere).

**Provenance:** this is now a reconciled document. An earlier version of this brief (structural only, no visuals) was turned into a full high-fidelity design handoff — the **Modernist** design system, plus an exact, screen-by-screen spec (copy, layout, states) — archived at `docs/design-briefs/reference/`. That handoff used the product name "Relay" throughout; it's renamed to "Ya'll Cast" everywhere below to match this project's actual brand decision (see Visual identity). The structural design system itself (tokens, components, layout rules) is unchanged from the handoff.

---

## Roles & personas

| Role | Can do | Can't do |
|---|---|---|
| `user` | Edit and activate **their own** destination profile | Edit anyone else's profile, register accounts, activate someone else |
| `admin` | Everything `user` can do for their own profile, plus: register new accounts, activate **any** profile | Edit another user's stream keys directly (see TECHNICAL.md — Explicitly not doing) |

In practice this is a small number of people (the performers/DJs, plus whoever administers the box), not a public user base — screens should read as an operational tool, not a consumer product.

---

## Journeys

### J1 — First install (nobody exists yet)

1. Operator runs `docker compose up`, opens the box's URL.
2. **[S1 Setup]** — no accounts exist. Create the first (admin) account.
3. Redirected straight into **[S3 Profile — first-run]** — this account has no destination profile yet.
4. Fill in destination keys, submit. Server generates the ingest key. **Because no profile is active yet, this one activates automatically on save** — resolved default, see Screen S3.
5. Success view: the OBS ingest URL, ready to copy, with setup instructions.
6. Operator points OBS at the ingest URL. Dashboard status flips to *live* via SSE, no page reload.

### J2 — Returning user, day-to-day

1. **[S2 Login]** → **[S4 Dashboard]**.
2. Glance at live status. If offline, just start OBS. If idle, that's a signal to check the OBS connection.
3. Occasionally: edit a stream key in **[S5 Profile edit]** because a platform rotated it.

### J3 — Handing the broadcast to someone else

1. A second `user` account already exists with its own profile (registered by an admin, journey J4), but isn't active.
2. That user logs in, sees **[S4 Dashboard]** with a clear "you are not the active profile" state — distinct from "you're active but offline."
3. They hit **Activate my profile**. If someone else is currently *live* (not just active-but-idle), **[S6 Activation confirmation]** interrupts: "{active} is live right now" / "Activating {your profile} cuts their stream immediately on every destination." Confirm ("End theirs, activate mine") or cancel.
4. On confirm: their profile activates, the previous broadcaster's stream is cut. The previous active user sees a **handoff notice** on their own dashboard via SSE — not just a state that quietly changed underneath them, an explicit message: "{who} activated their profile at HH:MM — your broadcast was ended."

### J4 — Admin registers a new user

1. Admin, on **[S4 Dashboard]**, opens **[S7 Register user]** (admin-only, not a nav item a `user` role ever sees).
2. Fills in email/password/role, submits.
3. New account exists but has no profile yet and isn't active. Nothing happens to the current broadcast.
4. That person's first login takes them through **[S3 Profile — first-run]** themselves — but their profile does **not** auto-activate, since somebody may already be active (asymmetry with J1 step 4 is intentional, see S3).

### J5 — Admin activates someone else (hands off without that person doing it themselves)

1. Admin, on **[S4 Dashboard]**, sees an **All users** table with an Activate action per row (admin only).
2. Same confirmation as J3 if someone is currently live.
3. Activation happens; the named user doesn't need to be present or do anything — they get the same handoff-notice-if-applicable, or a "you're now active" notice if they weren't the one who lost anything.

### J6 — Something breaks

1. Any screen, at any time: nginx crashes, or Mongo disconnects. **[S8 Degraded banner]** appears (pushed via SSE, not discovered by a failed click) — plain language, not a stack trace: "Ya'll Cast lost connection to the streaming engine — reconnecting." / "Can't reach the database — some actions won't work until this clears."
2. If the *browser's own* request fails (e.g. saving a profile while Mongo is down), the form shows an inline error near the Save button, not just the global banner — a person mid-edit needs to know their specific action failed, not just that something somewhere is wrong. Their form values are kept, not cleared.

### J7 — Logout / session expiry

1. **Log out** button (visible whenever authenticated) clears the cookie, returns to **[S2 Login]** — no notice, this was deliberate.
2. A JWT that expires mid-session: the next API call gets a 401, the UI redirects to **[S2 Login]** with a "your session expired, log in again" notice — not a silent failure or a confusing error on whatever button they happened to click.

---

## Screen inventory

Fidelity note: layout, copy, and states below are **final**, taken directly from the archived handoff (`docs/design-briefs/reference/`) — not a rough sketch. Component classes referenced (`.btn-primary`, `.card`, `.dialog`, etc.) are defined in `assets/design-system/modernist/styles.css` — use them, don't invent parallel ones.

### S1 — Setup (bootstrap) / S2 — Login (shared layout)

- **Routes:** `/setup.html` (only while `UserRepository.isEmpty()` — once any account exists, redirect to login with a "setup is already complete" notice) and `/login.html`.
- **Layout:** 2-column grid (min 340px), `2px` rules above/below. Left cell: kicker, h1 (56px, balanced wrap), lede (max 40ch). Right cell: form, max 480px, `2px` left rule, 16px field gaps.
- **Copy — Setup:** kicker "First install"; title "Set up this box."; lede "Create the administrator account. You can add performers once you're in."; button "Create admin account" ("Creating…" while busy); hint "At least 12 characters." under password; note "This account will be the box's administrator." **No role selector** — the bootstrap account is always forced to `admin`, showing a choice here would be misleading.
- **Copy — Login:** kicker "Ya'll Cast"; title "Log in."; lede "Check who's on air, take over the relay, or update your stream keys."; button "Log in".
- **Fields:** email (`.input type=email`); password (`.input`) with a 64px "Show"/"Hide" toggle beside it.
- **Notices:** neutral-fill box for "Your session expired — log in again." (J7) and "Setup is already complete — log in." (S1 redirect case).
- **Errors** (14px/600, accent-700, `role=alert`): "Enter a valid email address." / "Password needs at least 12 characters." / "An account with that email already exists. Log in instead." (409) / login always generic: "Email or password incorrect." — never confirms whether the email exists.
- **Routing:** setup succeeds → S3. Login → S4, or S3 if this user has no profile yet.

### S3 — First-run profile / S5 — Profile edit (shared form)

- **Route:** section of `/dashboard.html` — S3 is the first-run gate (no `destination_profiles` document yet for this user), S5 is the same form pre-filled, reachable any time after.
- **Header:** kicker, h2, lede; S5 also gets a "Close" button (it's not a gate, it can be dismissed).
  - S3 kicker "Step 2 of 2 · first run"; title "Where should your stream go?"; lede when nobody's active: "Nobody is broadcasting yet, so this profile becomes the active one when you save." Lede otherwise: "Your profile won't become active on its own — {active} is active. You can take over from the dashboard." **This is the resolved auto-activate rule: activates on save only if no profile is currently active** — closes the J1/J4 asymmetry question definitively.
  - S5 kicker "Your profile"; title "Edit destinations"; lede "Changes apply the next time you start streaming."
- **Destination grid:** three cells (Mixcloud, YouTube, Twitch), min 280px. Each: h4 name + Off/On toggle on the right; "Stream key" field (masked, with Show/Hide — **resolves the mask/reveal open question**), disabled entirely when Off; behind an "Advanced" disclosure, an optional custom-ingest-URL field, placeholder = the platform default (`rtmp://rtmp.mixcloud.com/broadcast`, `rtmp://a.rtmp.youtube.com/live2`, `rtmp://live.twitch.tv/app`) — **resolves whether `customIngestUrl` gets a UI control: yes, tucked behind Advanced, not front-and-center**.
- **Footer:** left "Advanced: custom ingest URLs" ghost toggle; right, error/status text then the save button — S3 "Save and get OBS URL", S5 "Save changes" ("Saving…" while busy).
- **Validation:** at least one destination must be On ("Turn on at least one destination — with none, there is nothing to relay."); every On destination needs a key ("Add a stream key for {names}, or turn it off."); a 503 on save reads "Couldn't save — the database is unreachable. Your changes are still here; try again in a moment." and **keeps the form values** — never discard what someone typed because the backend hiccuped.
- **S3 success view** (replaces the form): "Point OBS here." + a bordered URL box (`code`, 20px/600) with a "Copy URL" button (shows "Copied" for 1.6s) + setup instructions ("In OBS: Settings → Stream → Service 'Custom', paste the server URL above.") + "Go to dashboard →". The note beneath differs by whether this save activated: "Your profile is active. Paste this into OBS..." vs. "This is your personal ingest URL. It only works while your profile is active — right now that's {active}."
- **S5 extras:** "Saved at HH:MM." confirmation, plus a read-only block showing the ingest URL again (for when someone just needs to re-check it, not re-run setup).

### S4 — Dashboard

Stacked sections, 32px gaps:

1. **Handoff notice** (SSE-delivered, only when set) — appears when this user just lost or gained active status because of someone else's action. Three message variants (you were live and got cut off / you weren't live but lost active status / an admin just made you active). Dismissible via "OK".
2. **Status grid** — two cells:
   - **Live status.** Kicker "Broadcast · {You | email | No active profile}". Four states, each visually distinct (not gradations of each other):
     - *Live* — full accent fill, word "Live" at 88px, bitrate + received bytes below.
     - *Idle* — different treatment entirely (inset accent ring, not a dimmed Live) — **idle must never look like a quieter version of live**, matching the TECHNICAL.md principle that idle is a real, distinct `StreamState` value.
     - *Offline* — neutral, with context-dependent note (you're active but nothing's arriving / someone else is active but not streaming / nobody's active).
     - *Unknown* — when the browser's own SSE connection drops. Diagonal-hatch fill, "Unknown" at 64px, explicit note that the last known status isn't shown because it may be stale. **Never show stale Live data over a dead connection** — this was already a principle in this brief; the handoff gives it an exact visual treatment.
   - **Active-profile cell** — "You are the active profile" / "{email} is the active profile" / "No profile is active", with an "Activate my profile" button when applicable, and an inline error if activation fails ("Couldn't activate — the database is unreachable. Nothing changed; try again in a moment.").
3. **Ingest URL** — shown only when this account is the active profile (unchanged from the earlier version of this brief — showing it otherwise would be misleading).
4. **Action tiles** — "Edit my profile →" (sub-line lists enabled destinations); admin-only "Register a user →".
5. **Register panel** (S7, admin, inline — not a separate page).
6. **All users table** (admin only) — Account / Role / Profile ("Set up" / "Not set up yet") / Status (tag: Active, Active · live, Active · idle) / Activate action (only shown where applicable).

### S6 — Activation confirmation (dialog)

- **Trigger:** activating while the currently-active profile's stream status isn't `offline`.
- **Content:** "This will end a live broadcast" / "{active} is live right now" / "Activating {profile} cuts their stream immediately on every destination. They'll see that you took over." Buttons: Cancel, and "End theirs, activate mine/{name}".
- **Resolved default:** confirm-and-proceed, not a hard block — matches this brief's original "always allowed, always disruptive" framing. A hard-block variant exists in the reference prototype (kicker "Activation blocked", OK-only) as a documented alternative, not the default — **this is the resolved answer to the hard-block-vs-confirm open question**, though it's a default choice, not a technical constraint; revisit if it causes real problems in practice.

### S7 — Register user

- **Route:** admin-only inline panel on `/dashboard.html`.
- **Elements:** email, "Password · 12+ characters", role toggle (User/Admin), submit.
- **Errors:** email format, password length, 409 ("An account with that email already exists."), 503.
- **Success:** "Created {email} ({role}). They'll set up their destinations the first time they log in." Form clears, no redirect (admin likely registers more than one account in a sitting).
- **A `user` role must never receive this panel's markup at all** — not just a disabled button, the panel shouldn't render.

### S8 — Degraded-state banner

- **Type:** persistent slot on every authenticated screen.
- **Messages:** "Ya'll Cast lost connection to the streaming engine — reconnecting." (`nginx.crashed`) / "Can't reach the database — some actions won't work until this clears." (Mongo down).
- **Behavior:** dismissible, but reappears on the next occurrence — not a one-time toast. Coexists with form-level inline errors, doesn't replace them.

---

## Global elements (every authenticated screen)

- **Header (`.nav`):** brand mark/wordmark on the left; on the right — account email, role tag, active-profile indicator (a small accent square + "Active profile" when active, an outlined square + "Not active" otherwise), then "Log out". Wraps on narrow screens.
- **Unauthenticated header:** brand plus a short tagline, no account info.
- Degraded-state banner slot (S8), full width under the header.
- **No multi-page nav** — this is a 4-5 screen tool; one dashboard with sections beats a nav for something this small (consistent with "no SPA, no framework").
- **Responsive:** every grid collapses to one column on narrow viewports (`repeat(auto-fit, minmax(min(100%, Npx), 1fr))`); primary touch targets are at least 44px tall; the users table scrolls horizontally in its own wrapper rather than breaking the page layout. **This resolves the earlier "mobile/responsive layout" open question** — grids degrade gracefully, touch targets are sized for it; a from-scratch phone-specific layout wasn't designed separately, this is the same layout responding to width.

---

## Visual identity

Two separate systems, deliberately not merged into one:

**Modernist — governs the actual app UI.** Tokens and components live at `assets/design-system/modernist/` (`styles.css` is the production stylesheet — link it as-is and use its classes; `readme.md` documents the rules). Flat, architectural: Archivo throughout, zero corner radius, strong 2px dividers instead of hairlines, everything flush-left including button labels, a single accent color used sparingly. This is what every screen above is specified against.

- **Palette (as shipped in the handoff, not yet re-tuned):** bg `#f3f2f2`, surface `#eae9e9`, text `#201e1d`, accent `#ec3013`, plus full 100–900 neutral and accent ramps generated in OKLCH on a shared lightness scale (see `styles.css`).
- **Type:** Archivo 400/600/800. Headings 800 weight, −0.015em tracking.
- **Icons:** Lucide, 16–18px, 2px stroke — a real dependency decision worth confirming (SVG-per-icon, inlined, no JS icon-font runtime needed, consistent with "no framework where unnecessary").
- **Re-tuning the accent toward Ya'll Cast's signal red (`#D52B1E`, close to `#ec3013`) was decided as the direction, but not done** — the ramp was "generated in OKLCH on a shared perceptual lightness scale" by whatever tool built this design system originally (`theme.json`, not included in this handoff export). Hand-guessing replacement hex values for a 9-step ramp would produce something that *looks* like it matches but doesn't carry the same tuned lightness/contrast relationships the rest of the system depends on (the 3:1 accent-to-ground contrast guarantee mentioned in `readme.md`, for one). This needs the actual generation tool re-run with signal red as the seed, not a manual edit here.

**Ya'll Cast — the marketing/identity brand.** Lives at `assets/brand/` (logo, mark, social-preview assets, its own bolder yellow/red palette — see `COLORS.txt`). Used for: the favicon (`mark-32.png`/`mark-180.png`), the README header, and GitHub's org avatar/social-preview once this repo is pushed. **Not** the in-app theme — the product's marketing face and its operator-tool interior are allowed to look different, the way a company's website and its internal admin panel often do.

The header brand mark on every screen above (`.nav-brand`) should use the Ya'll Cast mark/wordmark specifically — that's the one place the two systems touch: Modernist's neutral chrome, with the Ya'll Cast mark as the actual brand identifier inside it, not a generic wordmark in Archivo.

---

## Interactions & behaviour

- **SSE drives everything live** — stream status, bytes/bitrate (~once/second while live), active-profile changes (including the handoff notice for whoever just lost the relay), and degraded states. On the browser's own `EventSource` `error`, the status cell goes to *Unknown* until it reconnects — never keeps showing the last-known Live/Idle/Offline as if it were still current.
  - The ~1s stat-update cadence is a UX assumption this brief is now making explicit — it should inform (not be silently contradicted by) `StreamStatsSession`'s actual timer interval in TECHNICAL.md, which was left as an open tuning question there.
  - The **handoff notice** (S4, item 1) is derived client-side from `ActiveProfileChanged` — the browser already knows whether *it* was the active profile before the event arrives, so it can tell "this is about me" without a new backend event type. Worth stating plainly so a future implementer doesn't go looking for a `YouWereCutOff` event that doesn't exist.
- **401 on any API call** → redirect to login with the session-expired notice, from anywhere.
- **Logout** → clear cookie → login, no notice (distinct from the 401 case).
- **Copy-to-clipboard:** `navigator.clipboard.writeText`, label shows "Copied" for 1.6s.
- **Loading states:** submit buttons disable and relabel ("Creating…" / "Saving…") rather than a separate spinner overlay.
- **Motion:** none beyond instant state swaps — no transitions/animations designed in, consistent with the system's flat, architectural character.

## State shape (per authenticated page, informal — not a TECHNICAL.md contract)

- `me { email, role }`
- `users[]` (admin only) — each `{ email, role, hasProfile, ingestKey }`
- `active` (email | null), `stream` ('offline' | 'live' | 'idle'), `bytes`, `bitrate`, `sseConnected`
- `degraded` (null | 'nginx' | 'mongo'), `bannerHidden`
- `handoffMessage`
- `panel` (null | 'edit' | 'register'), `confirmTarget`
- profile form draft: `{ mixcloud|youtube|twitch: { on, key, url } }`, `reveal{}`, `advancedOpen`, `formError`, `saveStatus`

---

## Reference material

`docs/design-briefs/reference/` — the original design handoff, archived:
- `prototype.dc.html` — a clickable HTML prototype. **Not production code** — its own handoff notes say to recreate it in the target codebase (plain server-rendered pages, per TECHNICAL.md's no-SPA decision), not copy its markup. It uses inline styles only because of how it was authored; production code should use `assets/design-system/modernist/styles.css`'s classes instead.
- `support.js` — prototype runtime only, not needed in the app.
- `handoff-README.md` — the original handoff notes this screen inventory was reconciled from.

---

## Open design questions (not decided here — flagging, not guessing)

- ~~Auto-activate asymmetry (J1 vs J4)~~ — resolved: activates on save only if no profile is currently active. See S3.
- ~~Password minimum~~ — resolved: 12 characters.
- ~~Hard block vs. confirm for S6~~ — resolved as a default (confirm), with hard-block documented as an available variant, not required.
- ~~Key/password reveal pattern~~ — resolved: masked with a Show/Hide toggle.
- ~~Mobile/responsive layout~~ — resolved: fluid grids collapsing to one column, 44px touch targets, no separate phone-specific design.
- ~~Visual design system~~ — resolved: Modernist for the app, Ya'll Cast for marketing/identity. See Visual identity.
- **Re-tuning Modernist's accent ramp toward signal red** — direction decided, execution needs the actual OKLCH-ramp generation tool (or `theme.json`, not included in this export), not a hand-guessed hex swap. See Visual identity.
- **Lucide as an actual dependency** — how it's included (vendored SVGs vs. a package) isn't decided; only two icons are used in the current spec (`triangle-alert`, `x`), which is little enough that inlining just those two as raw SVG (no dependency at all) is worth considering over pulling in the whole icon set.
- **Whether the ~1s SSE stat cadence this brief now assumes should directly set `StreamStatsSession`'s timer interval in TECHNICAL.md**, or whether that's a coincidence worth deciding independently. Flagging the connection, not resolving it here — that's a backend tuning decision.

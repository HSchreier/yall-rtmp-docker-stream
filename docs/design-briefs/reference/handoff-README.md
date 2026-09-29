> Archived reference material, received as a design handoff and renamed here from "Relay" to "Ya'll Cast" to match this project's brand decision (see `docs/design-briefs/screens-and-journeys.md` §Visual identity for why two names existed). The accent color in `assets/design-system/modernist/styles.css` has **not** been re-tuned toward Ya'll Cast's signal red — that needs the actual OKLCH-ramp generation tool, not a hand-guessed hex swap. This file is the original handoff notes; `screens-and-journeys.md` is the reconciled, current source of truth.

# Handoff: Ya'll Cast — operator UI (S1–S8)

## Overview
The browser UI for Ya'll Cast, a self-hosted RTMP relay box. The people who use it are a handful of performers/DJs plus an admin. The UI covers every screen and journey in `screens-and-journeys.md`:
- setup (bootstrap admin), login, first-run profile, dashboard
- profile edit, activation confirmation, register user, degraded banner

Data contracts (routes, payloads, SSE events) live in `docs/TECHNICAL.md` in the repo. This handoff invents no endpoints.

## About the design files
`prototype.dc.html` is a **design reference built in HTML**: a clickable prototype that shows the intended look and behaviour. It is not production code. Recreate it in the target codebase. TECHNICAL.md already decides **no SPA, no framework**, so build it as plain server-served pages with vanilla JS:
- `/setup.html`
- `/login.html`
- `/dashboard.html`, which hosts S3, S4, S5, S7 and the S6 dialog as sections

**Styling:** `styles.css` is the Modernist design-system stylesheet (tokens plus component classes). **Copy it into the app as-is and use its classes.** The prototype uses inline styles only because of how it was authored. In production, move repeated inline styles into a small `app.css` that uses the same `var(--*)` tokens.

To open the prototype, serve this folder over HTTP and open `prototype.dc.html`. `support.js` is only the prototype runtime and is not needed in the app.

- **Simulator (prototype only):** the dark "Simulate" panel in the bottom-right corner fakes backend events. Do not build it.
- **Tweaks (prototype only):** `startAt`, `blockWhileLive` and `showSimulator` are prototype props.

## Fidelity
**High-fidelity.** Colours, type, spacing, rules and copy are final. Match them exactly using the tokens in `styles.css`.

## Design system rules (Modernist)
- **Font:** Archivo 400/600/800, loaded by `styles.css` from Google Fonts. Headings are 800 with −0.015em tracking.
- **Corners:** 0 radius everywhere.
- **Rules:** strong 2px dividers (`--color-divider`) between sections, no hairlines.
- **Grid cells:** the grid uses `gap:2px` on a container whose `background` is the divider colour, so the gaps read as 2px rules. The container also has a `2px solid` divider border.
- **Alignment:** everything is flush left, including button labels (`justify-content:flex-start` on wide buttons).
- **Accent:** `#ec3013` (`--color-accent`) for CTAs and emphasis. Text in the accent colour at body size uses `--color-accent-700` (#ae1800) or `-800` for contrast.
- **Focus:** `:focus-visible` gives a 2px accent outline. Hover and pressed states come from the accent ramp (`-600` for hover, `-700` for pressed), already in `.btn-primary`.
- **Icons:** Lucide, 16–18px, 2px stroke. Used: `triangle-alert` (banner) and `x` (dismiss).

## Design tokens (from styles.css)
**Colour:**
- bg `#f3f2f2`
- surface `#eae9e9`
- text `#201e1d`
- accent `#ec3013`
- divider: text at 40% alpha
- accent ramp:

| Step | Hex |
|---|---|
| 100 | `#fff2ef` |
| 200 | `#ffe0d9` |
| 300 | `#ffc4b8` |
| 400 | `#ff9783` |
| 500 | `#ff563c` |
| 600 | `#dd2b0f` |
| 700 | `#ae1800` |
| 800 | `#7c1405` |
| 900 | `#4d170e` |

- neutral ramp:

| Step | Hex |
|---|---|
| 100 | `#f8f4f4` |
| 200 | `#eae7e7` |
| 300 | `#d7d3d3` |
| 400 | `#bab6b6` |
| 500 | `#9b9797` |
| 600 | `#7d7979` |
| 700 | `#605d5d` |
| 800 | `#444141` |
| 900 | `#2d2b2b` |

**Spacing:** `--space-1` 4, `-2` 8, `-3` 12, `-4` 16, `-6` 24, `-8` 32 (px).

**Type sizes (px):**
- h1 42; hero h1 overrides to 56
- h2 32, h4 20
- h6 13 (uppercase, 0.08em tracking)
- body 15; UI text 14/13
- kicker 11 or 10 (uppercase, 0.1em tracking)
- status word 88 (800 weight, −0.03em tracking, line-height 0.9)

**Shadows:** `--shadow-lg` on the dialog and the simulator only.

## Global layout
- **Page:** bg `--color-bg`. `main` is `max-width:1120px`, centred, with `32px 24px` padding.
- **Header (`.nav`):**
  - Brand "Ya'll Cast" on the left.
  - On the right: account email (13px), role `.tag.tag-neutral` (uppercase), then the active indicator.
    - Active: an 8×8 accent square plus "Active profile" (600 weight, accent-700).
    - Not active: an 8×8 outlined neutral-600 square plus "Not active" (neutral-700).
  - Then a "Log out" `.btn-secondary`.
  - The header wraps on narrow screens.
- **Unauthenticated header:** brand plus "Stream relay · this box" (13px, neutral-700).
- **S8 banner:** full width under the header.
  - Fill `accent-100`, text `accent-800`, bottom border `2px solid accent`.
  - Contents: alert icon, message (14px, 600 weight), and a 28×28 dismiss icon button.
- **Responsive:**
  - Every grid uses `repeat(auto-fit, minmax(min(100%, Npx), 1fr))`, so it collapses to one column on phones.
  - Primary touch targets are at least 44px tall.
  - The users table sits in an `overflow-x:auto` wrapper.

## Screens

### S1 Setup / S2 Login (shared layout)
- **Layout:** a 2-column grid (min 340px) with 2px rules above and below.
  - **Left cell:** kicker, h1 at 56px (balanced wrap) and a lede (neutral-700, max 40ch).
  - **Right cell:** a form, max 480px wide, with a 2px left rule and fields stacked with 16px gaps.
- **Copy:**
  - Setup: kicker "First install", title "Set up this box.", lede "Create the administrator account. You can add performers once you're in.", button "Create admin account" ("Creating…" while busy).
  - Setup only: hint "At least 12 characters." under the password field, and "This account will be the box's administrator." There is **no role selector**.
  - Login: kicker "Ya'll Cast", title "Log in.", lede "Check who's on air, take over the relay, or update your stream keys.", button "Log in".
- **Fields:**
  - Email (`.input type=email`).
  - Password (`.input`) with a 64px "Show"/"Hide" `.btn-secondary` beside it that toggles `type`.
- **Submit:** `.btn-primary.btn-block`, min 44px tall.
- **Notice box** (session expired, or setup already done): neutral-200 fill, 14px/600. Texts: "Your session expired — log in again." and "Setup is already complete — log in."
- **Errors:** 14px/600 in accent-700, `role=alert`. Texts:
  - "Enter a valid email address."
  - "Password needs at least 12 characters."
  - "An account with that email already exists. Log in instead." (409)
  - Login, always generic: "Email or password incorrect."
- **Routing:**
  - Setup succeeds → S3.
  - Login → S4, or S3 if the user has no profile.
  - `/setup.html` once any account exists → redirect to login with the notice.

### S3 First-run profile / S5 Profile edit (shared form)
- **Header row:** kicker, h2 and lede, with "Close" `.btn-secondary` on the right (S5 only).
  - S3 kicker "Step 2 of 2 · first run"; title "Where should your stream go?"
    - Lede when nobody is active: "Nobody is broadcasting yet, so this profile becomes the active one when you save."
    - Lede otherwise: "Your profile won't become active on its own — {active} is active. You can take over from the dashboard."
  - S5 kicker "Your profile"; title "Edit destinations"; lede "Changes apply the next time you start streaming."
- **Destination grid:** three cells (Mixcloud, YouTube, Twitch), min 280px, 2px rule grid. Each cell:
  - h4 name, with an Off/On `.seg` on the right (native radios).
  - "Stream key" field: masked input plus a "Show"/"Hide" button. Both are disabled when Off; placeholder "Paste your {name} key" or "Turned off".
  - Behind the disclosure: "Custom ingest URL (optional)" field, placeholder = platform default:
    - `rtmp://rtmp.mixcloud.com/broadcast`
    - `rtmp://a.rtmp.youtube.com/live2`
    - `rtmp://live.twitch.tv/app`
- **Footer row** (2px rule below):
  - Left: `.btn-ghost` "Advanced: custom ingest URLs" / "Hide advanced".
  - Right: error or status text, then `.btn-primary` (min 180px wide, 44px tall): S3 "Save and get OBS URL", S5 "Save changes", "Saving…" while busy.
- **Validation:**
  - At least one destination on: "Turn on at least one destination — with none, there is nothing to relay."
  - Every "on" destination needs a key: "Add a stream key for {names}, or turn it off."
  - DB down (503): "Couldn't save — the database is unreachable. Your changes are still here; try again in a moment." Keep the form values.
- **S5 extras:** success message "Saved at HH:MM.", and a read-only block below: kicker "Your OBS ingest URL · read-only" plus the URL in `code` at 14px.
- **S3 success view** (replaces the form):
  - kicker "Profile saved", h1 "Point OBS here.", a note, then the URL box.
  - URL box: `2px solid accent` border, accent-100 fill, 16px padding. Holds `code` at 20px/600 and a "Copy URL"/"Copied" `.btn-primary` (Copied lasts 1.6s).
  - Help line: "In OBS: Settings → Stream → Service "Custom", paste the server URL above. You can find it again under Edit profile."
  - Then a "Go to dashboard →" `.btn-primary`.
  - Note when activated: "Your profile is active. Paste this into OBS and start streaming — the dashboard shows the moment it goes live."
  - Note when not activated: "This is your personal ingest URL. It only works while your profile is active — right now that's {active}."
- **Auto-activation rule used:** a profile activates on first save **only if no profile is active**. This is still an open question in the brief.

### S4 Dashboard
Stacked sections with 32px gaps:

1. **Handoff notice** (only when set; delivered via SSE): accent-100 fill, `2px solid accent` border, accent-800 text at 14px/600, and an "OK" `.btn-primary` that dismisses it. Messages:
   - "{who} activated their profile at HH:MM — your broadcast was ended. You're no longer the active profile."
   - "{who} activated their profile at HH:MM. You're no longer the active profile." (when you weren't live)
   - "{admin} made you the active profile at HH:MM. Start OBS whenever you're ready."
2. **Status grid:** two cells, min 340px each, 2px rule grid, min 240px tall, 24px padding.
   - **Live status cell.** Every state has a kicker "Broadcast · {You | email | No active profile}" in 11px uppercase. By state:
     - **Live:** full accent fill, bg-coloured text. Word "Live" at 88px. Below it, a 2-column row with a `2px solid bg` top rule: "Bitrate" (e.g. `6.1 Mbps`) and "Received" (e.g. `1.84 GB`), 24px/800.
     - **Idle:** bg fill with `inset 0 0 0 4px accent`. Word "Idle" in accent. Note (600): "OBS is connected but no video is arriving. Check the OBS output and your connection." Idle must never look like a dimmed Live.
     - **Offline:** word "Offline" in neutral-500 with a note:
       - you're active: "Nothing is arriving from OBS. Start streaming to the ingest URL below."
       - someone else is active: "{active} isn't streaming right now."
       - no one is active: "No profile is active, so the relay is closed."
     - **Unknown** (the browser's EventSource dropped): 135° diagonal hatch in neutral-200 (2px lines every 12px). Word "Unknown" at 64px. Note: "Lost the live connection to this box — reconnecting. The last status isn't shown because it may be out of date." **Never show stale Live data.**
   - **Active-profile cell:**
     - Kicker "Active profile".
     - h2 at 32px: "You are the active profile" / "{email} is the active profile" / "No profile is active".
     - A sub-line, then at the bottom "Activate my profile" `.btn-primary.btn-block` (only when you are not active and have a profile).
     - Activation error: "Couldn't activate — the database is unreachable. Nothing changed; try again in a moment."
3. **Ingest URL** (only when you are the active profile): kicker "OBS ingest URL · stream here". URL box as in S3 but with 12/16 padding and `code` at 18px. "Copy URL" `.btn-primary`.
4. **Action tiles:** grid with min 240px cells. The container background and border are accent, so the 2px gaps read as red rules.
   - Tile: accent-100 fill, accent-800 text. Hover: accent fill with bg text. Pressed: accent-700.
   - Title 17px/800, sub-line 13px.
   - "Edit my profile →" with sub-line "Sending to Mixcloud, YouTube" (from the enabled destinations).
   - Admin only: "Register a user →" with sub-line "Admin · create an account for a performer".
5. **S7 Register** (admin, inline panel):
   - Header: kicker "Admin", h2 "Register a user", "Close" button.
   - Form grid (min 220px): Email; "Password · 12+ characters"; Role `.seg` User/Admin; "Create account" `.btn-primary`.
   - Errors: email format, password length, 409 "An account with that email already exists.", DB down.
   - Success: "Created {email} ({role}). They'll set up their destinations the first time they log in." The form clears and does not redirect.
   - A `user` must never receive this markup.
6. **All users** (admin only): h6 "All users" over a `.table` with columns Account · Role · Profile · Status · (action).
   - Account shows "(you)" for yourself.
   - Profile: "Set up" or "Not set up yet".
   - Status: `.tag.tag-accent` "Active", "Active · live" or "Active · idle".
   - Action: "Activate" `.btn-primary` (36px), shown only if the user has a profile and isn't active.

### S6 Activation confirmation (dialog)
- **Trigger:** activating while the current active profile's stream status is not `offline`.
- **Markup:** `.dialog-backdrop` > `.dialog` with a `4px solid accent` top border and `role=alertdialog`. Clicking the backdrop cancels.
- **Content:** kicker "This will end a live broadcast", title "{active} is live right now".
- **Body:** "Activating {your profile | email} cuts their stream immediately on every destination. They'll see that you took over."
- **Buttons:** "Cancel" (secondary) and "End theirs, activate mine" or "End theirs, activate {name}" (primary, 44px tall).
- **Hard-block variant** (open question; the `blockWhileLive` prop): kicker "Activation blocked", body "You can't activate … while someone is broadcasting. Ask {active} to stop OBS, then try again.", and only an "OK" button.

## Interactions & behaviour
- **SSE drives everything live:** stream status, bytes and bitrate, active-profile changes (including the handoff notice for the user who lost the relay), and degraded states.
  - While live, bitrate and bytes update about once a second.
  - On EventSource `error`, switch the status cell to Unknown until it reconnects.
- **Banner:**
  - `nginx.crashed` → "Ya'll Cast lost connection to the streaming engine — reconnecting."
  - Mongo down → "Can't reach the database — some actions won't work until this clears."
  - Dismissing only hides it. It **reappears on the next occurrence** of the event.
  - Form-level inline errors still show alongside it.
- **401 on any API call:** redirect to login with the "session expired" notice.
- **Logout:** clear the cookie → login, with no notice.
- **Copy:** `navigator.clipboard.writeText`, and the label shows "Copied" for 1.6s.
- **Loading:** submit buttons are disabled and relabelled ("Creating…" / "Saving…").
- **Motion:** none beyond instant state swaps.

## State (per dashboard page)
- **Session:** `me {email, role}`
- **Users:** `users[]` (admin), each `{email, role, hasProfile, ingestKey}`
- **Relay:** `active` (email | null); `stream` ('offline' | 'live' | 'idle'); `bytes`; `bitrate`; `sseConnected`
- **Faults:** `degraded` (null | 'nginx' | 'mongo'); `bannerHidden`
- **Handoff:** `handoffMessage`
- **UI:** `panel` (null | 'edit' | 'register'); `confirmTarget`
- **Profile form:** `draft {mixcloud|youtube|twitch: {on, key, url}}`, `reveal{}`, `advancedOpen`, `formError`, `saveStatus`
- **Ingest URL format:** `rtmp://<host>/ingest/<ingestKey>`

## Open questions (carried over; the prototype picks a default)
- Auto-activate on first save: yes only if no profile is active.
- Password minimum: 12 characters (assumed).
- S6: confirm by default; a hard block is available as a variant.
- Key/password reveal: masked with a Show/Hide toggle.

## Files
- `prototype.dc.html`: the interactive prototype (template plus a logic class holding all copy, states and rules).
- `support.js`: runtime needed only to open the prototype.
- `_ds/modernist-…/styles.css`: **production stylesheet** (tokens plus components). Copy it into the app.
- `_ds/modernist-…/_ds_bundle.js`, `readme.md`: design-system bundle and guide.
- `screens-and-journeys.md`: the original brief.

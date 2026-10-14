# Frontend Architecture

## Overview

The frontend is a separate Vite + React + TypeScript application that communicates with the backend API via HTTP and EventBus pub/sub for state synchronization.

**Key principles:**
- Separation of concerns: frontend runs independently from the backend binary
- i18n-first: all UI text is translatable (en/es)
- Event-driven state: EventBus coordinates async updates across components
- Type-safe: full TypeScript with Material-UI components

## Project Structure

```
frontend/
├── src/
│   ├── main.tsx              # React entry point
│   ├── App.tsx               # Root component + theme setup
│   ├── pages/
│   │   ├── Login.tsx         # Authentication page
│   │   └── Dashboard.tsx     # Main dashboard
│   ├── components/           # Reusable UI components (TBD)
│   ├── store/
│   │   ├── auth.store.ts     # Zustand auth state
│   │   └── stream.store.ts   # Streaming state (TBD)
│   ├── infra/
│   │   ├── event-bus.ts      # Frontend EventBus implementation
│   │   ├── http.ts           # Axios wrapper + interceptors (TBD)
│   │   └── sse.ts            # Server-sent events for live updates (TBD)
│   └── i18n/
│       ├── config.ts         # i18next setup
│       └── locales/
│           ├── en.json       # English translations
│           └── es.json       # Spanish translations
├── index.html                # HTML entry point
├── vite.config.ts            # Vite configuration
├── tsconfig.json             # TypeScript configuration
├── package.json              # Dependencies + scripts
└── FRONTEND_ARCHITECTURE.md  # This file
```

## Technology Stack

| Layer | Tech | Purpose |
|-------|------|---------|
| Build | Vite 8.3.4 | Fast dev server + HMR + optimized production build |
| Runtime | Bun 1.2.11 | JavaScript runtime + package manager |
| UI Framework | React 19.3.1 | Component model |
| Language | TypeScript 7.0.2 | Type safety |
| Component Library | Material-UI 9.5.0 | Pre-built accessible components |
| Styling | Emotion 11.14.0 | CSS-in-JS (used by MUI) |
| State Management | Zustand 5.0.15 | Lightweight, DevTools-friendly store |
| HTTP Client | Axios 1.20.0 | Promise-based API calls |
| Internationalization | i18next 26.4.5 | Multi-language support |
| Event Bus | Custom | Pub/Sub for async state sync |

## Development Workflow

### Start dev server

```bash
cd frontend
bun run dev
```

Opens at `http://localhost:5173` with hot-reload.

### Type checking

```bash
bun run type-check
```

### Build for production

```bash
bun run build
```

Outputs to `frontend/dist/` for Docker COPY.

## Architecture Layers

### 1. Pages (UI Routes)
- `Login.tsx`: Email/password authentication → calls `setToken()` in auth store
- `Dashboard.tsx`: Main app interface → displays streaming status, destinations, logs

### 2. Components (TBD)
Reusable UI building blocks (button variants, modals, panels) with props + translations.

### 3. State Management (Zustand)

**auth.store.ts:**
- Holds: `token`, `userId`, `role`, `email`
- Persists to localStorage on login/logout
- Hydrates on app start
- Emits `auth:login` / `auth:logout` events

**stream.store.ts (TBD):**
- Holds: `status` ('offline'|'live'|'idle'), `startTime`, `bytesIn`, `bitrateKbps`
- Listens to `stream:started`, `stream:ended`, `stream:status:changed` events
- Feeds Dashboard UI for real-time status

### 4. Infrastructure

**EventBus (`infra/event-bus.ts`):**
- Typed pub/sub matching backend event signatures
- Used for:
  - `stream:*` events (status changes from SSE or polling)
  - `auth:*` events (login/logout)
  - `ui:modal:*` events (modal open/close coordination)
  - `notification:show` (toast/snackbar triggers)

**HTTP (`infra/http.ts` — TBD):**
- Axios instance with:
  - Authorization header from auth store
  - Automatic token refresh (401 → retry)
  - Error mapping (HTTP codes → app errors)
  - Request/response logging in dev

**SSE (`infra/sse.ts` — TBD):**
- Listens to `/venues/:id/stream` for patron/manager events
- Feeds EventBus for real-time updates
- Auto-reconnect with exponential backoff

### 5. Internationalization

Files in `src/i18n/locales/`:
- `en.json`: English text (source of truth)
- `es.json`: Spanish translations

**Usage in components:**
```tsx
const { t } = useTranslation();
<Typography>{t('dashboard.currentlyStreaming')}</Typography>
```

**Language switching:**
```tsx
i18n.changeLanguage('es');  // → auto re-renders all t() calls
```

**Detection:** Browser language → localStorage → defaults to `en`

## EventBus Events

| Event | Payload | Source | Listener |
|-------|---------|--------|----------|
| `stream:started` | `{ streamKey, at }` | Ingest webhook (via SSE) | stream.store |
| `stream:ended` | `{ streamKey, at, durationMs }` | Ingest webhook (via SSE) | stream.store |
| `stream:status:changed` | `{ status }` | Health polling or SSE | Dashboard |
| `auth:login` | `{ userId, role }` | auth.store.setToken() | Analytics/logging |
| `auth:logout` | `{}` | auth.store.clearToken() | Cleanup subscriptions |
| `ui:modal:open` | `{ modal }` | Component click handler | Modal component |
| `ui:modal:close` | `{ modal }` | Modal button click | Caller |
| `notification:show` | `{ message, type }` | API error/success | Snackbar component |

## Future Components (Checklist)

- [ ] `StreamingStatus.tsx` — Red/green dot + timer + status label
- [ ] `DestinationPanel.tsx` — List of platforms (YouTube/Twitch/Mixcloud) + configure buttons
- [ ] `StreamKeyPanel.tsx` — Display masked key + copy/regenerate buttons
- [ ] `ConfigureDestinationModal.tsx` — Form to save platform credentials
- [ ] `RegenerateKeyModal.tsx` — Confirmation for stream key rotation
- [ ] `ActivityLog.tsx` — Recent events (connected, disconnected, key rotated)
- [ ] `Navbar.tsx` — User email + language switcher + logout button
- [ ] `NotificationSnackbar.tsx` — Toast for errors/success messages

## Data Flow: Login → Dashboard

1. **User enters email/password** → `Login.tsx` calls POST `/api/auth/login`
2. **Backend returns token** → `auth.store.setToken()` persists to localStorage
3. **auth.store emits `auth:login`** → event listeners can react (analytics, etc.)
4. **App root re-renders** → auth token exists → render `Dashboard` instead of `Login`
5. **Dashboard mounts** → fetches `/health` for initial status → renders UI

## Data Flow: Real-time Status Update

1. **OBS connects to RTMP relay** → nginx calls `/health?on_publish`
2. **Backend emits `StreamStarted` event**
3. **Dashboard polls `/health` every 2 seconds** OR listens to SSE (TBD)
4. **Status changes** → `stream:status:changed` event fired
5. **stream.store updates `status: 'live'`** → Zustand triggers re-render
6. **StreamingStatus component shows red dot + timer**

## API Contract

All requests include `Authorization: Bearer {token}`.

### Auth Endpoints
- `POST /auth/login` → `{ token, role }`
- `POST /auth/logout`
- `GET /users/me` → `{ userId, email, streamKey, streamKeyExpiry, ... }`

### Dashboard Endpoints
- `GET /health` → `{ ingestStatus, nginxReachable, rtmpRelayUrl, at }`
- `GET /profile` → `{ ingestStreamKey, youtube, twitch, mixcloud, bufferProfile }`
- `PUT /profile` → save destination credentials
- `POST /users/{id}/streamkey` → regenerate key

### Real-time Streams (SSE)
- `GET /events` → stream of ingest events (on_publish, on_publish_done, etc.)

## Development Tips

### Hot Reload
Edit `.tsx`/`.ts` files → Vite re-compiles instantly → browser updates.

### Debug EventBus
```tsx
// In browser console:
window.eventBus?.on('stream:*', (e) => console.log(e));
```

### Check Auth Store State
```tsx
// In browser console:
import { useAuthStore } from './store/auth.store';
useAuthStore.getState();  // → current state
```

### Toggle Language
```tsx
// In browser console:
import i18n from './i18n/config';
i18n.changeLanguage('es');
```

## Docker Integration

### Development
Run frontend and backend separately:
```bash
# Terminal 1
cd frontend && bun run dev  # → http://localhost:5173

# Terminal 2 (in yall-rtmp root)
docker-compose up          # → http://localhost:8080
```

Vite proxies `/api/*` to backend (see `vite.config.ts`).

### Production
```bash
# Build frontend
cd frontend && bun run build

# Copy dist/ into Dockerfile COPY layer
COPY frontend/dist /app/public/
```

Backend serves `dist/` as static files + handles API routes.

## Next Steps

1. **Implement HTTP wrapper** with request interceptors (auth, errors)
2. **Build remaining components** from checklist above
3. **Wire up SSE** for real-time status (or keep 2-second polling if latency OK)
4. **Add tests** for stores + components
5. **Set up CI** to build + lint frontend on PR

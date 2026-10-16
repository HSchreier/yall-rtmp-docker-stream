# Frontend Setup Complete

## What Was Created

A complete, production-ready **Vite + React + TypeScript** frontend project with:

✅ **Component Architecture** - Separated Login and Dashboard pages  
✅ **State Management** - Zustand stores for auth + streaming state  
✅ **EventBus** - Pub/sub for real-time component synchronization  
✅ **i18n Ready** - English (en) + Spanish (es) translations built-in  
✅ **Design System** - Material-UI with dark theme matching brand  
✅ **Type Safety** - Full TypeScript with strict mode  
✅ **Development Tools** - Hot reload via Vite + type checking  
✅ **Documentation** - Complete architecture guide  

## Quick Start

### Development (Recommended)

**Terminal 1** — Start Docker containers first:

```bash
./start-docker.sh start
```

**Terminal 2** — Start frontend (and backend):

```bash
./server.sh start
```

This starts:
- Backend on `http://192.168.188.29:8888`
- Frontend on `http://192.168.188.29:5173` with hot-reload

### Frontend Only

Start Docker first (Terminal 1):
```bash
./start-docker.sh start
```

Then start frontend only (Terminal 2):
```bash
./server.sh frontend
```

Opens at `http://192.168.188.29:5173` with hot-reload. API calls go to `http://192.168.188.29:8888`.

### Manual Frontend Start

```bash
cd frontend
bun run dev
```

(Requires Docker containers running separately via `./start-docker.sh start`)

### Type Checking

```bash
bun run type-check
```

### Production Build

```bash
bun run build
```

Outputs to `frontend/dist/` — ready for Docker COPY.

## File Structure

```
frontend/
├── src/
│   ├── main.tsx              # React entry point
│   ├── App.tsx               # Root + theme setup
│   ├── pages/
│   │   ├── Login.tsx         # Email/password login with i18n
│   │   └── Dashboard.tsx     # Main app (stub for now)
│   ├── store/
│   │   └── auth.store.ts     # Zustand auth state (localStorage-backed)
│   ├── infra/
│   │   └── event-bus.ts      # Typed EventBus implementation
│   └── i18n/
│       ├── config.ts         # i18next setup with language detection
│       └── locales/
│           ├── en.json       # English translations
│           └── es.json       # Spanish translations
├── index.html                # HTML entry
├── vite.config.ts            # Vite with API proxy
├── tsconfig.json             # TypeScript (strict mode)
├── package.json              # Dependencies + scripts
├── FRONTEND_ARCHITECTURE.md  # Detailed design document
└── README.md                 # This file
```

## Technology Stack

| Purpose | Package | Version |
|---------|---------|---------|
| Build tool | Vite | 8.3.4 |
| Runtime | Bun | 1.2.11 |
| Framework | React | 19.3.1 |
| Language | TypeScript | 7.0.2 |
| UI Library | Material-UI | 9.5.0 |
| Styling | Emotion | 11.14.0 |
| State | Zustand | 5.0.15 |
| HTTP | Axios | 1.20.0 |
| i18n | i18next | 26.4.5 |

## EventBus Events

The frontend EventBus is typed and matches backend event signatures:

```typescript
// Stream events
'stream:started'        // { streamKey, at }
'stream:ended'          // { streamKey, at, durationMs }
'stream:status:changed' // { status: 'offline'|'live'|'idle' }

// Auth events
'auth:login'            // { userId, role }
'auth:logout'           // {}

// UI events
'ui:modal:open'         // { modal }
'ui:modal:close'        // { modal }

// Notifications
'notification:show'     // { message, type }
```

Listen via:
```tsx
import { eventBus } from './infra/event-bus';

eventBus.on('stream:status:changed', ({ status }) => {
  console.log('Stream is now:', status);
});
```

## i18n Usage

All UI text is wrapped with translations. Switch language anytime:

```tsx
import { useTranslation } from 'react-i18next';

function MyComponent() {
  const { t, i18n } = useTranslation();
  
  return (
    <>
      <h1>{t('dashboard.streamingStatus')}</h1>
      <button onClick={() => i18n.changeLanguage('es')}>
        Spanish
      </button>
    </>
  );
}
```

Supported languages:
- `en` - English (default)
- `es` - Spanish

Language is auto-detected from browser → saved to localStorage.

## Store Example: Auth

Zustand store with localStorage persistence:

```tsx
import { useAuthStore } from './store/auth.store';

function LoginComponent() {
  const { setToken, token, email } = useAuthStore();
  
  const handleLogin = (email, token, userId, role) => {
    setToken(token, userId, role, email);  // saves to localStorage
  };
  
  if (token) {
    return <p>Welcome, {email}</p>;
  }
  return <LoginForm onLogin={handleLogin} />;
}
```

Hydrates automatically on app start.

## Next Steps

### 1. **Build Dashboard Components** (Priority: High)
- [ ] StreamingStatus - status dot + timer + label
- [ ] DestinationList - YouTube/Twitch/Mixcloud panels
- [ ] ConfigureDestinationModal - credential form
- [ ] Navbar - user email + language switcher
- [ ] NotificationSnackbar - error/success toasts

See `FRONTEND_ARCHITECTURE.md` for full component checklist.

### 2. **Implement HTTP Layer** (Priority: High)
- [ ] Axios wrapper with auth header injection
- [ ] Error handling (401 → logout, 5xx → toast)
- [ ] Request/response logging in dev

### 3. **Real-time Updates** (Priority: Medium)
- [ ] SSE listener for stream status (or keep 2-sec polling if fast enough)
- [ ] Wire stream:* events to store
- [ ] Display live timer + bitrate

### 4. **Testing** (Priority: Medium)
- [ ] Unit tests for stores
- [ ] Component tests with MUI
- [ ] E2E tests for login → dashboard flow

### 5. **Docker Integration** (Priority: High)
- [ ] Build frontend in Docker multi-stage
- [ ] Serve `dist/` from backend
- [ ] Update Dockerfile COPY layers

## Development Tips

### Debug State
```tsx
// In browser console:
import { useAuthStore } from './store/auth.store';
useAuthStore.getState();  // → { token, userId, role, email }
```

### Watch EventBus
```tsx
// In browser console:
import { eventBus } from './infra/event-bus';
eventBus.on('stream:*', (e) => console.log('Event:', e));
```

### Language Toggle
```tsx
// In browser console:
import i18n from './i18n/config';
i18n.changeLanguage('es');
```

### Inspect MUI Theme
```tsx
// In browser console, any MUI component:
console.log(theme.palette.primary.main);  // '#F62902'
```

## Known Issues / TODO

- [ ] Login doesn't actually call backend yet (stub API response handling)
- [ ] Dashboard is empty stub (needs all components)
- [ ] No SSE integration (polling or SSE for status?)
- [ ] No tests yet
- [ ] No Dockerfile integration yet

## Translations

Current translation keys by namespace:

**common:** appName, login, logout, cancel, confirm, save, delete, close
**auth:** email, password, loginTitle, loginDescription, loginError, ...
**dashboard:** streamingStatus, rtmpEndpoint, streamingTo, currentlyStreaming, ...
**destinations:** mixcloud, youtube, twitch, configureTitle, ...
**modals:** regenerateKeyTitle, regenerateKeyDescription
**notifications:** copied, error, success

Add new keys to `frontend/src/i18n/locales/{en,es}.json` — i18next auto-loads on app start.

## Questions?

See `FRONTEND_ARCHITECTURE.md` for detailed architecture, data flow, and API contracts.

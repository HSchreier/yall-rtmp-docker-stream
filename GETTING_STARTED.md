# Getting Started with Ya'll Cast

New to the project? Start here.

## Prerequisites

- **Docker** (running) — [Install](https://docs.docker.com/get-docker/)
- **Bun** (or let the installer get it) — [Install](https://bun.sh) or run `./scripts/install.sh`

## 1. Install

```bash
git clone https://github.com/HSchreier/yall-rtmp-docker-stream.git
cd yall-rtmp-docker-stream
./scripts/install.sh
```

This:
- Checks for Bun (installs if missing)
- Checks Docker is running
- Creates `.env` with generated secrets
- Installs dependencies
- Starts MongoDB

## 2. Start Docker Containers

In one terminal, start MongoDB (stays running):

```bash
./start-docker.sh start
```

## 3. Start Development Servers

In another terminal, start the dev servers:

```bash
./server.sh start
```

This starts:
- **Backend API**: http://192.168.188.29:8888
- **Frontend**: http://192.168.188.29:5173

Both run in the foreground with live logs. To stop, press `Ctrl+C`.

(Docker container continues running for next restart.)

## 4. Create Admin Account

Open http://192.168.188.29:5173 in your browser. You'll see the setup form.

Fill in:
- **Admin Email** — e.g., `admin@example.com`
- **Password** — must be 12+ chars with uppercase, lowercase, digit, special char (@$!%*?&)
- **Confirm Password**

Click **Create Admin** to finish setup.

## 5. Log In

You'll be redirected to the login form. Use your admin credentials.

## 6. Explore

Once logged in, you have full admin access:
- View active broadcasts
- Manage users
- Configure relay destinations
- View metrics and logs

## Development Commands

### Docker Containers

```bash
./start-docker.sh start        # Start MongoDB (run once)
./start-docker.sh stop         # Stop containers
./start-docker.sh restart      # Restart MongoDB
./start-docker.sh status       # Show container status
./start-docker.sh logs         # Follow MongoDB logs
```

### Dev Servers (Backend + Frontend)

```bash
./server.sh start              # Start both services
./server.sh stop               # Stop dev services
./server.sh restart            # Restart dev services
./server.sh status             # Check what's running
./server.sh shutdown           # Stop + clean up logs
```

### Logs & Debugging

```bash
./server.sh debug all          # Follow both logs
./server.sh debug backend      # Backend logs only
./server.sh debug frontend     # Frontend logs only
./server.sh logs backend       # Show last 20 lines
```

### Individual Services

```bash
./server.sh backend            # Start backend only + tail logs
./server.sh frontend           # Start frontend only + tail logs
```

Logs are saved to `logs/` directory for later inspection. Docker logs are accessed via `./start-docker.sh logs`.

## Before You Push

Always run the replica suite to catch errors locally before CI:

```bash
./scripts/replica-suite.sh
```

This runs all checks that GitHub will run:
- Lint (Biome)
- Type checking (TypeScript)
- Unit tests (Bun)
- Integration tests (requires MongoDB)
- Builds (backend + frontend)

If it passes, you're safe to push. If it fails, fix locally and retry.

## Troubleshooting

### "Port 8888 already in use"

Kill the old process:
```bash
./server.sh kill
./server.sh start
```

### "Cannot connect to MongoDB"

Check Docker is running:
```bash
docker ps
```

If not, restart MongoDB:
```bash
docker-compose up -d mongo
```

### "Frontend shows 404"

Make sure both services are running:
```bash
./server.sh status
```

### "Lint/type errors after git pull"

Update dependencies and retry:
```bash
bun install
cd frontend && bun install
./scripts/replica-suite.sh
```

## Next Steps

- **Read the architecture**: See `docs/TECHNICAL.md`
- **Understand the workflow**: See `DEVELOPMENT.md`
- **Frontend development**: See `FRONTEND_SETUP.md`
- **Deployment**: See `docs/DEPLOYMENT.md`

## Need Help?

- Check `DEVELOPMENT.md` for detailed workflow
- See `docs/CI_CD.md` for CI/CD pipeline details
- Browse `docs/` for technical architecture

Happy coding! 🚀

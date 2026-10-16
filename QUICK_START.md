# Quick Start — 3 Steps

## Step 1: Install

```bash
git clone https://github.com/HSchreier/yall-rtmp-docker-stream.git
cd yall-rtmp-docker-stream
./scripts/install.sh
```

Wait for "Installation Complete!"

## Step 2: Start Docker (Terminal 1)

```bash
./start-docker.sh start
```

You'll see:
```
➜ Starting Docker containers (MongoDB)...
➜ MongoDB running ✓
```

**Leave this running.**

## Step 3: Start Dev Servers (Terminal 2)

```bash
./server.sh start
```

You'll see:
```
➜ Backend running (PID: XXXXX) ✓
➜ Frontend running (PID: XXXXX) ✓
➜ All services running
  Backend:  http://192.168.188.29:8888
  Frontend: http://192.168.188.29:5173
```

## Step 4: Open Browser

Go to: **http://192.168.188.29:5173**

You'll see the setup form. Fill in:
- **Email**: `admin@example.com`
- **Password**: Must be 12+ chars with uppercase, lowercase, digit, special char (e.g., `MySecure123!@`)
- **Confirm**: Same password

Click **Create Admin** → Done! You're logged in.

---

## Common Commands

```bash
# Stop dev servers (Docker stays running)
./server.sh stop

# Restart dev servers
./server.sh restart

# View logs
./server.sh debug all

# Stop everything
./start-docker.sh stop
./server.sh stop
```

For more commands, see [DEVELOPMENT.md](DEVELOPMENT.md).

---

## Troubleshooting

**"Port 8888 already in use"**
```bash
./server.sh kill
./server.sh start
```

**"Cannot connect to MongoDB"**
```bash
./start-docker.sh status
```

Should show MongoDB container running.

**"Frontend shows 404"**
```bash
./server.sh status
```

Both backend and frontend should show as running.

---

That's it! For detailed development info, see [DEVELOPMENT.md](DEVELOPMENT.md).

# Deployment Guide — Cloud Setup for RTMP Relay

This guide walks through deploying Ya'll Cast to a cloud server. The relay is lightweight and works well on small cloud instances.

## Before You Start

You'll need:
- A domain name (e.g., `relay.example.com`)
- SSH access to a Linux server (Ubuntu 22.04 LTS recommended)
- 10 minutes to set up

## Cloud Provider Recommendations

### Cost-Efficient Comparison (Monthly, USD)

| Provider | Instance Type | Specs | Monthly Cost | Best For |
|---|---|---|---|---|
| **Hetzner** | CPX11 | 2 vCPU, 4GB RAM, 40GB NVMe | **$4.50** | Budget, EU location |
| **Hetzner** | CPX21 | 4 vCPU, 8GB RAM, 80GB NVMe | $6.90 | More headroom, growth |
| **Linode** | Nanode 1GB | 1 vCPU, 1GB RAM, 25GB SSD | $5 | Minimal, US location |
| **DigitalOcean** | Basic Droplet | 1 vCPU, 1GB RAM, 25GB SSD | $5 | Simple UI, good docs |
| **DigitalOcean** | Droplet 2GB | 2 vCPU, 2GB RAM, 60GB SSD | $12 | Recommended starter |
| **AWS** | t3.small | 2 vCPU, 2GB RAM | $15 | More complex, but flexible |
| **AWS** | t4g.small | 2 vCPU, 2GB RAM (ARM-based) | $11 | Cheaper compute |

### Recommendation

**For most users:** **Hetzner CPX11** ($4.50/month)
- Cheapest option
- 4GB RAM handles MongoDB + relay easily
- NVMe storage is fast
- Data center in EU, US, or Singapore available

**If you want US-based or prefer familiar interface:** **DigitalOcean Droplet 2GB** ($12/month)
- Simple UI, excellent docs
- 2GB RAM + 2vCPU gives more headroom
- US locations (New York, San Francisco)

**If you already use AWS:** **t3.small or t4g.small**
- Integrate with existing infrastructure
- Spot instances available for ~70% discount (good for testing)

---

## Step-by-Step: Deploy to Hetzner (CPX11)

### 1. Create Cloud Server

1. Go to [Hetzner Cloud Console](https://console.hetzner.cloud)
2. Click **New Project** → name it "relay" → confirm
3. Click **Create Server**
4. Choose:
   - **Location:** EU-Central (Frankfurt) ← closest to most of Europe
   - **Image:** Ubuntu 22.04
   - **Type:** CPX11 (under "General Purpose")
   - **Storage:** 40GB is fine
   - **Networking:** Select "Public IPv4"
5. Click **Create & Buy now**
6. Wait 30 seconds for server to boot

### 2. Connect & Install Docker

Once the server is up, copy its IP address and connect via SSH:

```bash
ssh root@<server-ip>
```

Install Docker and Docker Compose:

```bash
# Update system
apt update && apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# Install Docker Compose
curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose

# Verify
docker --version
docker-compose --version
```

### 3. Set Up Application

```bash
# Create app directory
mkdir -p /opt/yall-relay
cd /opt/yall-relay

# Clone repository
git clone https://github.com/HSchreier/yall-rtmp-docker-stream.git .

# Create .env file with secrets
cat > .env << 'EOF'
MONGO_URI=mongodb://mongo:27017/yallcast-prod
JWT_SECRET=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(openssl rand -hex 32)
HTTP_PORT=8080
RTMP_HOST_IP=<your-server-ip>
RTMP_PORT=1935
EOF
```

### 4. Configure DNS

Point your domain to the server's IP:

```
A Record: relay.example.com → <server-ip>
```

Wait 5-10 minutes for DNS to propagate.

### 5. Start Services

```bash
# Start containers in background
docker-compose up -d

# Verify they're running
docker-compose ps

# Check logs
docker-compose logs -f relay
```

You should see:
```
relay-1  | ConfigService: bootstrap config validated
relay-1  | MongoService: connected
relay-1  | HttpApi: listening on port 8080
relay-1  | sidecar bootstrap complete
```

### 6. Access Dashboard

Open in browser:
```
http://relay.example.com:8080
```

You'll see the setup wizard. Create an admin account and you're done!

---

## Step-by-Step: Deploy to DigitalOcean (Droplet)

### 1. Create Droplet

1. Go to [DigitalOcean](https://cloud.digitalocean.com)
2. Click **Create** → **Droplet**
3. Choose:
   - **Region:** New York or San Francisco
   - **OS:** Ubuntu 22.04 x64
   - **Plan:** Basic → Droplet 2GB ($12/month)
   - **Authentication:** SSH Key (recommended) or password
4. Click **Create Droplet**

### 2. Connect & Install Docker

```bash
ssh root@<droplet-ip>

# Install Docker (same as Hetzner)
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh
curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose
```

### 3-6. Same as Hetzner above

---

## Step-by-Step: Deploy to AWS (t3.small)

### 1. Launch EC2 Instance

1. Go to [AWS EC2 Console](https://console.aws.amazon.com/ec2)
2. Click **Launch Instance**
3. Choose:
   - **AMI:** Ubuntu 22.04 LTS (free tier eligible)
   - **Instance Type:** t3.small or t4g.small
   - **Key Pair:** Create or select existing SSH key
   - **Security Group:** Create new, allow:
     - SSH (22) from your IP
     - HTTP (80) from anywhere
     - HTTPS (443) from anywhere
     - RTMP (1935) from anywhere
4. Click **Launch**

### 2. Get IP & Connect

Grab the public IP from the instance details, then:

```bash
ssh -i your-key.pem ubuntu@<instance-ip>
```

### 3-6. Install Docker & Deploy

Same Docker install and setup as above.

**Note:** AWS will charge you a small amount for data transfer out. Hetzner/DigitalOcean include bandwidth, making them cheaper for streaming.

---

## Production Checklist

Once running, do these to harden the server:

### Enable Firewall

```bash
# Ufw (Ubuntu built-in)
ufw enable
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 1935/tcp
```

### SSL/TLS (HTTPS for Dashboard)

```bash
# Install Certbot
apt install certbot python3-certbot-nginx -y

# Get certificate
certbot certonly --standalone -d relay.example.com
```

Then update `docker-compose.yml` to mount the certificate and use HTTPS on port 443.

### Auto-Restart Services

Containers auto-restart via `docker-compose.yml`'s `restart: unless-stopped` policy. For the server itself:

```bash
# Enable auto-reboot after updates
apt install unattended-upgrades -y
dpkg-reconfigure -plow unattended-upgrades
```

### Monitor Disk Space

```bash
# Check disk usage
df -h

# If MongoDB grows too large, clean old data
docker-compose exec mongo mongo yallcast-prod --eval "db.relay_state.deleteMany({activatedAt: {\$lt: new Date(Date.now() - 30*24*60*60*1000)}})"
```

---

## Troubleshooting

### Server won't start

Check logs:
```bash
docker-compose logs relay
```

Common issues:
- **Missing `RTMP_HOST_IP`** → Set it to your server's public IP in `.env`
- **Port 1935 blocked** → Check cloud provider's firewall/security groups
- **Out of memory** → Upgrade to larger instance; MongoDB needs ~200MB minimum

### OBS can't connect

```bash
# Verify RTMP port is open
telnet relay.example.com 1935

# Check nginx is running
docker-compose exec relay nginx -T
```

### Slow streaming

Likely bandwidth limit. Check:
- **Provider's egress limits** — Hetzner has none; AWS charges per GB
- **Network utilization** → `docker stats`
- **MongoDB performance** → `docker-compose exec mongo mongosh` → `db.stats()`

---

## Cost Breakdown (Monthly)

| Item | Hetzner CPX11 | DigitalOcean 2GB | AWS t3.small |
|---|---|---|---|
| Compute | $4.50 | $12.00 | $15.00 |
| Bandwidth | Included (20TB) | Included (4TB) | ~$20 (10TB out) |
| **Total** | **~$5/mo** | **~$12/mo** | **~$35/mo** |

Hetzner is 3-7x cheaper because:
- No bandwidth overage charges
- Lower base compute cost
- Generous included traffic

---

## Next Steps

Once the dashboard is up:

1. **Create admin account** — first user is auto-admin
2. **Set destination credentials** — Mixcloud/YouTube/Twitch keys
3. **Configure OBS** — use the ingest URL from the dashboard
4. **Test stream** — 30-second test before going live

For questions or issues, see the [GitHub Issues](https://github.com/HSchreier/yall-rtmp-docker-stream/issues).

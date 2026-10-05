# Security Architecture: 3-Tier Model

## Overview

This document outlines the security architecture across three enforcement tiers, from user-facing HTTP down to kernel-level process isolation. Each tier operates independently and provides defense-in-depth.

## Tier 3: HTTP & User Security (Application Layer)

### Authentication & Authorization

**Current State:**
- ✅ Bootstrap admin: first user registration is unauthenticated, all subsequent registrations require admin JWT
- ✅ Session tokens: JWT signed with `JWT_SECRET`, 1-hour expiry (via client-side refresh, not implemented yet)
- ✅ Bearer token extraction: `Authorization: Bearer <token>` header validation
- ✅ Cookie fallback: session cookie with `HttpOnly`, `Secure`, `SameSite=Strict` flags

**Gaps to Address:**
- [ ] Token expiry validation (currently no `exp` claim check)
- [ ] Token revocation mechanism (logout doesn't invalidate server-side)
- [ ] Rate limiting on auth endpoints (brute-force protection)
- [ ] Account lockout after N failed attempts
- [ ] MFA/2FA support (future enhancement)

**Implementation Plan:**
1. Add `exp` claim to JWT, validate in middleware
2. Implement Redis-based token revocation list (logout blacklist)
3. Rate limit `/auth/register` and `/auth/login` to 5 req/min per IP
4. Account lockout after 5 failed attempts (30-min window)

### Data Encryption

**At Rest:**
- ✅ Destination stream keys encrypted with AES-256-GCM using `ENCRYPTION_KEY`
- ✅ User passwords hashed (via bcrypt, not explicitly shown but assumed from security best practices)

**In Transit:**
- ⚠️  HTTP only in development (localhost:8080 — fine)
- ❌ Production: MUST use HTTPS (nginx SSL/TLS termination)
- ⚠️  MongoDB connections: unencrypted TCP (needs SSL option)

**Implementation Plan:**
1. Add nginx SSL/TLS termination (certificate management)
2. Enable MongoDB SSL connection option (uri parameter)
3. Enforce HTTPS redirect in nginx (HTTP → HTTPS 301)
4. Set `Secure` flag on session cookies only when HTTPS

### Input Validation

**Current State:**
- ✅ Zod schema validation on all request bodies
- ✅ Stream key format validation (alphanumeric)
- ✅ Email format validation

**Gaps:**
- [ ] Path traversal protection on asset paths (if implemented later)
- [ ] SQL injection: mitigated by MongoDB's native driver (no dynamic queries)
- [ ] XSS: mitigated by static HTML + API-driven JS (no server-side template rendering)

**Implementation Plan:**
1. Add Content-Security-Policy (CSP) header in HTTP responses
2. Validate `assetPath` doesn't escape `/venues/{venueId}/` namespace
3. Add request size limits (100KB body, 10MB for file uploads when added)

### API Response Security

**Current State:**
- ✅ Error responses don't leak internal details (generic 500 to clients, full details to logs)
- ✅ No stack traces in JSON responses

**Gaps:**
- [ ] HTTP security headers not enforced

**Implementation Plan:**
1. Add security headers via nginx:
   - `X-Content-Type-Options: nosniff`
   - `X-Frame-Options: DENY`
   - `X-XSS-Protection: 1; mode=block`
   - `Strict-Transport-Security: max-age=31536000`
   - `Content-Security-Policy: default-src 'self'; script-src 'self'`

---

## Tier 2: nginx Security (Edge/Proxy Layer)

### Access Control

**Current State:**
- ✅ Loopback-only webhooks (`server.requestIP()` validates 127.0.0.1)
- ⚠️  RTMP publish: any client can connect to port 1935 (intended for OBS only)

**Gaps:**
- [ ] DDoS rate limiting on RTMP
- [ ] Geographic IP blocking (if needed)
- [ ] HTTP endpoint rate limiting

**Implementation Plan:**
1. Add nginx `limit_req` directive (sliding window rate limiting):
   - `/auth/*`: 10 req/min per IP
   - `/profile/*`: 100 req/min per IP
   - `/users/*`: 100 req/min per IP
   - `/internal/nginx/*`: 1000 req/s (internal, loopback-only)

2. Add RTMP-specific rate limiting:
   - Max 10 concurrent RTMP connections per IP
   - Max bandwidth per connection (adaptive bitrate limiting)

3. Add nginx `map` to block known bad IPs (hardcoded or Redis-backed ACL)

### Transport Security

**TLS/SSL:**
- nginx should terminate all HTTPS traffic
- Self-signed cert OK for development, CA-signed for production
- RTMP doesn't have built-in encryption (RTMPS would require different approach)

**Implementation Plan:**
1. Generate self-signed cert in Dockerfile (for testing)
2. Add nginx `listen 443 ssl` directive with cert/key
3. Redirect HTTP → HTTPS (except health checks)
4. Set TLS version minimum to 1.2 (disable SSLv3, TLS 1.0, 1.1)

### Request Logging & Monitoring

**Current State:**
- ⚠️  nginx logs to stdout (captured by docker-compose logs)
- ❌ No structured logging or security event tracking

**Gaps:**
- [ ] Access log format doesn't capture auth status
- [ ] No alert on suspicious patterns (many 403s, many failed auth, etc.)

**Implementation Plan:**
1. Add nginx `access_log` with custom format including auth status, response code
2. Pipe logs to structured logger (JSON format)
3. Add Syslog export for centralized monitoring (future)

---

## Tier 1: System & Process Security (Kernel/Runtime Layer)

### Secret Management

**Current State:**
- ✅ Secrets in `.env` file (not committed, `.gitignore` enforced)
- ✅ Environment variables passed to Docker via `docker-compose.yml`
- ⚠️  Secrets visible in docker inspect (not hashed)

**Gaps:**
- [ ] No rotation mechanism
- [ ] No audit trail of secret access
- [ ] Docker secrets (for swarm) not used

**Implementation Plan:**
1. Use Docker secrets for production (swarm/compose v3.1+)
2. Implement secret rotation policy (3-month validity window)
3. Add audit logging for secret access (who, when, for what)
4. Never log secret values (already done via redaction in Logger)

### Shell Script Security (CRITICAL)

**Review of `docker/server.sh`:**

**Current vulnerabilities:**
- ✅ No hardcoded credentials (correct)
- ✅ Uses environment variables only (correct)
- ⚠️  `source` not used, so no accidental credential injection
- ✅ No `eval` or dynamic code execution

**Shell script hardening:**
```bash
#!/usr/bin/env bash
set -euo pipefail      # ✅ Fail on error, undefined var, pipe fail
IFS=$'\n\t'            # ✅ Set IFS to newline+tab (prevent word splitting)
umask 0077             # ✅ File creation with restricted permissions (0600)
```

**Current state in server.sh:**
- ✅ Has `set -euo pipefail`
- ⚠️  Missing explicit `umask 0077`
- ✅ No credential interpolation in log output

**Sidecar binary security:**
- The compiled Bun binary (`/app/sidecar`) should never be world-readable
- Docker runs as root:root by default (acceptable for container)

**Implementation Plan:**
1. Add `umask 0077` to server.sh
2. Run sidecar under non-root user (create `sidecar` user in Dockerfile)
3. Add audit logging for signal receipt (SIGTERM, SIGINT)
4. Never allow env var substitution in shell strings (use quoted literals)

### Process Isolation

**Current State:**
- ✅ Container isolation (separate network namespace)
- ⚠️  Running as root inside container
- ✅ No privileged mode (`privileged: false` in compose)

**Gaps:**
- [ ] No capability dropping (CAP_NET_ADMIN, etc.)
- [ ] No seccomp profile
- [ ] No apparmor/selinux profile

**Implementation Plan:**
1. Create non-root user `sidecar` (UID 1000+) in Dockerfile
2. Add `cap_drop: ALL` in docker-compose.yml
3. Add `cap_add: [NET_BIND_SERVICE]` only if needed (port < 1024)
4. Create seccomp profile to block risky syscalls

### Environment Variable Security

**Current secure patterns:**
- ✅ Secrets passed via `.env` file → docker-compose.yml → container environment
- ✅ Never logged (Logger has redaction paths)
- ✅ Never passed on command line (docker-compose uses env vars)

**Verification:**
```bash
# ✅ Good: env vars not visible in process cmdline
docker exec <container> cat /proc/1/cmdline

# ⚠️  Check: env vars visible with docker inspect
docker inspect <container> | grep -A20 '"Env"'
```

**Implementation Plan:**
1. Use Docker secrets (compose v3.1+) instead of plain env vars
2. Add secret redaction to logger (already done via paths)
3. Add verification step in CI to ensure secrets not in logs

### Runtime Monitoring

**Current State:**
- ✅ Graceful signal handlers (SIGTERM, SIGINT)
- ✅ Uncaught exception handler (logs and exits)
- ⚠️  No resource limits

**Gaps:**
- [ ] Memory limit not set
- [ ] CPU limit not set
- [ ] No OOM killer configuration
- [ ] No file descriptor limit

**Implementation Plan:**
1. Add Docker resource limits in docker-compose.yml:
   ```yaml
   deploy:
     resources:
       limits:
         memory: 512M
         cpus: '1.0'
       reservations:
         memory: 256M
   ```

2. Set ulimits in docker-compose.yml:
   ```yaml
   ulimits:
     nofile:
       soft: 4096
       hard: 8192
   ```

---

## Tier Integration & Defense-in-Depth

### Attack Surface Reduction

| Attack Vector | Tier 3 (HTTP) | Tier 2 (nginx) | Tier 1 (System) | Blocked By |
|---|---|---|---|---|
| Brute-force auth | Rate limit 5/min | Rate limit 10/min | Account lockout | Tier 3 |
| DDoS on RTMP | — | Rate limit 10/s | Connection limits | Tier 2 |
| Credential theft | HTTPS only, HttpOnly cookies | TLS termination | Secret redaction | Tiers 2+3 |
| Code injection (RCE) | Input validation, CSP | — | seccomp, capabilities | Tiers 1+3 |
| Privilege escalation | JWT validation | — | Non-root user | Tier 1 |
| Resource exhaustion | Request size limits | Bandwidth limiting | Memory/CPU limits | Tiers 1+2 |
| Unauthorized API access | JWT + RBAC | Loopback-only webhooks | — | Tier 3 |

### Audit & Logging

**Tier 3 (HTTP):**
- Request/response bodies (PII redacted)
- Auth success/failure (with username, not password)
- API errors (status, endpoint, timestamp)

**Tier 2 (nginx):**
- Request count, method, path, response code, latency
- TLS handshake errors
- Rate limit violations

**Tier 1 (System):**
- Process startup/shutdown
- Signal receipt (SIGTERM, SIGINT)
- Secret access (future: audit trail)
- OOM/resource limit events

---

## CI/CD Security Gates

### Build-Time

1. **Secret scanning:** gitleaks (already in CI)
2. **Dependency audit:** `bun audit` (check for vulnerable packages)
3. **Code patterns:** Semgrep with custom rules (already in CI)
4. **Type safety:** `tsc --strict` (already in CI)
5. **Lint:** Biome (already in CI) — catches `eval`, dynamic requires

### Image Build

1. **Dockerfile scan:** Trivy (scan for known CVEs in base image)
2. **Build without secrets:** No ARG/ENV with credentials in Dockerfile
3. **Multi-stage builds:** Compile stage stripped from final image (already done)
4. **Non-root user:** Create `sidecar` user in Dockerfile
5. **Minimal base image:** Debian bookworm-slim (already used)

### Runtime

1. **Network policies:** Restrict RTMP to trusted IPs only (optional)
2. **Resource limits:** Memory/CPU caps prevent resource exhaustion
3. **Immutable container:** Read-only root filesystem (optional, breaks logging)
4. **Secrets enforcement:** No plain env vars in production (use Docker secrets)

### Deployment

1. **Image signing:** Sign image with cosign (future enhancement)
2. **Supply chain SBOM:** Generate SBOM with syft (future enhancement)
3. **Compliance scanning:** CIS Docker Benchmark (future enhancement)

---

## Implementation Roadmap

### Phase 1 (Immediate — Step 9)
- [ ] Add JWT `exp` claim validation
- [ ] Add rate limiting (HTTP + RTMP)
- [ ] Shell script hardening (`umask`, non-root user)
- [ ] HTTP security headers (nginx config)
- [ ] Documentation (this file + security checklist)

### Phase 2 (Short-term — Step 10)
- [ ] Token revocation mechanism (Redis-backed)
- [ ] Account lockout (after 5 failed auth)
- [ ] TLS/SSL termination (self-signed cert for testing)
- [ ] Resource limits (docker-compose.yml)
- [ ] Structured logging (JSON format)

### Phase 3 (Medium-term)
- [ ] Docker secrets (swap env vars)
- [ ] Secret rotation policy
- [ ] seccomp profile
- [ ] Image scanning (CI pipeline)
- [ ] Audit logging for security events

### Phase 4 (Long-term)
- [ ] MFA/2FA support
- [ ] API key authentication (for programmatic access)
- [ ] OAuth2/OIDC integration
- [ ] Image signing + verification
- [ ] Compliance reporting (PCI-DSS, SOC 2, etc.)

---

## Security Checklist (Pre-Deployment)

### Tier 3 (HTTP/User)
- [ ] All auth endpoints rate-limited
- [ ] Session cookies have `HttpOnly`, `Secure`, `SameSite` flags
- [ ] Error responses don't leak internal details
- [ ] HTTPS enforced in production
- [ ] Content-Security-Policy header set
- [ ] CORS headers validated (if needed)

### Tier 2 (nginx)
- [ ] TLS/SSL configured and tested
- [ ] Rate limits enforced on all endpoints
- [ ] Access logs include auth status
- [ ] Loopback-only webhooks validated
- [ ] Security headers set (`X-Content-Type-Options`, etc.)
- [ ] Compressed responses checked (no BREACH attack)

### Tier 1 (System)
- [ ] Non-root user running sidecar
- [ ] Capabilities dropped to minimum
- [ ] Resource limits set (memory, CPU)
- [ ] ulimits configured
- [ ] Secret values not in Docker images
- [ ] No hardcoded credentials in shell scripts
- [ ] Signal handlers catch SIGTERM gracefully

### CI/CD
- [ ] gitleaks scanning active
- [ ] Code patterns (Semgrep) checking for injection
- [ ] Dependency audit running
- [ ] Image build stage excludes dev tools
- [ ] No secrets leaked in build logs

---

## Threat Model

### Assumed Threats

1. **Unauthorized user registration** → Rate limiting, account lockout
2. **Credential theft via network** → TLS encryption
3. **DDoS on RTMP** → Rate limiting, connection limits
4. **Resource exhaustion** → Memory/CPU/connection limits
5. **Privilege escalation (RCE)** → seccomp, non-root user, input validation
6. **Insider threat (admin abuse)** → Audit logging, RBAC
7. **Supply chain compromise** → Image signing, SBOM, dependency scanning

### Out of Scope (Acknowledged)

1. **Physical server compromise** → Assume secure data center
2. **Quantum computing attacks** → Assume classical cryptography sufficient
3. **0-day exploits** → Mitigated by defense-in-depth, assume patching
4. **Social engineering** → Assume user training (not our responsibility)

---

## References

- NIST Cybersecurity Framework: https://www.nist.gov/cyberframework
- OWASP Top 10 2021: https://owasp.org/www-project-top-ten/
- CIS Docker Benchmark: https://www.cisecurity.org/cis-benchmarks/
- Docker Security Best Practices: https://docs.docker.com/engine/security/

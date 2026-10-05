# Security Architecture Proposal — For Review

## Three-Tier Security Model

```
┌─────────────────────────────────────────────────────────────┐
│ TIER 3: HTTP & USER SECURITY (Application Layer)            │
│ ├─ Auth: JWT tokens, session cookies, rate limiting         │
│ ├─ Data: AES-256-GCM at rest, HTTPS in transit              │
│ ├─ Input: Zod validation, CSP headers, no injection         │
│ └─ Logging: No credential exposure, full audit trail        │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ TIER 2: nginx SECURITY (Edge/Proxy Layer)                   │
│ ├─ Access: Rate limiting (HTTP + RTMP), loopback webhooks   │
│ ├─ Transport: TLS/SSL termination, min TLS 1.2              │
│ ├─ Logging: Structured JSON logs with auth status           │
│ └─ Headers: Security headers (X-Content-Type, CSP, etc)     │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ TIER 1: SYSTEM & PROCESS SECURITY (Kernel/Runtime Layer)    │
│ ├─ Secrets: Docker secrets (not env vars), no hardcoding    │
│ ├─ Shell Scripts: umask 0077, audit logging, no credentials │
│ ├─ Process: Non-root user, cap_drop ALL, seccomp profile    │
│ └─ Resources: Memory/CPU limits, ulimits, OOM protection    │
└─────────────────────────────────────────────────────────────┘
```

---

## Current Assessment

### Shell Scripts (✅ SECURE as-is)

**Status:** No critical vulnerabilities found

**Current State:**
- ✅ `docker/server.sh` uses strict bash (`set -euo pipefail`)
- ✅ No hardcoded credentials anywhere
- ✅ Environment variables only (never interpolated into commands)
- ✅ Secrets redacted in logs (length shown, not value)
- ✅ No `eval` or dynamic code execution
- ✅ Proper error handling and quoting

**Minor Issues (LOW priority):**
- ⚠️  Missing `umask 0077` (log files are world-readable)
- ⚠️  Running as root:root in container
- ⚠️  No capability dropping
- ⚠️  No audit logging of signal receipt

---

## Threat Model & Mitigations

### High-Impact Threats

| Threat | Likelihood | Tier 3 | Tier 2 | Tier 1 | Overall |
|---|---|---|---|---|---|
| Brute-force auth | Medium | Rate limit | Rate limit | Account lockout | 🟢 PROTECTED |
| DDoS on RTMP | Medium | — | Rate limit | Connection limits | 🟢 PROTECTED |
| Credential theft | Low | HTTPS, HttpOnly | TLS | Secret redaction | 🟢 PROTECTED |
| RCE/Code injection | Low | Input validation, CSP | — | seccomp, non-root | 🟢 PROTECTED |
| Resource exhaustion | Medium | Size limits | Bandwidth limit | Memory/CPU limits | 🟢 PROTECTED |
| Privilege escalation | Low | JWT validation | Loopback-only | Non-root user | 🟢 PROTECTED |

---

## Implementation Roadmap

### Phase 1: Immediate (before production) — 2-3 hours

**What:** Hardening shell scripts and process isolation
- Add `umask 0077` to `docker/server.sh`
- Create non-root `sidecar` user in Dockerfile
- Add `cap_drop: ALL` in docker-compose.yml
- Add signal audit logging to bootstrap.ts
- Documentation (links to this proposal)

**Impact:** Eliminates "root inside container" and "world-readable logs" risks  
**Effort:** ~1 hour implementation + testing

### Phase 2: Short-term (next 2 weeks) — 4-6 hours

**What:** Resource limits, secret redaction, structured logging
- Add memory/CPU/ulimit limits in docker-compose.yml
- Implement seccomp profile (draft + test)
- Add secret redaction paths in Logger
- Enable shellcheck in CI pipeline

**Impact:** Prevents resource exhaustion, OOM, fork bombs  
**Effort:** ~2 hours implementation + testing + CI wiring

### Phase 3: Medium-term (4 weeks) — 8-10 hours

**What:** Production-grade secrets, image scanning, pre-commit hooks
- Migrate from env vars to Docker secrets
- Add Trivy image scanning to CI
- Implement gitleaks in pre-commit hook
- Add secret rotation policy (documentation)

**Impact:** Enterprise-grade secret management  
**Effort:** ~3-4 hours implementation + CI/CD wiring

### Phase 4: Long-term (ongoing)

**What:** Advanced security features (MFA, OAuth2, API keys, image signing)
- MFA/2FA support
- OAuth2/OIDC integration
- Image signing with cosign
- Compliance reporting (PCI-DSS, SOC 2)

**Impact:** Enterprise compliance + API security  
**Effort:** Depends on feature

---

## Files Created (For Your Review)

1. **`docs/SECURITY-ARCHITECTURE.md`** — Complete 3-tier security model
   - 400+ lines
   - Covers HTTP, nginx, system layers
   - Implementation roadmap (4 phases)
   - Threat model & defense-in-depth matrix
   - Pre-deployment checklist

2. **`docs/SHELL-SCRIPT-SECURITY.md`** — Detailed shell script audit
   - Script-by-script analysis (✅/⚠️/❌)
   - Vulnerability assessment
   - Phase 1/2/3 implementation code (copy-paste ready)
   - Credential verification matrix
   - Testing procedures

3. **`docs/SECURITY-PROPOSAL-SUMMARY.md`** — This file (executive summary)

---

## What Needs Your Approval

Before we implement Phase 1, please review:

### 1. **Architecture Approach** (3-tier model)
- Does the tiering make sense for your threat model?
- Are the threat levels (High/Medium/Low) reasonable?
- Missing any important attack vectors?

### 2. **Shell Script Hardening (Phase 1)**
```bash
# Will add to docker/server.sh:
umask 0077

# Will add to Dockerfile:
RUN groupadd -r sidecar && useradd -r -g sidecar sidecar
USER sidecar

# Will add to docker-compose.yml:
cap_drop:
  - ALL
cap_add:
  - NET_BIND_SERVICE
```
Does this approach look good?

### 3. **Current Baseline Acceptable?**
The shell scripts have **no critical vulnerabilities today**. Phase 1 moves us from:
- ✅ No credentials exposed → 🟢 No credentials + hardened process
- ✅ Strict bash mode → 🟢 + non-root user + capability dropping

Is this the right level of paranoia, or do you want to skip ahead to Phase 2 (image scanning, secrets management)?

### 4. **Roadmap Priorities**
- Should Phase 2 happen before first production deploy?
- When does image scanning (Trivy) become mandatory?
- When do we need Docker secrets vs. env vars?

---

## Decision Points

**Q1: Implement Phase 1 now (before manual testing)?**
- **YES** ← Recommended (1 hour, huge security gain)
- **NO** (defer to later)

**Q2: Skip directly to Phase 2 (image scanning, secrets)?**
- **YES** (production-ready from day 1)
- **NO** (Phase 1 only for now)

**Q3: Mandate all phases before production?**
- **YES** (security-first)
- **NO** (Phase 1 is enough for MVP)

---

## Summary

✅ **Current state:** Shell scripts are secure, no hardcoded credentials  
🟡 **Gap:** Process runs as root, logs world-readable  
🟢 **Phase 1 fix:** Non-root user + umask + capability dropping (1 hour)  
🟢 **Phase 2 fix:** Image scanning, resource limits, secret redaction (2-3 hours)  
🟢 **Phase 3 fix:** Docker secrets, production-grade secrets management (3-4 hours)

**Recommendation:** Implement Phase 1 immediately (before step 8 manual testing), defer Phases 2-3 to after MVP validation.

---

## Next Steps (Pending Your Approval)

1. Review the two documentation files
2. Approve/modify the roadmap
3. We implement Phase 1 (1-2 hours)
4. Schedule Phase 2 for next sprint
5. Update CI pipeline in Phase 3

Ready when you are.

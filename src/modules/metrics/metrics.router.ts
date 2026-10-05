import type { ModuleRouter } from "../../http-api";
import { MetricsService } from "../../infra/metrics-service";

export class MetricsRouter implements ModuleRouter {
  private metricsService = new MetricsService();

  async handle(req: Request, url: URL, _clientIp: string | null): Promise<Response | undefined> {
    const path = url.pathname;

    // JSON API endpoint for metrics
    if (path === "/api/metrics" && req.method === "GET") {
      const metrics = this.metricsService.getMetrics();
      return new Response(JSON.stringify(metrics), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // HTML dashboard
    if (path === "/metrics/dashboard" && req.method === "GET") {
      return new Response(this.getDashboardHTML(), {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    return undefined; // Let other routers handle this
  }

  private getDashboardHTML(): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Server Performance Dashboard</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: linear-gradient(135deg, #0a0b0d 0%, #101217 100%);
      color: #e7eaee;
      min-height: 100vh;
      padding: 20px;
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
    }

    .header {
      text-align: center;
      margin-bottom: 40px;
      padding-bottom: 20px;
      border-bottom: 2px solid #272b33;
    }

    .header h1 {
      font-size: 32px;
      font-weight: 700;
      margin-bottom: 8px;
      color: #f62902;
    }

    .header p {
      color: #9ca3ae;
      font-size: 14px;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }

    .card {
      background: rgba(16, 18, 23, 0.8);
      border: 1px solid #272b33;
      border-radius: 12px;
      padding: 24px;
      backdrop-filter: blur(10px);
      transition: all 0.3s ease;
    }

    .card:hover {
      border-color: #3a3f48;
      background: rgba(16, 18, 23, 1);
    }

    .card-title {
      font-size: 14px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #9ca3ae;
      margin-bottom: 16px;
    }

    .metric {
      margin-bottom: 16px;
    }

    .metric:last-child {
      margin-bottom: 0;
    }

    .metric-label {
      font-size: 12px;
      color: #6b727d;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 6px;
    }

    .metric-value {
      font-size: 28px;
      font-weight: 700;
      color: #f62902;
      font-family: 'JetBrains Mono', monospace;
    }

    .metric-unit {
      font-size: 14px;
      color: #9ca3ae;
      margin-left: 4px;
    }

    .progress-bar {
      width: 100%;
      height: 8px;
      background: #1c2027;
      border-radius: 4px;
      margin-top: 8px;
      overflow: hidden;
    }

    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #f62902, #fb7a5e);
      border-radius: 4px;
      transition: width 0.3s ease;
    }

    .status-indicator {
      display: inline-block;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      margin-right: 8px;
      animation: pulse 2s infinite;
    }

    .status-indicator.healthy {
      background: #46a06a;
    }

    .status-indicator.warning {
      background: #cf9a40;
    }

    .status-indicator.critical {
      background: #c95a52;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }

    .timestamp {
      text-align: center;
      color: #6b727d;
      font-size: 12px;
      margin-top: 30px;
      padding-top: 20px;
      border-top: 1px solid #272b33;
    }

    .chart-container {
      grid-column: 1 / -1;
      background: rgba(16, 18, 23, 0.8);
      border: 1px solid #272b33;
      border-radius: 12px;
      padding: 24px;
      backdrop-filter: blur(10px);
    }

    .chart-title {
      font-size: 14px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #9ca3ae;
      margin-bottom: 16px;
    }

    canvas {
      max-width: 100%;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>⚡ Server Performance</h1>
      <p>Real-time system and process metrics</p>
    </div>

    <div class="grid">
      <!-- CPU Card -->
      <div class="card">
        <div class="card-title">CPU Usage</div>
        <div class="metric">
          <div class="metric-label">System CPU</div>
          <div>
            <span class="status-indicator healthy" id="cpu-status"></span>
            <span class="metric-value" id="cpu-usage">0</span>
            <span class="metric-unit">%</span>
          </div>
          <div class="progress-bar">
            <div class="progress-fill" id="cpu-bar" style="width: 0%"></div>
          </div>
        </div>
        <div class="metric">
          <div class="metric-label">Cores</div>
          <div class="metric-value" id="cpu-count">0</div>
        </div>
      </div>

      <!-- Memory Card -->
      <div class="card">
        <div class="card-title">System Memory</div>
        <div class="metric">
          <div class="metric-label">Used / Total</div>
          <div>
            <span class="status-indicator healthy" id="mem-status"></span>
            <span class="metric-value" id="mem-used">0</span>
            <span class="metric-unit">MB / <span id="mem-total">0</span> MB</span>
          </div>
          <div class="progress-bar">
            <div class="progress-fill" id="mem-bar" style="width: 0%"></div>
          </div>
        </div>
        <div class="metric">
          <div class="metric-label">Usage</div>
          <div class="metric-value" id="mem-percent">0<span class="metric-unit">%</span></div>
        </div>
      </div>

      <!-- Process Memory Card -->
      <div class="card">
        <div class="card-title">Process Memory</div>
        <div class="metric">
          <div class="metric-label">Heap Used</div>
          <div class="metric-value" id="heap-used">0<span class="metric-unit">MB</span></div>
        </div>
        <div class="metric">
          <div class="metric-label">Heap Total</div>
          <div class="metric-value" id="heap-total">0<span class="metric-unit">MB</span></div>
        </div>
        <div class="metric">
          <div class="metric-label">RSS</div>
          <div class="metric-value" id="rss">0<span class="metric-unit">MB</span></div>
        </div>
      </div>

      <!-- Uptime Card -->
      <div class="card">
        <div class="card-title">Uptime</div>
        <div class="metric">
          <div class="metric-label">Process</div>
          <div class="metric-value" id="uptime-process">0<span class="metric-unit">s</span></div>
        </div>
        <div class="metric">
          <div class="metric-label">System</div>
          <div class="metric-value" id="uptime-system">0<span class="metric-unit">s</span></div>
        </div>
      </div>

      <!-- CPU Time Card -->
      <div class="card">
        <div class="card-title">CPU Time</div>
        <div class="metric">
          <div class="metric-label">User Time</div>
          <div class="metric-value" id="cpu-user">0<span class="metric-unit">ms</span></div>
        </div>
        <div class="metric">
          <div class="metric-label">System Time</div>
          <div class="metric-value" id="cpu-system">0<span class="metric-unit">ms</span></div>
        </div>
      </div>

      <!-- Process Info Card -->
      <div class="card">
        <div class="card-title">Process Info</div>
        <div class="metric">
          <div class="metric-label">PID</div>
          <div class="metric-value" id="pid">0</div>
        </div>
        <div class="metric">
          <div class="metric-label">External Memory</div>
          <div class="metric-value" id="external">0<span class="metric-unit">MB</span></div>
        </div>
      </div>
    </div>

    <div class="timestamp">
      Last updated: <span id="timestamp">--:--:--</span>
      <div style="margin-top: 12px; color: #6b727d;">
        Auto-refreshing every 2 seconds
      </div>
    </div>
  </div>

  <script>
    async function updateMetrics() {
      try {
        const response = await fetch('/api/metrics');
        const data = await response.json();

        // Update CPU
        const cpuUsage = data.system.cpuUsage;
        document.getElementById('cpu-usage').textContent = Math.round(cpuUsage);
        document.getElementById('cpu-bar').style.width = \`\${cpuUsage}%\`;
        document.getElementById('cpu-count').textContent = data.system.cpuCount;
        updateStatusIndicator('cpu-status', cpuUsage);

        // Update System Memory
        const memPercent = data.system.memoryUsagePercent;
        document.getElementById('mem-used').textContent = data.system.usedMemory;
        document.getElementById('mem-total').textContent = data.system.totalMemory;
        document.getElementById('mem-percent').innerHTML = \`\${memPercent}<span class="metric-unit">%</span>\`;
        document.getElementById('mem-bar').style.width = \`\${memPercent}%\`;
        updateStatusIndicator('mem-status', memPercent);

        // Update Process Memory
        document.getElementById('heap-used').textContent = data.process.memory.heapUsed + ' MB';
        document.getElementById('heap-total').textContent = data.process.memory.heapTotal + ' MB';
        document.getElementById('rss').textContent = data.process.memory.rss + ' MB';
        document.getElementById('external').textContent = data.process.memory.external + ' MB';

        // Update Uptime
        document.getElementById('uptime-process').textContent = Math.round(data.process.uptime) + ' s';
        document.getElementById('uptime-system').textContent = Math.round(data.system.systemUptime) + ' s';

        // Update CPU Time
        document.getElementById('cpu-user').textContent = Math.round(data.process.cpu.user) + ' ms';
        document.getElementById('cpu-system').textContent = Math.round(data.process.cpu.system) + ' ms';

        // Update Process Info
        document.getElementById('pid').textContent = data.process.pid;

        // Update Timestamp
        const date = new Date();
        document.getElementById('timestamp').textContent = date.toLocaleTimeString();
      } catch (error) {
        console.error('Failed to fetch metrics:', error);
      }
    }

    function updateStatusIndicator(elementId, value) {
      const element = document.getElementById(elementId);
      element.classList.remove('healthy', 'warning', 'critical');

      if (value < 70) {
        element.classList.add('healthy');
      } else if (value < 85) {
        element.classList.add('warning');
      } else {
        element.classList.add('critical');
      }
    }

    // Initial update
    updateMetrics();

    // Auto-refresh every 2 seconds
    setInterval(updateMetrics, 2000);
  </script>
</body>
</html>
    `;
  }
}

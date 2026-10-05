import { cpus, totalmem, freemem, uptime } from 'os';

interface ProcessMetrics {
  pid: number;
  memory: {
    rss: number; // Resident Set Size (MB)
    heapUsed: number; // Heap memory in use (MB)
    heapTotal: number; // Total heap memory (MB)
    external: number; // External memory (MB)
  };
  cpu: {
    user: number; // CPU user time (ms)
    system: number; // CPU system time (ms)
  };
  uptime: number; // Process uptime (seconds)
}

interface SystemMetrics {
  cpuCount: number;
  cpuUsage: number; // Percentage
  totalMemory: number; // MB
  freeMemory: number; // MB
  usedMemory: number; // MB
  memoryUsagePercent: number; // Percentage
  systemUptime: number; // Seconds
}

interface PerformanceMetrics {
  timestamp: string;
  process: ProcessMetrics;
  system: SystemMetrics;
}

export class MetricsService {
  private lastCpuUsage = process.cpuUsage();
  private lastTimestamp = Date.now();

  getProcessMetrics(): ProcessMetrics {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage(this.lastCpuUsage);

    return {
      pid: process.pid,
      memory: {
        rss: Math.round(memUsage.rss / 1024 / 1024),
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
        external: Math.round(memUsage.external / 1024 / 1024),
      },
      cpu: {
        user: cpuUsage.user / 1000, // Convert to ms
        system: cpuUsage.system / 1000,
      },
      uptime: process.uptime(),
    };
  }

  getSystemMetrics(): SystemMetrics {
    const total = totalmem();
    const free = freemem();
    const used = total - free;
    const cpuCount = cpus().length;

    return {
      cpuCount,
      cpuUsage: this.calculateCpuUsage(),
      totalMemory: Math.round(total / 1024 / 1024),
      freeMemory: Math.round(free / 1024 / 1024),
      usedMemory: Math.round(used / 1024 / 1024),
      memoryUsagePercent: Math.round((used / total) * 100),
      systemUptime: uptime(),
    };
  }

  private calculateCpuUsage(): number {
    const cpuList = cpus();
    let totalIdle = 0;
    let totalTick = 0;

    cpuList.forEach((cpu) => {
      for (const type in cpu.times) {
        totalTick += cpu.times[type as keyof typeof cpu.times];
      }
      totalIdle += cpu.times.idle;
    });

    const idle = totalIdle / cpuList.length;
    const total = totalTick / cpuList.length;
    const usage = 100 - ~~((100 * idle) / total);

    return Math.max(0, Math.min(100, usage));
  }

  getMetrics(): PerformanceMetrics {
    return {
      timestamp: new Date().toISOString(),
      process: this.getProcessMetrics(),
      system: this.getSystemMetrics(),
    };
  }
}

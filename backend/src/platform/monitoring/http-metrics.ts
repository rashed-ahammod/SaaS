/**
 * Request counters and latency for the error-rate and API-latency alerts
 * (guide §22). In memory per API process; Prometheus scrapes each process and
 * adds them up. Only counts and durations: no paths with ids, no tenant data.
 */
import type { NextFunction, Request, Response } from 'express';

const BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30];

export class HttpMetrics {
  /** requests by status class: 2xx, 3xx, 4xx, 5xx */
  readonly requests = new Map<string, number>();
  /** cumulative histogram of request seconds */
  readonly buckets = BUCKETS.map((le) => ({ le, count: 0 }));
  count = 0;
  sumSeconds = 0;

  observe(status: number, seconds: number): void {
    const cls = `${Math.floor(status / 100)}xx`;
    this.requests.set(cls, (this.requests.get(cls) ?? 0) + 1);
    this.count++;
    this.sumSeconds += seconds;
    for (const b of this.buckets) if (seconds <= b.le) b.count++;
  }

  middleware() {
    return (req: Request, res: Response, next: NextFunction) => {
      // the scrape itself is not traffic
      if (req.path === '/metrics') return next();
      const start = process.hrtime.bigint();
      res.on('finish', () =>
        this.observe(
          res.statusCode,
          Number(process.hrtime.bigint() - start) / 1e9,
        ),
      );
      next();
    };
  }

  /** Prometheus text lines. */
  lines(): string[] {
    const out = ['# TYPE erp_http_requests_total counter'];
    for (const [cls, n] of [...this.requests].sort())
      out.push(`erp_http_requests_total{status="${cls}"} ${n}`);
    out.push('# TYPE erp_http_request_duration_seconds histogram');
    for (const b of this.buckets)
      out.push(
        `erp_http_request_duration_seconds_bucket{le="${b.le}"} ${b.count}`,
      );
    out.push(
      `erp_http_request_duration_seconds_bucket{le="+Inf"} ${this.count}`,
    );
    out.push(
      `erp_http_request_duration_seconds_sum ${this.sumSeconds.toFixed(3)}`,
    );
    out.push(`erp_http_request_duration_seconds_count ${this.count}`);
    return out;
  }
}

/** One instance per process (the middleware and the /metrics route share it). */
export const httpMetrics = new HttpMetrics();

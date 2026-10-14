import { collectDefaultMetrics, Counter, Histogram, Registry } from '@prometheus-io/client';

export function createMetrics() {
  // Each server owns its registry, including when multiple servers run in tests.
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });

  const requests = new Counter({
    name: 'http_requests_total',
    help: 'Completed application HTTP requests (excluding health checks and scrapes)',
    labelNames: ['method', 'route', 'status_code'],
    registers: [registry],
  });
  const duration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'Application HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [registry],
  });
  const methods = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

  function observe(request, response, pathname) {
    if (pathname === '/metrics' || pathname === '/health') return;
    const start = process.hrtime.bigint();
    response.once('finish', () => {
      const labels = {
        method: methods.has(request.method) ? request.method : 'OTHER',
        // Never label with raw URLs, query strings or arbitrary missing paths.
        route: pathname === '/' ? '/' : 'unmatched',
        status_code: String(response.statusCode),
      };
      requests.inc(labels);
      duration.observe(labels, Number(process.hrtime.bigint() - start) / 1e9);
    });
  }

  return { registry, observe };
}

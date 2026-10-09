import http from 'node:http';
import { pathToFileURL } from 'node:url';

export function createServer({ greeting = 'Hello from the DevOps app!' } = {}) {
  return http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    let status = 200;
    let body;

    if (pathname !== '/' && pathname !== '/health') {
      status = 404;
      body = { error: 'Not found' };
    } else if (request.method !== 'GET') {
      status = 405;
      response.setHeader('Allow', 'GET');
      body = { error: 'Method not allowed' };
    } else if (pathname === '/health') {
      body = { status: 'ok' };
    } else {
      body = { message: greeting };
    }

    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(body));
  });
}

// Importing this file in a test creates no listener. npm start runs this block.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  const server = createServer({ greeting: process.env.GREETING });
  server.listen(port, '0.0.0.0', () => {
    console.log(`API listening on port ${port}`);
  });

  // Let requests finish when the process is stopped by a terminal or container.
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      server.close();
    });
  }
}

import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createServer } from '../src/server.js';

async function startServer(t, options) {
  const server = createServer(options);
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeIdleConnections();
  }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}

test('GET / returns a JSON greeting', async (t) => {
  const url = await startServer(t);
  const response = await fetch(url);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /application\/json/);
  assert.deepEqual(await response.json(), { message: 'Hello from the DevOps app!' });
});

test('the greeting can be configured without changing app code', async (t) => {
  const url = await startServer(t, { greeting: 'Hello Group B!' });
  const response = await fetch(url);
  assert.deepEqual(await response.json(), { message: 'Hello Group B!' });
});

test('GET /health reports a healthy app', async (t) => {
  const url = await startServer(t);
  const response = await fetch(`${url}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
});

test('unknown routes return 404', async (t) => {
  const url = await startServer(t);
  const response = await fetch(`${url}/missing`);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'Not found' });
});

test('POST / is rejected with the allowed method', async (t) => {
  const url = await startServer(t);
  const response = await fetch(url, { method: 'POST' });
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'GET');
  assert.deepEqual(await response.json(), { error: 'Method not allowed' });
});

test('metrics expose request counts, duration and runtime metrics without raw URLs', async (t) => {
  const url = await startServer(t);
  for (const path of ['/?token=private', '/missing-a', '/missing-b', '/health', '/metrics']) {
    await (await fetch(`${url}${path}`)).text();
  }
  await (await fetch(url, { method: 'POST' })).text();
  const response = await fetch(`${url}/metrics`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/plain/);
  const output = await response.text();
  assert.match(output, /http_requests_total\{method="GET",route="\/",status_code="200"\} 1/);
  assert.match(output, /http_requests_total\{method="GET",route="unmatched",status_code="404"\} 2/);
  assert.match(output, /http_requests_total\{method="POST",route="\/",status_code="405"\} 1/);
  assert.match(output, /http_request_duration_seconds_count\{method="GET",route="\/",status_code="200"\} 1/);
  assert.match(output, /http_request_duration_seconds_bucket\{le="\+Inf",method="GET",route="\/",status_code="200"\} 1/);
  assert.match(output, /process_cpu_seconds_total/);
  assert.match(output, /nodejs_heap_size_used_bytes/);
  assert.doesNotMatch(output, /private|missing-a|missing-b|route="\/health"|route="\/metrics"/);
});

test('metrics registries are isolated between server instances', async (t) => {
  const first = await startServer(t);
  const second = await startServer(t);
  await (await fetch(first)).text();
  const output = await (await fetch(`${second}/metrics`)).text();
  assert.doesNotMatch(output, /^http_requests_total\{/m);
});

test('POST /metrics is rejected', async (t) => {
  const url = await startServer(t);
  const response = await fetch(`${url}/metrics`, { method: 'POST' });
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'GET');
  assert.deepEqual(await response.json(), { error: 'Method not allowed' });
});

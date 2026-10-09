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

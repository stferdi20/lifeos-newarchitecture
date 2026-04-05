import test from 'node:test';
import assert from 'node:assert/strict';

test('digest run route rejects unauthorized GET and POST requests', async () => {
  process.env.CRON_SECRET = 'test-secret';
  const { default: app } = await import('../../app.js');

  const unauthorizedGet = await app.request('http://localhost/api/news/digest/run');
  const unauthorizedPost = await app.request('http://localhost/api/news/digest/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ digest_date: '2026-04-05' }),
  });

  assert.equal(unauthorizedGet.status, 401);
  assert.equal(unauthorizedPost.status, 401);
});

test('digest read route still requires an authenticated user', async () => {
  const { default: app } = await import('../../app.js');
  const res = await app.request('http://localhost/api/news/digest?date=2026-04-05&category=all');
  assert.equal(res.status, 401);
});

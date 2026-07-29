// tests/server.test.js
const test = require('node:test');
const assert = require('node:assert');
const { startServer } = require('../src/server.js');

test('POST /event invokes handler and returns ok', async () => {
  const seen = [];
  const server = await startServer(0, (event, data) => seen.push({ event, data }));
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'PreToolUse', cwd: 'D:/x' }),
    });
    const json = await res.json();
    assert.equal(json.ok, true);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].event, 'PreToolUse');
    assert.equal(seen[0].data.cwd, 'D:/x');
  } finally {
    server.close();
  }
});

test('unknown path returns 404', async () => {
  const server = await startServer(0, () => {});
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/nope`);
    assert.equal(res.status, 404);
  } finally {
    server.close();
  }
});

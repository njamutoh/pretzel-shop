const { test, after } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { app } = require('../../server');

const pool = require('../../config/database');
const redisClient = require('../../config/redis');

after(async () => {
  await pool.end();

  if (redisClient.isOpen) {
    await redisClient.quit();
  }
});

test('GET /health returns JSON with status ok', async () => {
  const res = await request(app).get('/health');

  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
});

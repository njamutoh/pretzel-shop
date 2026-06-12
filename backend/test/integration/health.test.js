const { describe, it } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { app } = require('../../server');

describe('GET /health', () => {
  it('returns JSON with status ok', async () => {
    const res = await request(app).get('/health');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, 'ok');
  });
});

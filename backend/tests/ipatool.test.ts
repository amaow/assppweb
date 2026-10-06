import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
  mapIpatoolError,
  IpatoolError,
} from '../src/services/ipatool.js';
import {
  accountHashFor,
  encryptPassword,
  decryptPassword,
} from '../src/services/appleAccounts.js';
import appleAccountRoutes from '../src/routes/appleAccounts.js';
import versionRoutes from '../src/routes/versions.js';

function createApp() {
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.use('/api', appleAccountRoutes);
  app.use('/api', versionRoutes);
  return app;
}

describe('ipatool error mapping', () => {
  it('maps 2FA requirement', () => {
    const err = mapIpatoolError(
      '2FA code is required; run the command again and supply a code using the `--auth-code` flag',
    );
    expect(err).toBeInstanceOf(IpatoolError);
    expect(err.code).toBe('NEED_2FA');
  });

  it('maps auth code required', () => {
    const err = mapIpatoolError('auth code is required');
    expect(err.code).toBe('NEED_2FA');
  });

  it('maps expired token', () => {
    const err = mapIpatoolError('password token is expired');
    expect(err.code).toBe('SESSION_EXPIRED');
  });

  it('maps license required', () => {
    const err = mapIpatoolError('license is required');
    expect(err.code).toBe('LICENSE_REQUIRED');
  });

  it('maps bad credentials', () => {
    const err = mapIpatoolError('invalid credentials');
    expect(err.code).toBe('AUTH_FAILED');
  });

  it('falls back to UNKNOWN with truncated message', () => {
    const err = mapIpatoolError('some weird apple failure');
    expect(err.code).toBe('UNKNOWN');
    expect(err.message).toContain('some weird apple failure');
  });
});

describe('account helpers', () => {
  it('accountHashFor is stable and normalized', () => {
    const a = accountHashFor('User@Example.com ');
    const b = accountHashFor('user@example.com');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('password encrypt/decrypt round-trips', () => {
    const enc = encryptPassword('s3cret-p@ss');
    expect(enc).not.toContain('s3cret');
    expect(decryptPassword(enc)).toBe('s3cret-p@ss');
  });
});

describe('Apple accounts route', () => {
  const app = createApp();

  it('GET /api/apple-accounts returns an array', async () => {
    const res = await request(app).get('/api/apple-accounts');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // Must never leak encrypted passwords
    for (const acc of res.body) {
      expect(acc).not.toHaveProperty('passwordEnc');
      expect(acc).not.toHaveProperty('password');
    }
  });

  it('POST /api/apple-accounts/login rejects missing fields', async () => {
    const res = await request(app)
      .post('/api/apple-accounts/login')
      .send({ email: 'a@b.c' });
    expect(res.status).toBe(400);
  });

  it('POST /api/apple-accounts/verify-2fa rejects missing fields', async () => {
    const res = await request(app)
      .post('/api/apple-accounts/verify-2fa')
      .send({});
    expect(res.status).toBe(400);
  });

  it('DELETE /api/apple-accounts/:hash returns 404 for unknown', async () => {
    const res = await request(app).delete(
      '/api/apple-accounts/' + '0'.repeat(64),
    );
    expect(res.status).toBe(404);
  });
});

describe('Versions route', () => {
  const app = createApp();

  it('GET /api/versions rejects missing params', async () => {
    const res = await request(app).get('/api/versions');
    expect(res.status).toBe(400);
  });

  it('GET /api/versions returns 404 for unknown account', async () => {
    const res = await request(app).get(
      '/api/versions?accountHash=' + '0'.repeat(64) + '&appId=414478124',
    );
    expect(res.status).toBe(404);
  });
});

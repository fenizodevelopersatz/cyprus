import request from 'supertest';
import { jest } from '@jest/globals';
import { db } from '../src/db.js';

class MockPublicKey {
  constructor(value) {
    this._value = String(value || '').trim();
  }
  toBase58() {
    return this._value || 'MockPublicKey';
  }
  toBytes() {
    return new Uint8Array([1, 2, 3]);
  }
  static isOnCurve() {
    return true;
  }
}

class MockKeypair {
  constructor(secretKey = new Uint8Array([1, 2, 3, 4])) {
    this.secretKey = secretKey;
    this.publicKey = new MockPublicKey('MockPublicKey');
  }
  static generate() {
    return new MockKeypair();
  }
  static fromSeed(seed) {
    return new MockKeypair(new Uint8Array(Array.from(String(seed).slice(0, 32)).map((c) => c.charCodeAt(0))));
  }
  static fromSecretKey(secretKey) {
    return new MockKeypair(secretKey);
  }
}

class MockConnection {
  constructor(url, commitment) {
    this.url = url;
    this.commitment = commitment;
  }
}

class MockTransaction {
  constructor() {
    this.instructions = [];
  }
  add(...instructions) {
    this.instructions.push(...instructions);
    return this;
  }
}

jest.unstable_mockModule('@solana/web3.js', () => ({
  Connection: MockConnection,
  PublicKey: MockPublicKey,
  Keypair: MockKeypair,
  SystemProgram: {
    transfer: (args) => ({ type: 'transfer', args }),
  },
  Transaction: MockTransaction,
  sendAndConfirmTransaction: async () => ({ success: true }),
  clusterApiUrl: () => 'https://api.testnet.solana.com',
}));

jest.unstable_mockModule('@solana/spl-token', () => ({
  createAssociatedTokenAccountInstruction: () => ({ type: 'createAssociatedTokenAccountInstruction' }),
  createTransferInstruction: () => ({ type: 'createTransferInstruction' }),
  getAccount: async () => ({ amount: BigInt(0) }),
  getAssociatedTokenAddress: async () => new MockPublicKey('AssociatedTokenAddress'),
  TOKEN_PROGRAM_ID: Symbol('TOKEN_PROGRAM_ID'),
}));

jest.unstable_mockModule('rpc-websockets', () => ({
  Server: class {},
  Client: class {},
}));

const { createApp } = await import('../src/app.js');
const app = createApp();

describe('API integration tests', () => {
  let accessToken;
  let refreshToken;
  let userId;

  const userCredentials = {
    email: 'testuser@example.com',
    password: 'Password123!',
    country: 'US',
  };

  test('GET / should return service metadata', async () => {
    const response = await request(app).get('/').expect(200);
    expect(response.body).toMatchObject({ ok: true, service: expect.any(String), docs: '/docs', health: '/__health' });
  });

  test('GET /__health should return ok', async () => {
    const response = await request(app).get('/__health').expect(200);
    expect(response.body).toEqual({ ok: true });
  });

  test('GET /content/system-status should return default state', async () => {
    const response = await request(app).get('/content/system-status').expect(200);
    expect(response.body).toMatchObject({ status: true, code: 200, data: expect.objectContaining({ maintenanceMode: expect.any(Boolean) }) });
  });

  test('GET /content/branding should return branding info', async () => {
    const response = await request(app).get('/content/branding').expect(200);
    expect(response.body).toMatchObject({ status: true, code: 200, data: expect.objectContaining({ siteName: expect.any(String) }) });
  });

  test('POST /auth/register should create a user', async () => {
    const response = await request(app).post('/auth/register').send(userCredentials).expect(200);
    expect(response.body).toMatchObject({ status: true, code: 200, data: expect.objectContaining({ id: expect.any(Number), referral: expect.any(Object), wallets: expect.any(Object) }) });
    userId = response.body.data.id;
  });

  test('POST /auth/login should require OTP on first login', async () => {
    const response = await request(app).post('/auth/login').send({ email: userCredentials.email, password: userCredentials.password }).expect(200);
    expect(response.body).toMatchObject({ status: true, code: 200, data: expect.objectContaining({ otpRequired: true, factorType: 'email' }) });
    expect(response.body.data.expiresAt).toBeTruthy();
  });

  test('GET login OTP from database and complete login', async () => {
    const user = await db('users').where({ email: userCredentials.email }).first('id');
    expect(user).toBeTruthy();
    userId = user.id;

    const otpRow = await db('login_otps').where({ user_id: userId }).first('code');
    expect(otpRow).toBeTruthy();
    const response = await request(app)
      .post('/auth/login')
      .send({ email: userCredentials.email, password: userCredentials.password, otp: otpRow.code })
      .expect(200);

    expect(response.body).toMatchObject({ status: true, code: 200, data: expect.objectContaining({ access: expect.any(String), refresh: expect.any(String) }) });
    accessToken = response.body.data.access;
    refreshToken = response.body.data.refresh;
  });

  test('GET /auth/session with access token should return user info', async () => {
    const response = await request(app)
      .get('/auth/session')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(response.body).toMatchObject({ status: true, code: 200, data: expect.objectContaining({ id: userId, email: userCredentials.email, roles: expect.any(Array) }) });
  });

  test('POST /auth/refresh returns a new access token', async () => {
    const response = await request(app).post('/auth/refresh').send({ refresh: refreshToken }).expect(200);
    expect(response.body).toMatchObject({ status: true, code: 200, data: expect.objectContaining({ access: expect.any(String) }) });
    accessToken = response.body.data.access;
  });

  test('GET /api/exchange/markets should return market list', async () => {
    const response = await request(app).get('/api/exchange/markets').expect(200);
    expect(response.body).toMatchObject({ status: true, code: 200, data: expect.objectContaining({ quote: expect.any(String), markets: expect.any(Array) }) });
  });

  test('GET /api/exchange/ticker/BTCUSDT should return ticker snapshot', async () => {
    const response = await request(app).get('/api/exchange/ticker/BTCUSDT').expect(200);
    expect(response.body).toMatchObject({ status: true, code: 200, data: expect.objectContaining({ symbol: 'BTCUSDT' }) });
  });

  test('GET /api/exchange/orderbook/BTCUSDT should return orderbook payload', async () => {
    const response = await request(app).get('/api/exchange/orderbook/BTCUSDT').expect(200);
    expect(response.body).toMatchObject({ status: true, code: 200, data: expect.objectContaining({ symbol: 'BTCUSDT', bids: expect.any(Array), asks: expect.any(Array) }) });
  });

  test('GET /api/exchange/snapshot?symbol=BTCUSDT should return snapshot data', async () => {
    const response = await request(app).get('/api/exchange/snapshot?symbol=BTCUSDT').expect(200);
    expect(response.body).toEqual(expect.objectContaining({ symbol: 'BTCUSDT' }));
  });

  test('GET /api/exchange/wallets requires auth and returns wallet list', async () => {
    const response = await request(app)
      .get('/api/exchange/wallets')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(response.body).toMatchObject({ status: true, code: 200, data: expect.any(Array) });
  });

  test('POST /auth/logout should revoke refresh token', async () => {
    const response = await request(app)
      .post('/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ refresh: refreshToken })
      .expect(200);
    expect(response.body).toMatchObject({ status: true, code: 200, data: { loggedOut: true } });
  });
});

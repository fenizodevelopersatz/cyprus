import jwt from 'jsonwebtoken';
import bcryptjs from 'bcryptjs';
import crypto from 'crypto';
import { cfg } from '../config.js';

export async function hashPassword(pw) { return bcryptjs.hash(pw, 10); }
export async function verifyPassword(pw, hash) { return bcryptjs.compare(pw, hash); }

export function signJwt(payload, opts = {}) {
  return jwt.sign(payload, cfg.jwtSecret, { algorithm: 'HS256', expiresIn: cfg.jwtExpires, ...opts });
}
export function signRefresh(payload, opts = {}) {
  return jwt.sign(payload, cfg.jwtSecret, { algorithm: 'HS256', expiresIn: cfg.refreshExpires, ...opts });
}
export function verifyJwt(token) { return jwt.verify(token, cfg.jwtSecret); }

function getWalletEncryptionKey() {
  const raw = cfg.wallet?.encryptionSecret || cfg.jwtSecret;
  if (!raw) {
    const error = new Error('WALLET_ENCRYPTION_SECRET_NOT_CONFIGURED');
    error.status = 500;
    throw error;
  }
  return crypto.createHash('sha256').update(String(raw)).digest();
}

export function encryptText(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getWalletEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${encrypted.toString('base64')}`;
}

export function decryptText(payload) {
  const [ivRaw, tagRaw, encryptedRaw] = String(payload || '').split('.');
  if (!ivRaw || !tagRaw || !encryptedRaw) throw new Error('INVALID_ENCRYPTED_PAYLOAD');
  const decipher = crypto.createDecipheriv('aes-256-gcm', getWalletEncryptionKey(), Buffer.from(ivRaw, 'base64'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(encryptedRaw, 'base64')), decipher.final()]);
  return decrypted.toString('utf8');
}

export function encryptPrivateKey(value) {
  return encryptText(value);
}

export function decryptPrivateKey(payload) {
  return decryptText(payload);
}

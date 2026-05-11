import crypto from 'crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const TOTP_TIME_STEP_SECONDS = 30;
const TOTP_DIGITS = 6;

export function generateBase32Secret(length = 32) {
  const bytes = crypto.randomBytes(length);
  let output = '';
  let bits = 0;
  let value = 0;

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output.slice(0, length);
}

function base32ToBuffer(secret) {
  const normalized = String(secret || '')
    .toUpperCase()
    .replace(/[^A-Z2-7]/g, '');

  let bits = 0;
  let value = 0;
  const bytes = [];

  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

function generateTotpForCounter(secret, counter) {
  const key = base32ToBuffer(secret);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(buffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

export function verifyTotp(secret, token, window = 1) {
  const normalizedToken = String(token || '').trim();
  if (!secret || !/^\d{6}$/.test(normalizedToken)) return false;

  const currentCounter = Math.floor(Date.now() / 1000 / TOTP_TIME_STEP_SECONDS);
  for (let offset = -window; offset <= window; offset += 1) {
    const candidate = generateTotpForCounter(secret, currentCounter + offset);
    if (candidate === normalizedToken) {
      return true;
    }
  }
  return false;
}

export function buildOtpAuthUrl({ issuer, email, secret }) {
  const label = `${issuer}:${email}`;
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_TIME_STEP_SECONDS),
  });
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}

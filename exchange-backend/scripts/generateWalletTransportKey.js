import 'dotenv/config';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const envPath = path.resolve(process.cwd(), '.env');
const keyName = 'WALLET_TRANSPORT_PRIVATE_KEY';

function escapePem(value) {
  return String(value).replace(/\r?\n/g, '\\n');
}

function upsertEnvValue(source, name, value) {
  const line = `${name}=${value}`;
  const pattern = new RegExp(`^${name}=.*$`, 'm');
  if (pattern.test(source)) return source.replace(pattern, line);
  const suffix = source.endsWith('\n') || !source ? '' : '\n';
  return `${source}${suffix}${line}\n`;
}

const { privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: {
    type: 'spki',
    format: 'pem',
  },
  privateKeyEncoding: {
    type: 'pkcs8',
    format: 'pem',
  },
});

const current = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
const updated = upsertEnvValue(current, keyName, escapePem(privateKey));
fs.writeFileSync(envPath, updated);

console.log(`${keyName} generated in ${envPath}`);
console.log('Restart the backend so dotenv loads the new key.');

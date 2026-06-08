import pino from 'pino';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRequestContext } from './context.js';

const env = String(process.env.NODE_ENV || 'development').toLowerCase();
const consoleLoggingEnabled = String(process.env.LOG_CONSOLE ?? 'true').toLowerCase() !== 'false';
const level = consoleLoggingEnabled
  ? process.env.LOG_LEVEL || (env === 'production' ? 'info' : 'debug')
  : 'silent';
const isLocalPretty =
  consoleLoggingEnabled &&
  (env === 'development' || env === 'local') &&
  String(process.env.LOG_PRETTY || 'true').toLowerCase() !== 'false';

const transport = isLocalPretty
  ? {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        singleLine: true,
        ignore: 'pid,hostname',
      },
    }
  : undefined;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..', '..');
const LOG_DIR = path.resolve(APP_ROOT, 'logs');
const fileLoggingEnabled = String(process.env.LOG_FILE ?? 'true').toLowerCase() !== 'false';
const dailyLogDate = new Date().toISOString().slice(0, 10);
const dailyLogPath = path.resolve(LOG_DIR, `app-${dailyLogDate}.log`);

const redact = {
  paths: [
    'req.headers.authorization',
    'req.headers.cookie',
    'request.headers.authorization',
    'request.headers.cookie',
    'headers.authorization',
    'headers.cookie',
    'authorization',
    'password',
    'token',
    'accessToken',
    'refreshToken',
    'privateKey',
    'seedPhrase',
    'mnemonic',
    '*.password',
    '*.token',
    '*.accessToken',
    '*.refreshToken',
    '*.privateKey',
    '*.seedPhrase',
    '*.mnemonic',
  ],
  censor: '[REDACTED]',
};

if (fileLoggingEnabled) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

const loggerOptions = {
  level,
  base: undefined,
  messageKey: 'message',
  timestamp: pino.stdTimeFunctions.isoTime,
  redact,
  transport,
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  mixin() {
    const context = getRequestContext();
    if (!context) return {};
    return {
      requestId: context.requestId,
      userId: context.userId,
    };
  },
};

const streams = [];
if (consoleLoggingEnabled) {
  streams.push({ stream: process.stdout });
}
if (fileLoggingEnabled) {
  streams.push({ stream: pino.destination({ dest: dailyLogPath, sync: false }) });
}

export const logger = streams.length > 0
  ? pino(loggerOptions, pino.multistream(streams))
  : pino({ ...loggerOptions, level: 'silent' });

export function createRequestId() {
  return randomUUID();
}

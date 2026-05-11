import pino from 'pino';
import { randomUUID } from 'node:crypto';
import { getRequestContext } from './context.js';

const env = String(process.env.NODE_ENV || 'development').toLowerCase();
const level = process.env.LOG_LEVEL || (env === 'production' ? 'info' : 'debug');
const isLocalPretty =
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

export const logger = pino({
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
});

export function createRequestId() {
  return randomUUID();
}

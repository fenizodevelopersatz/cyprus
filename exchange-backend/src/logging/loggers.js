import { logger } from './logger.js';

export const appLogger = logger.child({ module: 'app' });
export const httpLogger = logger.child({ module: 'http' });
export const authLogger = logger.child({ module: 'auth' });
export const fundingLogger = logger.child({ module: 'funding' });
export const depositLogger = logger.child({ module: 'deposit' });
export const ethereumLogger = logger.child({ module: 'ethereum', network: 'ethereum' });
export const bscLogger = logger.child({ module: 'bsc', network: 'bsc' });
export const tronLogger = logger.child({ module: 'tron', network: 'tron' });
export const databaseLogger = logger.child({ module: 'database' });
export const cronLogger = logger.child({ module: 'cron' });
export const queueLogger = logger.child({ module: 'queue' });
export const errorLogger = logger.child({ module: 'error' });

export function getModuleLogger(moduleName, bindings = {}) {
  return logger.child({ module: moduleName, ...bindings });
}

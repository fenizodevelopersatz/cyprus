import http from 'http';
import { createApp } from './app.js';
import { cfg } from './config.js';
import { createWs } from './ws.js';
import { startMarketTicker } from './workers/marketTick.js';
import { startFuturesTicker } from './workers/futuresTick.js';
import { startBinanceSync } from './workers/binanceSync.js';
import { startSpotMatcher } from './workers/spotMatcher.js';
import { startFuturesAutoClose } from './workers/futuresAutoClose.js';
import { startSignalAutoClose } from './workers/signalAutoClose.js';
import { startDepositMonitor } from './services/depositMonitorService.js';
import { startMlmBackupCronWorker, startMlmLevelBonusPayoutWorker } from './services/mlmLevelService.js';
import { appLogger, cronLogger, errorLogger, httpLogger } from './logging/loggers.js';

const app = createApp();
const PORT = Number(process.env.PORT) || Number(cfg?.port) || 4000;

app.set('trust proxy', 1);

const server = http.createServer(app);
const io = createWs(server);

startMarketTicker(io);
startFuturesTicker(io);
startBinanceSync().catch((err) => {
  cronLogger.error({ err, job: 'binance_sync_bootstrap' }, 'sync_bootstrap_failed');
});

startSpotMatcher();
startFuturesAutoClose();
startSignalAutoClose();
if (cfg?.depositMonitor?.enabled) {
  startDepositMonitor();
}
startMlmBackupCronWorker();
startMlmLevelBonusPayoutWorker();

server.listen(PORT, '0.0.0.0', () => {
  appLogger.info({ event: 'server_started', port: PORT, docsPath: '/docs' }, 'server_started');
});

server.on('error', (err) => {
  httpLogger.error({ err }, 'server_error');
});

const shutdown = (signal) => {
  appLogger.info({ event: 'shutdown_started', signal }, 'shutdown_started');
  server.close(() => {
    appLogger.info({ event: 'server_closed', signal }, 'server_closed');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  errorLogger.error({ err: reason, event: 'unhandled_rejection' }, 'unhandled_rejection');
});
process.on('uncaughtException', (err) => {
  errorLogger.fatal({ err, event: 'uncaught_exception' }, 'uncaught_exception');
});

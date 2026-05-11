import { startDepositMonitor } from '../services/depositMonitorService.js';
import { cronLogger } from '../logging/loggers.js';

cronLogger.info({ event: 'worker_started', job: 'deposit_monitor' }, 'worker_started');
startDepositMonitor();

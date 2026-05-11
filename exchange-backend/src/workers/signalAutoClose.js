import { closeExpiredSignalTrades } from '../services/userSignalService.js';
import { cronLogger } from '../logging/loggers.js';

export function startSignalAutoClose() {
  async function loop() {
    try {
      const closed = await closeExpiredSignalTrades().catch((err) => {
        cronLogger.error({ err, job: 'signal_auto_close', event: 'evaluation_failed' }, 'evaluation_failed');
        return [];
      });

      if (closed.length > 0) {
        cronLogger.info(
          { job: 'signal_auto_close', event: 'positions_closed', count: closed.length },
          'positions_closed'
        );
      }
    } finally {
      setTimeout(loop, 60_000).unref();
    }
  }

  loop();
}

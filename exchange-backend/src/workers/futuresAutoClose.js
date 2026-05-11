import { evaluateAutoClosePositions } from '../services/futuresService.js';
import { cronLogger } from '../logging/loggers.js';

export function startFuturesAutoClose() {
  async function loop() {
    try {
      await evaluateAutoClosePositions().catch((err) => {
        cronLogger.error({ err, job: 'futures_auto_close', event: 'evaluation_failed' }, 'evaluation_failed');
      });
    } finally {
      setTimeout(loop, 2000).unref();
    }
  }

  loop();
}


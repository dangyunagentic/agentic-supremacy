// Worker bootstrap: consumes preflight / mint / receipt queues.

import pino from 'pino';
import { startPreflightWorker } from './processors/preflight.processor';
import { startMintWorker } from './processors/mint.processor';
import { startReceiptWorker } from './processors/receipt.processor';
import { startTransferWorker } from './processors/transfer.processor';
import { closeRuntime } from './runtime';

const logger = pino({ name: 'worker', level: process.env.LOG_LEVEL ?? 'info' });

async function main() {
  logger.info('Mint worker starting');

  const preflight = startPreflightWorker();
  const mint = startMintWorker();
  const receipt = startReceiptWorker();
  const transfers = startTransferWorker();

  for (const worker of [preflight, mint, receipt, transfers]) {
    worker.on('failed', (job, err) => {
      logger.error({ jobId: job?.id, err: err.message }, 'job failed');
    });
  }

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    await Promise.allSettled([
      preflight.close(),
      mint.close(),
      receipt.close(),
      transfers.close(),
    ]);
    await closeRuntime();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  logger.info('Workers ready: preflight, mint-tasks, receipt, transfers');
}

void main().catch((err) => {
  logger.error({ err: err.message }, 'fatal');
  process.exit(1);
});

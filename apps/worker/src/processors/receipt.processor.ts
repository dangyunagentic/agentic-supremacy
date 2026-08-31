// Receipt phase (T+2s): poll for receipts, record per-wallet outcomes,
// forward minted NFTs to the recipient when configured, then close the task.

import { Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import {
  ENGINE_DEFAULTS,
  QUEUES,
  TaskStatus,
  WalletResultStatus,
  getChainProfile,
  isTaskTerminal,
} from '@mintbot/shared';
import { MintEngine } from '../mint-engine';
import { buildEngine, type MintJobData } from './mint.processor';
import {
  events,
  forwardMintedNfts,
  loadTaskWallets,
  notifyTaskUser,
  prisma,
  setTaskStatus,
  taskLog,
  upsertResult,
} from '../runtime';

const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

export async function runReceipt(taskId: string): Promise<void> {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task || isTaskTerminal(task.status)) return;

  const cfg = await prisma.systemConfig.findUnique({ where: { id: 1 } });
  const timeoutMs = (cfg?.pendingTimeoutSec ?? ENGINE_DEFAULTS.pendingTimeoutSec) * 1000;
  const baseMs = cfg?.receiptPollBaseMs ?? ENGINE_DEFAULTS.receiptPollBaseMs;
  const maxMs = cfg?.receiptPollMaxMs ?? ENGINE_DEFAULTS.receiptPollMaxMs;

  const chainRow = await prisma.chain.findUnique({ where: { key: task.chainKey } });
  const profile = getChainProfile(task.chainKey);
  const rpcUrls = task.rpcUrls.length > 0 ? task.rpcUrls : (chainRow?.publicRpcs ?? profile?.rpc.public ?? []);

  const engine: MintEngine = await buildEngine(task.chainKey, rpcUrls);
  try {
    const wallets = await loadTaskWallets(taskId);
    const results = await prisma.taskResult.findMany({
      where: { taskId, status: WalletResultStatus.Dispatched },
      orderBy: { walletIndex: 'asc' },
    });
    if (results.length === 0) {
      await taskLog(taskId, 'warn', 'No dispatched transactions to track');
      await setTaskStatus(taskId, TaskStatus.Failed);
      return;
    }

    const dispatched = results.map((r) => ({
      walletAddress: r.walletAddress,
      rawTx: '',
      txHash: r.txHash!,
      results: [],
    }));

    await taskLog(taskId, 'info', `Polling receipts for ${dispatched.length} tx(s)`);
    const outcomes = await engine.collectReceipts(dispatched, { timeoutMs, baseMs, maxMs });

    let success = 0;
    let failed = 0;
    const successByWallet = new Map<string, string>();

    for (const outcome of outcomes) {
      const wallet = wallets.find((w) => w.address.toLowerCase() === outcome.walletAddress.toLowerCase());
      if (!wallet) continue;

      if (!outcome.found) {
        failed++;
        await upsertResult(taskId, wallet, WalletResultStatus.Timeout, {
          txHash: outcome.txHash,
          errorMessage: `No receipt within ${timeoutMs / 1000}s`,
        });
        await taskLog(taskId, 'error', `[W${wallet.index}] timeout waiting for receipt`, wallet.index);
        continue;
      }
      if (outcome.status === 1) {
        success++;
        successByWallet.set(wallet.address, outcome.txHash);
        await upsertResult(taskId, wallet, WalletResultStatus.Success, {
          txHash: outcome.txHash,
          blockNumber: outcome.blockNumber,
          gasUsed: outcome.gasUsed,
        });
        await taskLog(
          taskId,
          'success',
          `[W${wallet.index}] SUCCESS tx ${outcome.txHash} block ${outcome.blockNumber} gas ${outcome.gasUsed}`,
          wallet.index,
        );
      } else {
        // ── Auto-retry on NotActive (fired before stage opened) ──
        const reason = await engine.decodeRevertReason(outcome.txHash);
        const isNotActive = reason && reason.includes('NotActive');
        if (isNotActive && task.mintMode === 'public' && /^0x[a-fA-F0-9]{40}$/.test(task.collection)) {
          await taskLog(taskId, 'warn', `[W${wallet.index}] NotActive revert — waiting for stage open then retrying`, wallet.index);

          // 1. Wait for the on-chain stage to actually open (bounded).
          const gate = await engine.waitForStageOpen(task.collection, null, 30_000, 250);
          if (gate && gate.startTime > 0) {
            const waitMs = Math.max(0, gate.startTime * 1000 - Date.now());
            if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs + 250));
          } else {
            await new Promise((r) => setTimeout(r, 1_500));
          }

          try {
            // 2. Re-build the mint plan, re-sign with a fresh nonce, re-blast.
            const { mode } = await engine.resolveMode(task.mintMode, task.collection);
            const plan = await engine.buildPlan(mode, task.collection, task.quantity, [wallet]);
            const value =
              plan.kind === 'public' ? plan.shared!.value : plan.perWallet![0]?.value ?? 0n;
            const to =
              plan.kind === 'public' ? plan.shared!.to : plan.perWallet![0]?.to;
            const data =
              plan.kind === 'public' ? plan.shared!.data : plan.perWallet![0]?.data;
            if (!to || data === undefined) throw new Error('No mint action for retry');

            const nonce = await engine.getPendingNonce(wallet.address);
            const chainId = await engine.assertNetwork();
            const signed = await engine.signSingle(
              wallet.privateKey,
              to,
              data,
              value,
              { maxFeeGwei: task.maxFeeGwei, maxPriorityGwei: task.maxPriorityGwei, gasLimit: task.gasLimit },
              chainId,
              nonce,
            );
            await engine.blastAll([signed], 0);
            await upsertResult(taskId, wallet, WalletResultStatus.Dispatched, { txHash: signed.txHash });
            await taskLog(taskId, 'info', `[W${wallet.index}] Re-blasted after stage open: ${signed.txHash}`, wallet.index);

            // 3. Poll the new receipt (bounded).
            const retryOutcome = await engine.collectReceipts(
              [{ walletAddress: wallet.address, rawTx: '', txHash: signed.txHash, results: [] }],
              { timeoutMs, baseMs, maxMs },
            );
            const retry = retryOutcome[0];
            if (retry && retry.found && retry.status === 1) {
              success++;
              successByWallet.set(wallet.address, retry.txHash);
              await upsertResult(taskId, wallet, WalletResultStatus.Success, {
                txHash: retry.txHash,
                blockNumber: retry.blockNumber,
                gasUsed: retry.gasUsed,
              });
              await taskLog(taskId, 'success', `[W${wallet.index}] RETRY SUCCESS ${retry.txHash}`, wallet.index);
            } else {
              failed++;
              await upsertResult(taskId, wallet, WalletResultStatus.Reverted, {
                txHash: retry?.txHash ?? signed.txHash,
                blockNumber: retry?.blockNumber ?? null,
                gasUsed: retry?.gasUsed ?? null,
                errorMessage: 'Reverted on retry',
              });
              await taskLog(taskId, 'error', `[W${wallet.index}] RETRY FAILED ${retry?.txHash ?? signed.txHash}`, wallet.index);
            }
          } catch (err) {
            failed++;
            await upsertResult(taskId, wallet, WalletResultStatus.Reverted, {
              txHash: outcome.txHash,
              blockNumber: outcome.blockNumber,
              errorMessage: `Retry error: ${(err as Error).message}`,
            });
            await taskLog(taskId, 'error', `[W${wallet.index}] retry failed: ${(err as Error).message}`, wallet.index);
          }
        } else {
          failed++;
          await upsertResult(taskId, wallet, WalletResultStatus.Reverted, {
            txHash: outcome.txHash,
            blockNumber: outcome.blockNumber,
            gasUsed: outcome.gasUsed,
            errorMessage: reason ? `Reverted: ${reason}` : 'Reverted',
          });
          await taskLog(taskId, 'error', `[W${wallet.index}] REVERTED tx ${outcome.txHash}${reason ? ` (${reason})` : ''}`, wallet.index);
        }
      }
    }

    // ── Forward NFTs (multi-wallet mode) ──
    const isContract = /^0x[a-fA-F0-9]{40}$/.test(task.collection);
    if (task.recipientAddress && isContract && successByWallet.size > 0) {
      try {
        await forwardMintedNfts(engine, taskId, wallets, task.collection, task.recipientAddress, successByWallet);
      } catch (err) {
        await taskLog(taskId, 'warn', `NFT forwarding failed: ${(err as Error).message}`);
      }
    }

    const finalStatus = failed === 0 ? TaskStatus.Completed : success > 0 ? TaskStatus.Failed : TaskStatus.Failed;
    await setTaskStatus(taskId, finalStatus);
    events.complete(taskId, { total: outcomes.length, success, failed });
    await taskLog(
      taskId,
      success > 0 && failed === 0 ? 'success' : 'warn',
      `Task finished: ${success}/${outcomes.length} minted`,
    );
    await notifyTaskUser(
      taskId,
      `Task "${task.name}" finished: ${success}/${outcomes.length} minted` +
        (task.recipientAddress ? `\nNFTs forwarded to ${task.recipientAddress}` : ''),
    );
  } finally {
    await engine.destroy();
  }
}

export function startReceiptWorker(): Worker<MintJobData> {
  return new Worker<MintJobData>(
    QUEUES.RECEIPT,
    async (job: Job<MintJobData>) => {
      try {
        await runReceipt(job.data.taskId);
      } catch (err) {
        await taskLog(job.data.taskId, 'error', `Receipt tracking failed: ${(err as Error).message}`).catch(() => undefined);
        await setTaskStatus(job.data.taskId, TaskStatus.Failed).catch(() => undefined);
        throw err;
      }
    },
    { connection, concurrency: 5 },
  );
}

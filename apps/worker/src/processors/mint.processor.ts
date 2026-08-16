// Mint execution (T-10s): build calldata, validate balances, pre-sign every
// transaction, wait for the stage to open with sub-ms precision, then blast
// to all RPC endpoints in parallel. Receipt handling is delegated to the
// receipt queue.

import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import {
  QUEUES,
  SEADROP_ADDRESS,
  TaskStatus,
  WalletResultStatus,
  getChainProfile,
  isTaskTerminal,
} from '@mintbot/shared';
import { MintEngine } from '../mint-engine';
import {
  decryptPrivateKey,
  loadTaskWallets,
  prisma,
  setTaskStatus,
  taskLog,
  upsertResult,
} from '../runtime';

export interface MintJobData {
  taskId: string;
}

const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

export async function buildEngine(chainKey: string, rpcUrls: string[]): Promise<MintEngine> {
  const chain = await prisma.chain.findUnique({ where: { key: chainKey } });
  const profile = getChainProfile(chainKey);
  const cfg = await prisma.systemConfig.findUnique({ where: { id: 1 } });
  let openSeaKey: string | null = null;
  if (cfg?.openseaApiKeyEnc) {
    try {
      openSeaKey = decryptPrivateKey(cfg.openseaApiKeyEnc);
    } catch {
      openSeaKey = null;
    }
  }
  return new MintEngine(
    {
      key: chainKey,
      chainId: chain?.chainId ?? profile?.chainId ?? 1,
      name: chain?.name ?? profile?.name ?? chainKey,
      explorer: chain?.explorer ?? profile?.explorer ?? '',
      rpcUrls,
      seadropAddress: chain?.seadropAddress ?? profile?.seadropAddress ?? SEADROP_ADDRESS,
    },
    openSeaKey,
  );
}

export async function runMint(taskId: string): Promise<void> {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task || isTaskTerminal(task.status)) return;

  const chainRow = await prisma.chain.findUnique({ where: { key: task.chainKey } });
  const profile = getChainProfile(task.chainKey);
  const rpcUrls = task.rpcUrls.length > 0 ? task.rpcUrls : (chainRow?.publicRpcs ?? profile?.rpc.public ?? []);
  if (rpcUrls.length === 0) throw new Error(`No RPC endpoints for chain ${task.chainKey}`);

  const engine = await buildEngine(task.chainKey, rpcUrls);
  try {
    // ── Phase 2: calldata ──
    await setTaskStatus(taskId, TaskStatus.Calldata);
    await taskLog(taskId, 'info', `Building calldata (mode: ${task.mintMode}) on ${engine.chain.name}`);

    const chainId = await engine.assertNetwork();
    await taskLog(taskId, 'success', `RPC network verified (chain id ${chainId})`);

    const wallets = await loadTaskWallets(taskId);
    if (wallets.length === 0) throw new Error('No spendable wallets found for this task');

    const { mode } = await engine.resolveMode(task.mintMode, task.collection);
    const plan = await engine.buildPlan(mode, task.collection, task.quantity, wallets);

    // ── Balance validation (upfront reservation rule) ──
    const valuePerWallet = plan.kind === 'public' ? plan.shared!.value : plan.perWallet![0]?.value ?? 0n;
    const balances = await engine.getNativeBalances(wallets.map((w) => w.address));
    const gas = {
      maxFeeGwei: task.maxFeeGwei,
      maxPriorityGwei: task.maxPriorityGwei,
      gasLimit: task.gasLimit,
    };
    const check = engine.validateBalances(balances, wallets, gas, valuePerWallet);
    if (!check.ok) {
      for (const ins of check.insufficient) {
        await taskLog(taskId, 'error', `Wallet ${ins.address} balance too low (have ${ins.have}, need ${ins.need})`);
      }
      throw new Error(`${check.insufficient.length} wallet(s) below the upfront reservation`);
    }
    await taskLog(taskId, 'success', `Balances ok for ${wallets.length} wallet(s)`);

    // ── Phase 3: pre-sign ──
    await setTaskStatus(taskId, TaskStatus.PreSign);
    const warmMs = await engine.warm();
    await taskLog(taskId, 'info', `RPC connections warmed in ${warmMs}ms`);

    const signed = await engine.signAll(wallets, plan, gas, chainId);
    await taskLog(taskId, 'success', `Pre-signed ${signed.length} transaction(s)`);

    // ── Phase 4: wait + dispatch ──
    const fireAt = task.resolvedFireAt ? new Date(task.resolvedFireAt) : null;
    if (fireAt && fireAt.getTime() > Date.now()) {
      await taskLog(taskId, 'info', `Waiting for stage open at ${fireAt.toISOString()}`);
      await engine.waitUntil(fireAt);
    }

    await setTaskStatus(taskId, TaskStatus.Dispatching);
    const t0 = Date.now();
    const dispatched = engine.blastAll(signed);
    const blastMs = Date.now() - t0;

    for (let i = 0; i < dispatched.length; i++) {
      const d = dispatched[i];
      const wallet = wallets[i];
      await upsertResult(taskId, wallet, WalletResultStatus.Dispatched, { txHash: d.txHash });
    }
    await taskLog(taskId, 'success', `Blasted ${dispatched.length} tx(s) to ${rpcUrls.length} RPC(s) in ${blastMs}ms`);

    // ── Phase 5: receipts (delegated) ──
    await setTaskStatus(taskId, TaskStatus.AwaitingReceipt);
    const receiptQueue = new Queue(QUEUES.RECEIPT, { connection });
    await receiptQueue.add(
      'receipt',
      { taskId },
      {
        jobId: `task:${taskId}`,
        delay: 2_000,
        attempts: 1,
        removeOnComplete: { age: 3600 },
        removeOnFail: { age: 86400 },
      },
    );
    await receiptQueue.close();
  } finally {
    await engine.destroy();
  }
}

export function startMintWorker(): Worker<MintJobData> {
  return new Worker<MintJobData>(
    QUEUES.MINT,
    async (job: Job<MintJobData>) => {
      try {
        await runMint(job.data.taskId);
      } catch (err) {
        await taskLog(job.data.taskId, 'error', `Mint failed: ${(err as Error).message}`).catch(() => undefined);
        await setTaskStatus(job.data.taskId, TaskStatus.Failed).catch(() => undefined);
        throw err;
      }
    },
    { connection, concurrency: 10 },
  );
}

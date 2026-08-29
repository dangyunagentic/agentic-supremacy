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
  formatEth,
  isTaskTerminal,
} from '@mintbot/shared';
import { parseEther } from 'ethers';
import { MintEngine } from '../mint-engine';
import {
  decryptPrivateKey,
  events,
  loadTaskWallets,
  notifyTaskUser,
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

    // ── Free Mint / Price Guard Protection ──
    // Strictly protects against developer suddenly changing price from Free (0 ETH) to Paid,
    // or exceeding user's configured price limit.
    const valuePerWallet = plan.kind === 'public' ? plan.shared!.value : plan.perWallet![0]?.value ?? 0n;

    if (task.pricePerNft !== null && task.pricePerNft !== undefined) {
      const maxPriceWei = parseEther(String(task.pricePerNft));
      const maxAllowedTotalWei = maxPriceWei * BigInt(task.quantity);

      if (valuePerWallet > maxAllowedTotalWei) {
        const isFreeMint = maxPriceWei === 0n;
        const msg = isFreeMint
          ? `🚨 PRICE GUARD TRIGGERED: Developer changed price from FREE (0 ETH) to ${formatEth(valuePerWallet)} ETH! Minting aborted immediately to protect your wallet funds.`
          : `🚨 PRICE GUARD TRIGGERED: Actual price is ${formatEth(valuePerWallet)} ETH (exceeds configured max of ${formatEth(maxAllowedTotalWei)} ETH for ${task.quantity} items). Aborting.`;

        await taskLog(taskId, 'error', msg);
        await setTaskStatus(taskId, TaskStatus.Failed);
        await notifyTaskUser(taskId, msg);
        return;
      }
    }

    // ── Balance validation (upfront reservation rule) ──
    const balances = await engine.getNativeBalances(wallets.map((w) => w.address));
    const gas = {
      maxFeeGwei: task.maxFeeGwei,
      maxPriorityGwei: task.maxPriorityGwei,
      gasLimit: task.gasLimit,
    };
    const check = engine.validateBalances(balances, wallets, gas, valuePerWallet);
    let activeWallets = wallets;
    if (!check.ok) {
      if (task.fundedOnly) {
        const insufficientSet = new Set(check.insufficient.map((i) => i.address.toLowerCase()));
        for (const ins of check.insufficient) {
          await taskLog(taskId, 'warn', `Skipping unfunded wallet ${ins.address} (have ${ins.have}, need ${ins.need})`);
        }
        activeWallets = wallets.filter((w) => !insufficientSet.has(w.address.toLowerCase()));
        if (activeWallets.length === 0) {
          throw new Error('No funded wallets to dispatch (fundedOnly)');
        }
      } else {
        for (const ins of check.insufficient) {
          await taskLog(taskId, 'error', `Wallet ${ins.address} balance too low (have ${ins.have}, need ${ins.need})`);
        }
        throw new Error(`${check.insufficient.length} wallet(s) below the upfront reservation`);
      }
    }
    await taskLog(taskId, 'success', `Balances ok for ${activeWallets.length} wallet(s)`);

    // ── Phase 3: pre-sign ──
    await setTaskStatus(taskId, TaskStatus.PreSign);
    const warmMs = await engine.warm();
    await taskLog(taskId, 'info', `RPC connections warmed in ${warmMs}ms`);

    const signedAll = await engine.signAll(activeWallets, plan, gas, chainId, task.nonce);
    const maxTx = task.maxTx && task.maxTx > 0 ? Math.min(task.maxTx, signedAll.length) : signedAll.length;
    const signed = signedAll.slice(0, maxTx);
    await taskLog(taskId, 'success', `Pre-signed ${signed.length} transaction(s)${maxTx < signedAll.length ? ` (maxTx limit ${maxTx})` : ''}`);

    // ── Simulation (dry-run): build + sign only, never broadcast ──
    if (task.simulate) {
      await setTaskStatus(taskId, TaskStatus.Dispatching);
      for (const s of signed) {
        const wallet = activeWallets.find((w) => w.address.toLowerCase() === s.walletAddress.toLowerCase());
        if (!wallet) continue;
        await upsertResult(taskId, wallet, WalletResultStatus.Success, {
          txHash: s.txHash,
          errorMessage: 'simulated (not broadcast)',
        });
      }
      await taskLog(taskId, 'success', `Simulation: ${signed.length} tx(s) built and pre-signed, not broadcast`);
      await setTaskStatus(taskId, TaskStatus.Completed);
      events.complete(taskId, { total: signed.length, success: signed.length, failed: 0 });
      await notifyTaskUser(taskId, `Task "${task.name}" simulated: ${signed.length} tx(s) built, none broadcast`);
      return;
    }

    // ── Phase 4: wait + dispatch ──
    const fireAt = task.resolvedFireAt ? new Date(task.resolvedFireAt) : null;
    if (fireAt && fireAt.getTime() > Date.now()) {
      const earlyFireMs = task.earlyFireMs ?? 0;
      await taskLog(taskId, 'info', `Waiting for stage open at ${fireAt.toISOString()}${earlyFireMs > 0 ? ` (early-fire ${earlyFireMs}ms before T-0)` : ''}`);
      await engine.waitUntil(fireAt, earlyFireMs);
    }

    await setTaskStatus(taskId, TaskStatus.Dispatching);

    // Flashbots private relay (optional); falls back to public RPC on failure.
    if (task.flashbots && signed.length > 0 && activeWallets[0]) {
      try {
        const res = await engine.submitFlashbots(signed.map((s) => s.rawTx), activeWallets[0].privateKey);
        await taskLog(taskId, 'info', `Flashbots bundle submitted: ${res.slice(0, 160)}`);
      } catch (err) {
        await taskLog(taskId, 'warn', `Flashbots submit failed, using public RPC: ${(err as Error).message}`);
      }
    }

    const t0 = Date.now();
    const dispatched = await engine.blastAll(signed, task.delayMs ?? 1000);
    const blastMs = Date.now() - t0;

    for (let i = 0; i < dispatched.length; i++) {
      const d = dispatched[i];
      const wallet = activeWallets[i];
      if (!wallet) continue;
      await upsertResult(taskId, wallet, WalletResultStatus.Dispatched, { txHash: d.txHash });
    }
    await taskLog(taskId, 'success', `Blasted ${dispatched.length} tx(s) to ${rpcUrls.length} RPC(s) in ${blastMs}ms`);
    // Spam mode: keep re-pushing the same txs to the mempool (bounded window).
    if (task.spam) {
      const spamDeadline = Date.now() + 30_000;
      await taskLog(taskId, 'info', `Spam mode: re-blasting every ${task.delayMs ?? 1000}ms for 30s`);
      while (Date.now() < spamDeadline) {
        const current = await prisma.task.findUnique({ where: { id: taskId } });
        if (!current || isTaskTerminal(current.status)) break;
        await new Promise((r) => setTimeout(r, task.delayMs ?? 1000));
        await engine.blastAll(signed, 0);
      }
      await taskLog(taskId, 'info', 'Spam mode finished');
    }

    // ── Phase 5: receipts (delegated) ──
    await setTaskStatus(taskId, TaskStatus.AwaitingReceipt);
    const receiptQueue = new Queue(QUEUES.RECEIPT, { connection });
    await receiptQueue.add(
      'receipt',
      { taskId },
      {
        jobId: `task_${taskId}`,
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

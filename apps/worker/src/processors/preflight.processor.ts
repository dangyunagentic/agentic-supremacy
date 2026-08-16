// Pre-flight (T-60s): validate the task, resolve the actual fire time from
// on-chain stage data or the OpenSea API, then schedule the mint job at
// T-10s so signing happens just before the stage opens.

import { Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import {
  MintMode,
  PRE_SIGN_LEAD_MS,
  QUEUES,
  SEADROP_ADDRESS,
  TaskStatus,
  getChainProfile,
  isTaskTerminal,
} from '@mintbot/shared';
import { fetchPublicDropStart } from '../mint-engine/seadrop-public';
import { OpenSeaApiClient } from '../mint-engine/opensea-api';
import { prisma, setTaskStatus, taskLog, decryptPrivateKey } from '../runtime';

export interface PreflightJobData {
  taskId: string;
}

const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

async function getOpenSeaKey(): Promise<string | null> {
  const cfg = await prisma.systemConfig.findUnique({ where: { id: 1 } });
  if (!cfg?.openseaApiKeyEnc) return null;
  try {
    return decryptPrivateKey(cfg.openseaApiKeyEnc);
  } catch {
    return null;
  }
}

export async function runPreflight(taskId: string): Promise<void> {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task || isTaskTerminal(task.status)) return;

  await setTaskStatus(taskId, TaskStatus.PreFlight);
  await taskLog(taskId, 'info', 'Pre-flight: resolving collection, validating RPC, checking drop stage');

  const chain = await prisma.chain.findUnique({ where: { key: task.chainKey } });
  const profile = getChainProfile(task.chainKey);
  const rpcUrls = task.rpcUrls.length > 0 ? task.rpcUrls : (chain?.publicRpcs ?? profile?.rpc.public ?? []);
  if (rpcUrls.length === 0) throw new Error(`No RPC endpoints for chain ${task.chainKey}`);
  const seadropAddress = chain?.seadropAddress ?? profile?.seadropAddress ?? SEADROP_ADDRESS;

  const isAddress = /^0x[a-fA-F0-9]{40}$/.test(task.collection);
  let fireAt: Date | null = task.resolvedFireAt ?? null;
  let mode = task.mintMode;

  // ── Resolve the fire time when waiting for a stage ──
  if (!fireAt) {
    if (isAddress) {
      const start = await fetchPublicDropStart(rpcUrls[0], seadropAddress, task.collection);
      if (start === null) {
        throw new Error('No public drop stage found on-chain and no explicit fire time set');
      }
      fireAt = new Date(start * 1000);
      await taskLog(taskId, 'info', `Public stage opens at ${fireAt.toISOString()}`);
    } else {
      const openSea = new OpenSeaApiClient(await getOpenSeaKey());
      const stage = await openSea.fetchStage(task.collection, task.chainKey);
      if (!stage.startTime) {
        throw new Error(`No active stage found on OpenSea for ${task.collection}`);
      }
      fireAt = new Date(stage.startTime);
      await taskLog(taskId, 'info', `Stage (${stage.kind}) opens at ${fireAt.toISOString()}`);
    }
  }

  // ── Auto mode resolution (public first, then signed path) ──
  if (mode === MintMode.Auto) {
    mode = isAddress ? MintMode.Public : MintMode.Allowlist;
    await taskLog(taskId, 'info', `Auto mode resolved to ${mode}`);
  }

  // Clamp into the future: late pre-flights fire as soon as possible.
  if (fireAt.getTime() < Date.now()) {
    fireAt = new Date(Date.now() + 1000);
  }

  await prisma.task.update({
    where: { id: taskId },
    data: { resolvedFireAt: fireAt, mintMode: mode },
  });

  const mintAt = new Date(Math.max(Date.now() + 500, fireAt.getTime() - PRE_SIGN_LEAD_MS));
  const mintQueue = await import('bullmq').then((m) => new m.Queue(QUEUES.MINT, { connection }));
  await mintQueue.add(
    'mint',
    { taskId },
    {
      jobId: `task:${taskId}`,
      delay: Math.max(0, mintAt.getTime() - Date.now()),
      attempts: 1,
      removeOnComplete: { age: 3600 },
      removeOnFail: { age: 86400 },
    },
  );
  await mintQueue.close();

  await taskLog(
    taskId,
    'info',
    `Mint job scheduled at T-10s (${mintAt.toISOString()}); fire target ${fireAt.toISOString()}`,
  );
}

export function startPreflightWorker(): Worker<PreflightJobData> {
  return new Worker<PreflightJobData>(
    QUEUES.PREFLIGHT,
    async (job: Job<PreflightJobData>) => {
      try {
        await runPreflight(job.data.taskId);
      } catch (err) {
        await taskLog(job.data.taskId, 'error', `Pre-flight failed: ${(err as Error).message}`).catch(() => undefined);
        await setTaskStatus(job.data.taskId, TaskStatus.Failed).catch(() => undefined);
        throw err;
      }
    },
    { connection, concurrency: 5 },
  );
}

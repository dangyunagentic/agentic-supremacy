// Worker runtime: Prisma access, event publishing, wallet decryption and
// Telegram notifications. The worker is an execution runtime; it touches the
// database directly instead of going through the API.

import { PrismaClient } from '@prisma/client';
import IORedis from 'ioredis';
import { createDecipheriv, scryptSync } from 'crypto';
import { Wallet } from 'ethers';
import {
  TASK_EVENTS_CHANNEL,
  type LogLevel,
  type TaskEvent,
  type TaskStatus,
  type WalletResultStatus,
} from '@mintbot/shared';
import { extractMintedTokenIds, forwardNfts } from './mint-engine/nft-forwarder';
import { MintEngine } from './mint-engine';

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

const redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379');

// ── Realtime events (worker -> Redis pub/sub -> API socket gateway) ──

export const events = {
  status(taskId: string, status: TaskStatus) {
    publish({ type: 'status', payload: { taskId, status, timestamp: new Date().toISOString() } });
  },
  log(taskId: string, level: LogLevel, message: string, walletIndex: number | null = null) {
    publish({ type: 'log', payload: { taskId, level, message, walletIndex, timestamp: new Date().toISOString() } });
  },
  wallet(taskId: string, walletIndex: number, address: string, status: WalletResultStatus, txHash: string | null) {
    publish({ type: 'wallet', payload: { taskId, walletIndex, address, status, txHash } });
  },
  complete(taskId: string, summary: { total: number; success: number; failed: number }) {
    publish({ type: 'complete', payload: { taskId, summary } });
  },
};

function publish(event: TaskEvent) {
  void redis.publish(TASK_EVENTS_CHANNEL, JSON.stringify(event));
}

/** Persist a log row and stream it to the dashboard in one call. */
export async function taskLog(
  taskId: string,
  level: LogLevel,
  message: string,
  walletIndex: number | null = null,
) {
  await prisma.taskLog.create({ data: { taskId, level, message, walletIndex } });
  events.log(taskId, level, message, walletIndex);
}

export async function setTaskStatus(taskId: string, status: TaskStatus, extra?: { resolvedFireAt?: Date }) {
  await prisma.task.update({
    where: { id: taskId },
    data: {
      status,
      ...(status === 'pre_flight' || status === 'dispatching' ? { startedAt: new Date() } : {}),
      ...(status === 'completed' || status === 'failed' || status === 'cancelled' ? { completedAt: new Date() } : {}),
      ...(extra?.resolvedFireAt !== undefined ? { resolvedFireAt: extra.resolvedFireAt } : {}),
    },
  });
  events.status(taskId, status);
}

// ── Wallet decryption (same envelope as the API's KeyEncryptionPort) ──

const ALGO = 'aes-256-gcm';
const KEY_LEN = 32;
const IV_LEN = 16;
const TAG_LEN = 16;
const SALT_LEN = 16;

export function decryptPrivateKey(ciphertext: string): string {
  const masterKey = process.env.MASTER_KEY;
  if (!masterKey || masterKey.length < 16) throw new Error('MASTER_KEY env var must be set');

  const buf = Buffer.from(ciphertext, 'base64');
  const salt = buf.subarray(0, SALT_LEN);
  const iv = buf.subarray(SALT_LEN, SALT_LEN + IV_LEN);
  const tag = buf.subarray(SALT_LEN + IV_LEN, SALT_LEN + IV_LEN + TAG_LEN);
  const encrypted = buf.subarray(SALT_LEN + IV_LEN + TAG_LEN);
  const key = scryptSync(masterKey, salt, KEY_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

export interface LoadedWallet {
  id: string;
  index: number;
  address: string;
  privateKey: string;
}

export async function loadTaskWallets(taskId: string): Promise<LoadedWallet[]> {
  const task = await prisma.task.findUniqueOrThrow({
    where: { id: taskId },
    select: { walletIds: true },
  });
  const rows = await prisma.wallet.findMany({ where: { id: { in: task.walletIds } } });

  return task.walletIds
    .map((id, index) => {
      const row = rows.find((r) => r.id === id);
      if (!row) return null;
      return {
        id,
        index,
        address: row.address,
        privateKey: decryptPrivateKey(row.encryptedKey),
      };
    })
    .filter((w): w is LoadedWallet => w !== null);
}

// ── Telegram notifications (plain HTTP; no bot runtime in the worker) ──

export async function notifyTaskUser(taskId: string, message: string): Promise<void> {
  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { user: { select: { telegramId: true } } },
    });
    const telegramId = task?.user.telegramId;
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!telegramId || !token) return;

    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: telegramId.toString(), text: message }),
    });
  } catch {
    // notifications are best-effort
  }
}

// ── Result persistence ──

export async function upsertResult(
  taskId: string,
  wallet: LoadedWallet,
  status: WalletResultStatus,
  extra: { txHash?: string | null; blockNumber?: number | null; gasUsed?: number | null; errorMessage?: string | null } = {},
) {
  await prisma.taskResult.upsert({
    where: { taskId_walletIndex: { taskId, walletIndex: wallet.index } },
    update: { status, ...extra },
    create: {
      taskId,
      walletAddress: wallet.address,
      walletIndex: wallet.index,
      status,
      nftTokenIds: [],
      ...extra,
    },
  });
  events.wallet(taskId, wallet.index, wallet.address, status, extra.txHash ?? null);
}

// ── NFT forwarding wrapper ──

export async function forwardMintedNfts(
  engine: MintEngine,
  taskId: string,
  wallets: LoadedWallet[],
  collectionAddress: string,
  recipient: string,
  successByWallet: Map<string, string>,
) {
  for (const wallet of wallets) {
    const txHash = successByWallet.get(wallet.address);
    if (!txHash) continue;
    const logs = await engine.getReceiptLogs(txHash);
    const tokenIds = extractMintedTokenIds(
      logs.map((l) => ({ address: l.address, topics: [...l.topics], data: l.data })),
      collectionAddress,
      wallet.address,
    );
    if (tokenIds.length === 0) continue;

    await taskLog(taskId, 'info', `Forwarding ${tokenIds.length} NFT(s) to recipient`, wallet.index);
    const ethersWallet = new Wallet(wallet.privateKey, engine.provider);
    const forwardHashes = await forwardNfts(engine.provider, ethersWallet, collectionAddress, tokenIds, recipient);
    await prisma.taskResult.updateMany({
      where: { taskId, walletIndex: wallet.index },
      data: { nftTokenIds: tokenIds },
    });
    await taskLog(
      taskId,
      'success',
      `Forwarded tokens ${tokenIds.join(', ')} (txs: ${forwardHashes.length})`,
      wallet.index,
    );
  }
}

export async function closeRuntime(): Promise<void> {
  await Promise.allSettled([prisma.$disconnect(), redis.quit()]);
}

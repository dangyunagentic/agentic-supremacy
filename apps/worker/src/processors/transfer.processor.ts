// Bulk transfers: fund (ETH main wallet -> many) and transfer_nft (NFTs many ->
// one recipient). Non-latency-critical, so these use standard signed sends
// with sequential nonces instead of the mint blast path.

import { Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { Contract, Wallet, parseEther, type Log } from 'ethers';
import { QUEUES, getChainProfile } from '@mintbot/shared';
import { buildEngine } from './mint.processor';
import { decryptPrivateKey, prisma } from '../runtime';
import { ERC721_ABI } from '../mint-engine/nft-forwarder';

export interface TransferJobData {
  jobId: string;
}

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

interface ResultRow {
  address: string;
  txHash: string | null;
  status: 'success' | 'failed';
  detail?: string;
}

async function runFundTransfer(jobId: string): Promise<void> {
  const job = await prisma.transferJob.findUniqueOrThrow({ where: { id: jobId } });
  const chainRow = await prisma.chain.findUnique({ where: { key: job.chainKey } });
  const profile = getChainProfile(job.chainKey);
  const engine = await buildEngine(
    job.chainKey,
    chainRow?.publicRpcs ?? profile?.rpc.public ?? [],
  );

  try {
    const fromRow = await prisma.wallet.findUniqueOrThrow({ where: { id: job.fromWalletId! } });
    const toRows = await prisma.wallet.findMany({ where: { id: { in: job.toWalletIds } } });
    const amount = parseEther(String(job.amountEth));

    const signer = new Wallet(decryptPrivateKey(fromRow.encryptedKey), engine.provider);
    const fee = await engine.provider.getFeeData();
    const results: ResultRow[] = [];
    let nonce = await engine.provider.getTransactionCount(signer.address, 'pending');

    for (const dest of toRows) {
      try {
        const tx = await signer.sendTransaction({
          to: dest.address,
          value: amount,
          nonce: nonce++,
          gasLimit: 21_000,
          ...(fee.maxFeePerGas ? { maxFeePerGas: fee.maxFeePerGas } : {}),
          ...(fee.maxPriorityFeePerGas ? { maxPriorityFeePerGas: fee.maxPriorityFeePerGas } : {}),
          type: 2,
        });
        const receipt = await tx.wait();
        results.push({
          address: dest.address,
          txHash: receipt?.hash ?? tx.hash,
          status: receipt?.status === 1 ? 'success' : 'failed',
          detail: receipt?.status === 1 ? undefined : 'reverted',
        });
      } catch (err) {
        results.push({
          address: dest.address,
          txHash: null,
          status: 'failed',
          detail: (err as Error).message.slice(0, 200),
        });
      }
    }

    const failed = results.filter((r) => r.status === 'failed').length;
    await prisma.transferJob.update({
      where: { id: jobId },
      data: {
        status: failed === results.length ? 'failed' : 'completed',
        results: results as object[],
        completedAt: new Date(),
        error: failed > 0 ? `${failed}/${results.length} transfers failed` : null,
      },
    });
  } finally {
    await engine.destroy();
  }
}

/**
 * Finds NFTs currently owned by a wallet by scanning Transfer logs and
 * confirming ownership with ownerOf, then moves each to the recipient.
 */
async function runTransferNft(jobId: string): Promise<void> {
  const job = await prisma.transferJob.findUniqueOrThrow({ where: { id: jobId } });
  const chainRow = await prisma.chain.findUnique({ where: { key: job.chainKey } });
  const profile = getChainProfile(job.chainKey);
  const engine = await buildEngine(
    job.chainKey,
    chainRow?.publicRpcs ?? profile?.rpc.public ?? [],
  );

  try {
    const sourceRows = await prisma.wallet.findMany({ where: { id: { in: job.toWalletIds } } });
    const recipient = job.recipientAddress!;
    const token = job.tokenContract!;
    const currentBlock = await engine.provider.getBlockNumber();
    const fromBlock = job.fromBlock && job.fromBlock > 0 ? job.fromBlock : Math.max(0, currentBlock - 100_000);

    const results: ResultRow[] = [];

    for (const source of sourceRows) {
      try {
        const logs: Log[] = await engine.provider.getLogs({
          address: token,
          topics: [
            TRANSFER_TOPIC,
            null,
            `0x${source.address.slice(2).toLowerCase().padStart(64, '0')}`,
          ],
          fromBlock,
          toBlock: 'latest',
        });
        const candidateIds = new Set(
          logs
            .map((l) => l.topics[3])
            .filter((t): t is string => Boolean(t))
            .map((t) => BigInt(t).toString()),
        );

        const erc721 = new Contract(token, ERC721_ABI, engine.provider);
        const owned: string[] = [];
        for (const tokenId of candidateIds) {
          try {
            const owner: string = await erc721.ownerOf(tokenId);
            if (owner.toLowerCase() === source.address.toLowerCase()) owned.push(tokenId);
          } catch {
            // burned or non-standard token; skip
          }
        }

        if (owned.length === 0) {
          results.push({
            address: source.address,
            txHash: null,
            status: 'success',
            detail: 'no tokens held',
          });
          continue;
        }

        const signer = new Wallet(decryptPrivateKey(source.encryptedKey), engine.provider);
        let nonce = await engine.provider.getTransactionCount(signer.address, 'pending');
        const hashes: string[] = [];
        let anyFailed = false;

        for (const tokenId of owned) {
          try {
            const erc721 = new Contract(token, ERC721_ABI, signer);
            const tx = await erc721.safeTransferFrom(source.address, recipient, tokenId, {
              nonce: nonce++,
            });
            const receipt = await tx.wait();
            hashes.push(receipt?.hash ?? tx.hash);
          } catch {
            anyFailed = true;
          }
        }

        results.push({
          address: source.address,
          txHash: hashes[0] ?? null,
          status: anyFailed ? 'failed' : 'success',
          detail: `${hashes.length}/${owned.length} tokens moved`,
        });
      } catch (err) {
        results.push({
          address: source.address,
          txHash: null,
          status: 'failed',
          detail: (err as Error).message.slice(0, 200),
        });
      }
    }

    const failed = results.filter((r) => r.status === 'failed').length;
    await prisma.transferJob.update({
      where: { id: jobId },
      data: {
        status: failed === results.length ? 'failed' : 'completed',
        results: results as object[],
        completedAt: new Date(),
        error: failed > 0 ? `${failed}/${results.length} transfers failed` : null,
      },
    });
  } finally {
    await engine.destroy();
  }
}

export function startTransferWorker(): Worker<TransferJobData> {
  return new Worker<TransferJobData>(
    QUEUES.TRANSFERS,
    async (job: Job<TransferJobData>) => {
      const record = await prisma.transferJob.findUnique({ where: { id: job.data.jobId } });
      if (!record || record.status !== 'queued') return;
      await prisma.transferJob.update({
        where: { id: job.data.jobId },
        data: { status: 'running' },
      });
      try {
        if (record.kind === 'fund') {
          await runFundTransfer(job.data.jobId);
        } else {
          await runTransferNft(job.data.jobId);
        }
      } catch (err) {
        await prisma.transferJob.update({
          where: { id: job.data.jobId },
          data: {
            status: 'failed',
            error: (err as Error).message.slice(0, 500),
            completedAt: new Date(),
          },
        });
        throw err;
      }
    },
    { connection, concurrency: 2 },
  );
}

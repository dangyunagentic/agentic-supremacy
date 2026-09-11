// Bulk transfers: fund (ETH main wallet -> many) and transfer_nft (NFTs many ->
// one recipient). Non-latency-critical, so these use standard signed sends
// with sequential nonces instead of the mint blast path.

import { Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { Contract, Wallet, parseEther, type Log } from 'ethers';
import { QUEUES, getChainProfile, formatEth } from '@mintbot/shared';
import { buildEngine } from './mint.processor';
import { decryptPrivateKey, prisma } from '../runtime';
import { ERC721_ABI } from '../mint-engine/nft-forwarder';

export interface TransferJobData {
  jobId: string;
}

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

/** Redact provider/RPC internals from error messages before storing them. */
function sanitizeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  // strip URLs that may embed API keys (https://.../v2/<key>, ?api-key=...)
  const noUrls = raw.replace(/https?:\/\/[^\s"')\]]+/g, '[redacted-url]');
  // strip hex strings that look like private keys or tx hashes (64 chars)
  const noHex = noUrls.replace(/0x[a-fA-F0-9]{40,}/g, '[redacted-hex]');
  return noHex.slice(0, 200);
}

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

    // Destination addresses: UUIDs from DB or raw 0x EVM addresses
    const internalIds = job.toWalletIds.filter((id) => !id.startsWith('0x'));
    const rawAddresses = job.toWalletIds.filter((id) => id.startsWith('0x'));

    const internalRows = internalIds.length > 0
      ? await prisma.wallet.findMany({ where: { id: { in: internalIds } } })
      : [];

    const destinationAddresses = [
      ...internalRows.map((r) => r.address),
      ...rawAddresses,
    ];

    if (destinationAddresses.length === 0) {
      throw new Error('No destination addresses resolved');
    }

    const amount = parseEther(String(job.amountEth));
    const signer = new Wallet(decryptPrivateKey(fromRow.encryptedKey), engine.provider);
    const balance = await engine.provider.getBalance(signer.address);
    const totalRequired = amount * BigInt(destinationAddresses.length);

    if (balance < totalRequired) {
      const errStr = `Insufficient balance: wallet has ${formatEth(balance)} ETH, needs ${formatEth(totalRequired)} ETH for ${destinationAddresses.length} transfers`;
      await prisma.transferJob.update({
        where: { id: jobId },
        data: {
          status: 'failed',
          error: errStr,
          completedAt: new Date(),
        },
      });
      return;
    }

    const fee = await engine.provider.getFeeData();
    const results: ResultRow[] = [];
    let nonce = await engine.provider.getTransactionCount(signer.address, 'pending');

    for (const destAddress of destinationAddresses) {
      try {
        const tx = await signer.sendTransaction({
          to: destAddress,
          value: amount,
          nonce: nonce++,
          gasLimit: 25_000,
          ...(fee.maxFeePerGas ? { maxFeePerGas: fee.maxFeePerGas } : {}),
          ...(fee.maxPriorityFeePerGas ? { maxPriorityFeePerGas: fee.maxPriorityFeePerGas } : {}),
        });
        const receipt = await tx.wait();
        results.push({
          address: destAddress,
          txHash: receipt?.hash ?? tx.hash,
          status: receipt?.status === 1 ? 'success' : 'failed',
          detail: receipt?.status === 1 ? undefined : 'reverted',
        });
      } catch (err) {
        results.push({
          address: destAddress,
          txHash: null,
          status: 'failed',
          detail: sanitizeError(err),
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

/** Disperse: variable native amounts from one wallet to many addresses. */
async function runDisperse(jobId: string): Promise<void> {
  const job = await prisma.transferJob.findUniqueOrThrow({ where: { id: jobId } });
  const chainRow = await prisma.chain.findUnique({ where: { key: job.chainKey } });
  const profile = getChainProfile(job.chainKey);
  const engine = await buildEngine(
    job.chainKey,
    chainRow?.publicRpcs ?? profile?.rpc.public ?? [],
  );

  try {
    const fromRow = await prisma.wallet.findUniqueOrThrow({ where: { id: job.fromWalletId! } });
    const entries = (job.results as unknown as { address: string; amountEth: string }[]) ?? [];
    if (entries.length === 0) throw new Error('No disperse entries');

    const signer = new Wallet(decryptPrivateKey(fromRow.encryptedKey), engine.provider);
    const fee = await engine.provider.getFeeData();
    const results: ResultRow[] = [];
    let nonce = await engine.provider.getTransactionCount(signer.address, 'pending');

    for (const entry of entries) {
      try {
        const amount = parseEther(entry.amountEth);
        const tx = await signer.sendTransaction({
          to: entry.address,
          value: amount,
          nonce: nonce++,
          gasLimit: 25_000,
          ...(fee.maxFeePerGas ? { maxFeePerGas: fee.maxFeePerGas } : {}),
          ...(fee.maxPriorityFeePerGas ? { maxPriorityFeePerGas: fee.maxPriorityFeePerGas } : {}),
        });
        const receipt = await tx.wait();
        results.push({
          address: entry.address,
          txHash: receipt?.hash ?? tx.hash,
          status: receipt?.status === 1 ? 'success' : 'failed',
          detail: receipt?.status === 1 ? undefined : 'reverted',
        });
      } catch (err) {
        results.push({
          address: entry.address,
          txHash: null,
          status: 'failed',
          detail: sanitizeError(err),
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

/** Consolidate: drain many wallets (native or ERC-20) into one destination. */
async function runConsolidate(jobId: string): Promise<void> {
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
    const isErc20 = Boolean(job.tokenContract);

    const ERC20_ABI = ['function transfer(address to, uint256 amount) returns (bool)'];
    const results: ResultRow[] = [];

    for (const source of sourceRows) {
      try {
        const signer = new Wallet(decryptPrivateKey(source.encryptedKey), engine.provider);
        let txHash: string | null = null;
        if (isErc20) {
          const token = new Contract(job.tokenContract!, ERC20_ABI, signer);
          const balance: bigint = await token.balanceOf(source.address);
          if (balance <= 0n) {
            results.push({ address: source.address, txHash: null, status: 'success', detail: 'no balance' });
            continue;
          }
          // Leave a small buffer for gas if the token == gas token is not required
          const tx = await token.transfer(recipient, balance);
          const receipt = await tx.wait();
          txHash = receipt?.hash ?? tx.hash;
        } else {
          // Native: send balance minus a gas buffer
          const balance = await engine.provider.getBalance(source.address);
          const fee = await engine.provider.getFeeData();
          const gasLimit = 21_000n;
          const maxFee = (fee.maxFeePerGas ?? 0n) * gasLimit;
          const toSend = balance - maxFee;
          if (toSend <= 0n) {
            results.push({ address: source.address, txHash: null, status: 'success', detail: 'balance too low to consolidate' });
            continue;
          }
          const tx = await signer.sendTransaction({
            to: recipient,
            value: toSend,
            gasLimit: 21_000,
            ...(fee.maxFeePerGas ? { maxFeePerGas: fee.maxFeePerGas } : {}),
            ...(fee.maxPriorityFeePerGas ? { maxPriorityFeePerGas: fee.maxPriorityFeePerGas } : {}),
          });
          const receipt = await tx.wait();
          txHash = receipt?.hash ?? tx.hash;
        }
        results.push({ address: source.address, txHash, status: 'success' });
      } catch (err) {
        results.push({ address: source.address, txHash: null, status: 'failed', detail: sanitizeError(err) });
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
    const requestedFrom = job.fromBlock && job.fromBlock > 0 ? job.fromBlock : Math.max(0, currentBlock - 100_000);
    const toBlock = currentBlock;

    // Public RPCs cap eth_getLogs ranges (commonly 10_000 blocks). Walk the
    // window in safe chunks so large histories don't exceed the cap.
    const RW_CHECK = 9_000;
    const chunks: Array<{ from: number; to: number }> = [];
    for (let f = requestedFrom; f <= toBlock; f += RW_CHECK) {
      chunks.push({ from: f, to: Math.min(f + RW_CHECK - 1, toBlock) });
    }
    if (chunks.length === 0) chunks.push({ from: toBlock, to: toBlock });

    const results: ResultRow[] = [];

    for (const source of sourceRows) {
      try {
        const logs: Log[] = [];
        for (const c of chunks) {
          const part = await engine.provider.getLogs({
            address: token,
            topics: [
              TRANSFER_TOPIC,
              null,
              `0x${source.address.slice(2).toLowerCase().padStart(64, '0')}`,
            ],
            fromBlock: c.from,
            toBlock: c.to,
          });
          logs.push(...part);
        }
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
          detail: sanitizeError(err),
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
        } else if (record.kind === 'disperse') {
          await runDisperse(job.data.jobId);
        } else if (record.kind === 'consolidate') {
          await runConsolidate(job.data.jobId);
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

// NFT forwarding (osnm-z): after a successful mint, sweep the minted tokens
// to the task recipient with ERC-721 safeTransferFrom.

import { Contract, Wallet, type Provider } from 'ethers';

const ERC721_ABI = [
  'function safeTransferFrom(address from, address to, uint256 tokenId)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
];

const TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

/** Extract token ids minted to `minter` from a mint tx receipt's logs. */
export function extractMintedTokenIds(
  receiptLogs: readonly { address: string; topics: string[]; data: string }[],
  nftContract: string,
  minter: string,
): string[] {
  const tokenIds: string[] = [];
  const topicMinter = `0x${minter.slice(2).toLowerCase().padStart(64, '0')}`;

  for (const log of receiptLogs) {
    if (log.address.toLowerCase() !== nftContract.toLowerCase()) continue;
    if (log.topics[0] !== TRANSFER_TOPIC) continue;
    if (log.topics[2]?.toLowerCase() !== topicMinter) continue;
    tokenIds.push(BigInt(log.topics[3]).toString());
  }
  return tokenIds;
}

export async function forwardNfts(
  provider: Provider,
  wallet: Wallet,
  nftContract: string,
  tokenIds: string[],
  recipient: string,
): Promise<string[]> {
  const erc721 = new Contract(nftContract, ERC721_ABI, wallet.connect(provider));
  const txHashes: string[] = [];
  for (const tokenId of tokenIds) {
    const tx = await erc721.safeTransferFrom(wallet.address, recipient, tokenId);
    const receipt = await tx.wait();
    txHashes.push(receipt?.hash ?? tx.hash);
  }
  return txHashes;
}

export { ERC721_ABI };

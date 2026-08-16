// Ported from nft-public-mint/src/seadrop-public.ts.
//
// Build SeaDrop public-mint calldata locally, with no OpenSea involvement:
// a public stage is unsigned, so mintPublic() only needs the drop's own
// parameters, which are readable on-chain ahead of time.

import { Contract, Interface, JsonRpcProvider, type Provider } from 'ethers';

export const SEADROP_ADDRESS = '0x00005EA00Ac477B1030CE78506496e8C2dE24bf5';
export const OPENSEA_FEE_RECIPIENT = '0x0000a26b00c1F0DF003000390027140000fAa719';

const PUBLIC_ABI = [
  'function mintPublic(address nftContract, address feeRecipient, address minterIfNotPayer, uint256 quantity) payable',
  'function getPublicDrop(address nftContract) view returns (tuple(uint80 mintPrice, uint48 startTime, uint48 endTime, uint16 maxTotalMintableByWallet, uint16 feeBps, bool restrictFeeRecipients))',
  'function getAllowedFeeRecipients(address nftContract) view returns (address[])',
];

const IFACE = new Interface(PUBLIC_ABI);

export interface PublicDrop {
  mintPrice: bigint;
  startTime: number;
  endTime: number;
  maxTotalMintableByWallet: number;
  feeBps: number;
  restrictFeeRecipients: boolean;
}

export interface ResolvedFee {
  address: string;
  fromAllowedList: boolean;
}

export interface LocalMintPlan {
  to: string;
  data: string;
  value: bigint;
  drop: PublicDrop;
  feeRecipient: string;
}

/** Reads the drop parameters straight from the chain. Null when no drop is set. */
export async function fetchPublicDrop(
  provider: Provider,
  seadropAddress: string,
  nftContract: string,
): Promise<PublicDrop | null> {
  const seadrop = new Contract(seadropAddress, PUBLIC_ABI, provider);
  const raw = await seadrop.getPublicDrop(nftContract);
  const drop: PublicDrop = {
    mintPrice: BigInt(raw.mintPrice),
    startTime: Number(raw.startTime),
    endTime: Number(raw.endTime),
    maxTotalMintableByWallet: Number(raw.maxTotalMintableByWallet),
    feeBps: Number(raw.feeBps),
    restrictFeeRecipients: Boolean(raw.restrictFeeRecipients),
  };
  if (drop.startTime === 0 && drop.endTime === 0 && drop.maxTotalMintableByWallet === 0) {
    return null;
  }
  return drop;
}

/** Allowed list first; OpenSea default only when unrestricted; null otherwise. */
export async function resolveFeeRecipient(
  provider: Provider,
  seadropAddress: string,
  nftContract: string,
  drop: PublicDrop,
): Promise<ResolvedFee | null> {
  if (drop.restrictFeeRecipients) {
    const seadrop = new Contract(seadropAddress, PUBLIC_ABI, provider);
    const allowed: string[] = await seadrop.getAllowedFeeRecipients(nftContract);
    if (allowed.length === 0) return null;
    return { address: allowed[0], fromAllowedList: true };
  }
  return { address: OPENSEA_FEE_RECIPIENT, fromAllowedList: false };
}

export function encodeMintPublic(
  nftContract: string,
  feeRecipient: string,
  quantity: number,
): string {
  // minterIfNotPayer = address(0): mint to the tx sender.
  return IFACE.encodeFunctionData('mintPublic', [
    nftContract,
    feeRecipient,
    '0x0000000000000000000000000000000000000000',
    quantity,
  ]);
}

/** Returns null when the contract has no public drop configured. */
export async function buildLocalMintPlan(
  provider: Provider,
  seadropAddress: string,
  nftContract: string,
  quantity: number,
): Promise<LocalMintPlan | null> {
  const drop = await fetchPublicDrop(provider, seadropAddress, nftContract);
  if (!drop) return null;
  const fee = await resolveFeeRecipient(provider, seadropAddress, nftContract, drop);
  if (!fee) return null;
  return {
    to: seadropAddress,
    data: encodeMintPublic(nftContract, fee.address, quantity),
    value: drop.mintPrice * BigInt(quantity),
    drop,
    feeRecipient: fee.address,
  };
}

/** Convenience for scheduling: the on-chain stage start (seconds), or null. */
export async function fetchPublicDropStart(
  rpcUrl: string,
  seadropAddress: string,
  nftContract: string,
): Promise<number | null> {
  const provider = new JsonRpcProvider(rpcUrl);
  try {
    const drop = await fetchPublicDrop(provider, seadropAddress, nftContract);
    if (!drop || drop.startTime === 0) return null;
    return drop.startTime;
  } finally {
    await provider.destroy();
  }
}

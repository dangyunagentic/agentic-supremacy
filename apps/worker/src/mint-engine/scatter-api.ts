import { Interface, Contract, ethers, parseEther } from 'ethers';

export interface ScatterCollectionInfo {
  name: string;
  slug: string;
  contractAddress: string;
  chainKey: string;
  mintPriceEth: string;
  maxPerWallet: number;
  isLive: boolean;
  startTime: number | null;
  mintFunction: string;
  isAllowlist: boolean;
  merkleRoot?: string | null;
}

// Common Scatter Mint ABI Selectors
export const SCATTER_MINT_ABI = [
  'function mint(uint256 numberOfTokens) external payable',
  'function mint(address to, uint256 numberOfTokens) external payable',
  'function mint(uint256 numberOfTokens, bytes32[] calldata merkleProof) external payable',
  'function publicMint(uint256 numberOfTokens) external payable',
  'function mintCustom(uint256 numberOfTokens, bytes calldata data) external payable',
  'function getMintPrice() external view returns (uint256)',
  'function mintPrice() external view returns (uint256)',
  'function price() external view returns (uint256)',
  'function cost() external view returns (uint256)',
  'function maxMintPerWallet() external view returns (uint256)',
  'function maxPerWallet() external view returns (uint256)',
  'function isPublicMintActive() external view returns (bool)',
  'function paused() external view returns (bool)',
];

const SCATTER_CHAIN_MAP: Record<string, string> = {
  ethereum: 'ethereum',
  eth: 'ethereum',
  mainnet: 'ethereum',
  base: 'base',
  polygon: 'polygon',
  matic: 'polygon',
  arbitrum: 'arbitrum',
  optimism: 'optimism',
  blast: 'blast',
  zora: 'zora',
  sei: 'sei',
  berachain: 'berachain',
};

export class ScatterApiClient {
  /**
   * Fetch collection metadata from Scatter API or on-chain fallback
   */
  async fetchCollection(slugOrAddress: string, chainKey: string = 'base'): Promise<ScatterCollectionInfo | null> {
    const isAddress = /^0x[a-fA-F0-9]{40}$/.test(slugOrAddress);
    const normalizedChain = SCATTER_CHAIN_MAP[chainKey.toLowerCase()] || chainKey;

    try {
      const url = isAddress
        ? `https://api.scatter.art/v1/collection/address/${slugOrAddress}`
        : `https://api.scatter.art/v1/collection/${slugOrAddress}`;

      const res = await fetch(url, {
        headers: {
          accept: 'application/json',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        signal: AbortSignal.timeout(6000),
      });

      if (res.ok) {
        const data = (await res.json()) as any;
        const col = data.collection || data;
        return {
          name: col.name || slugOrAddress,
          slug: col.slug || slugOrAddress,
          contractAddress: col.address || (isAddress ? slugOrAddress : ''),
          chainKey: col.chain || normalizedChain,
          mintPriceEth: col.mintPrice ? String(col.mintPrice) : '0',
          maxPerWallet: col.maxPerWallet || 0,
          isLive: col.isLive ?? true,
          startTime: col.mintStartTime ? Math.floor(new Date(col.mintStartTime).getTime() / 1000) : null,
          mintFunction: col.mintFunction || 'mint(uint256)',
          isAllowlist: col.isAllowlist ?? false,
          merkleRoot: col.merkleRoot || null,
        };
      }
    } catch {
      // API fallback
    }

    if (isAddress) {
      return {
        name: slugOrAddress,
        slug: slugOrAddress,
        contractAddress: slugOrAddress,
        chainKey: normalizedChain,
        mintPriceEth: '0',
        maxPerWallet: 0,
        isLive: true,
        startTime: null,
        mintFunction: 'mint(uint256)',
        isAllowlist: false,
      };
    }

    return null;
  }

  /**
   * Build execution calldata for Scatter.art contract
   */
  async buildMintCalldata(
    provider: ethers.Provider,
    contractAddress: string,
    quantity: number,
    recipientAddress: string,
    proof: string[] = [],
  ): Promise<{ to: string; data: string; value: bigint }> {
    const contract = new Contract(contractAddress, SCATTER_MINT_ABI, provider);
    const iface = new Interface(SCATTER_MINT_ABI);

    // Try reading mint price from contract
    let unitPrice = 0n;
    for (const method of ['getMintPrice', 'mintPrice', 'price', 'cost']) {
      try {
        unitPrice = await contract[method]();
        if (unitPrice > 0n) break;
      } catch {
        // continue
      }
    }

    const totalValue = unitPrice * BigInt(quantity);

    // If merkle proof provided, use mint with proof
    if (proof && proof.length > 0) {
      try {
        const data = iface.encodeFunctionData('mint(uint256,bytes32[])', [quantity, proof]);
        return { to: contractAddress, data, value: totalValue };
      } catch {
        // fallback
      }
    }

    // Try standard mint(uint256)
    try {
      const data = iface.encodeFunctionData('mint(uint256)', [quantity]);
      return { to: contractAddress, data, value: totalValue };
    } catch {
      // Try mint(address,uint256)
      try {
        const data = iface.encodeFunctionData('mint(address,uint256)', [recipientAddress, quantity]);
        return { to: contractAddress, data, value: totalValue };
      } catch {
        // Try publicMint(uint256)
        const data = iface.encodeFunctionData('publicMint(uint256)', [quantity]);
        return { to: contractAddress, data, value: totalValue };
      }
    }
  }
}

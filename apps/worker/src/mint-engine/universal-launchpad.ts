import { Contract, Interface, ethers, parseEther } from 'ethers';
import { fetchPublicDrop, buildLocalMintPlan, type LocalMintPlan } from './seadrop-public';
import { ScatterApiClient, SCATTER_MINT_ABI } from './scatter-api';

export type LaunchpadProtocol = 'seadrop' | 'scatter' | 'zora' | 'thirdweb' | 'generic';

export interface UniversalMintPlan {
  protocol: LaunchpadProtocol;
  to: string;
  data: string;
  value: bigint;
  mintPrice: bigint;
  startTime: number | null;
}

// Universal ABI for popular mint functions
export const UNIVERSAL_MINT_ABI = [
  // SeaDrop
  'function mintPublic(address nftContract, address feeRecipient, address minterIfNotPayer, uint256 quantity) external payable',
  
  // Standard & Scatter & ERC-721A
  'function mint(uint256 quantity) external payable',
  'function mint(uint256 quantity, bytes32[] calldata merkleProof) external payable',
  'function mint(address recipient, uint256 quantity) external payable',
  'function publicMint(uint256 quantity) external payable',
  'function safeMint(address to, uint256 quantity) external payable',
  
  // Zora
  'function mintWithRewards(address recipient, uint256 quantity, string comment, address mintReferral) external payable',
  
  // Thirdweb & Manifold
  'function claim(address receiver, uint256 quantity, address currency, uint256 pricePerToken, tuple(bytes32[] proof, uint256 maxQuantityPerMint, uint256 pricePerToken, address currency) allowlistProof, bytes data) external payable',
  
  // Custom / View price functions
  'function mintPrice() external view returns (uint256)',
  'function getMintPrice() external view returns (uint256)',
  'function price() external view returns (uint256)',
  'function cost() external view returns (uint256)',
  'function fee() external view returns (uint256)',
];

export class UniversalLaunchpadEngine {
  private readonly scatter = new ScatterApiClient();

  /**
   * Detects launchpad protocol and builds instant execution calldata
   */
  async buildUniversalPlan(
    provider: ethers.Provider,
    seadropAddress: string,
    targetInput: string,
    quantity: number,
    recipientAddress: string,
    chainKey: string,
  ): Promise<UniversalMintPlan> {
    const isAddress = /^0x[a-fA-F0-9]{40}$/.test(targetInput);

    // 1. Check if it's SeaDrop (OpenSea)
    if (isAddress) {
      try {
        const seaDropPlan = await buildLocalMintPlan(provider, seadropAddress, targetInput, quantity);
        if (seaDropPlan && seaDropPlan.drop.startTime !== null) {
          return {
            protocol: 'seadrop',
            to: seaDropPlan.to,
            data: seaDropPlan.data,
            value: seaDropPlan.value,
            mintPrice: seaDropPlan.drop.mintPrice,
            startTime: seaDropPlan.drop.startTime,
          };
        }
      } catch {
        // Not a SeaDrop contract
      }
    }

    // 2. Check if Scatter.art (via URL, slug, or address)
    const isScatterUrl = targetInput.includes('scatter.art');
    if (isScatterUrl || !isAddress) {
      const slug = targetInput.replace(/https?:\/\/(www\.)?scatter\.art\/(collection\/)?/i, '').replace(/\/.*$/, '');
      const scatterInfo = await this.scatter.fetchCollection(slug || targetInput, chainKey);
      if (scatterInfo && scatterInfo.contractAddress) {
        const calldata = await this.scatter.buildMintCalldata(
          provider,
          scatterInfo.contractAddress,
          quantity,
          recipientAddress,
        );
        return {
          protocol: 'scatter',
          to: calldata.to,
          data: calldata.data,
          value: calldata.value,
          mintPrice: parseEther(scatterInfo.mintPriceEth || '0'),
          startTime: scatterInfo.startTime,
        };
      }
    }

    // 3. Generic EVM Contract Direct Inspection (ERC-721 / Zora / Thirdweb fallback)
    if (isAddress) {
      const contract = new Contract(targetInput, UNIVERSAL_MINT_ABI, provider);
      const iface = new Interface(UNIVERSAL_MINT_ABI);

      let unitPrice = 0n;
      for (const fn of ['mintPrice', 'getMintPrice', 'price', 'cost', 'fee']) {
        try {
          unitPrice = await contract[fn]();
          if (unitPrice > 0n) break;
        } catch {
          // continue
        }
      }

      const totalValue = unitPrice * BigInt(quantity);

      // Check Zora mintWithRewards
      try {
        const data = iface.encodeFunctionData('mintWithRewards', [
          recipientAddress,
          quantity,
          '',
          ethers.ZeroAddress,
        ]);
        return {
          protocol: 'zora',
          to: targetInput,
          data,
          value: totalValue > 0n ? totalValue : parseEther('0.000777') * BigInt(quantity),
          mintPrice: unitPrice,
          startTime: null,
        };
      } catch {
        // fallback
      }

      // Check standard mint(uint256)
      try {
        const data = iface.encodeFunctionData('mint(uint256)', [quantity]);
        return {
          protocol: 'generic',
          to: targetInput,
          data,
          value: totalValue,
          mintPrice: unitPrice,
          startTime: null,
        };
      } catch {
        // Check mint(address,uint256)
        try {
          const data = iface.encodeFunctionData('mint(address,uint256)', [recipientAddress, quantity]);
          return {
            protocol: 'generic',
            to: targetInput,
            data,
            value: totalValue,
            mintPrice: unitPrice,
            startTime: null,
          };
        } catch {
          // Check publicMint(uint256)
          const data = iface.encodeFunctionData('publicMint(uint256)', [quantity]);
          return {
            protocol: 'generic',
            to: targetInput,
            data,
            value: totalValue,
            mintPrice: unitPrice,
            startTime: null,
          };
        }
      }
    }

    throw new Error(`Unsupported launchpad format or contract: ${targetInput}`);
  }
}

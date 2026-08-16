export interface WalletEntity {
  id: string;
  userId: string;
  address: string;
  /** AES-256-GCM ciphertext, base64. Never leaves infrastructure. */
  encryptedKey: string;
  label: string | null;
  chainId: number;
  createdAt: Date;
}

import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import type { KeyEncryptionPort } from '../../domain/ports/ports';

const ALGO = 'aes-256-gcm';
const KEY_LEN = 32;
const IV_LEN = 16;
const TAG_LEN = 16;
const SALT_LEN = 16;

// Layout: salt(16) | iv(16) | tag(16) | ciphertext, base64-encoded.
@Injectable()
export class AesGcmKeyEncryption implements KeyEncryptionPort {
  private masterKey(): string {
    const key = process.env.MASTER_KEY;
    if (!key || key.length < 16) {
      throw new Error('MASTER_KEY env var must be set (min 16 chars)');
    }
    return key;
  }

  encrypt(privateKey: string): string {
    const salt = randomBytes(SALT_LEN);
    const key = scryptSync(this.masterKey(), salt, KEY_LEN);
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv(ALGO, key, iv);
    const encrypted = Buffer.concat([cipher.update(privateKey, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([salt, iv, tag, encrypted]).toString('base64');
  }

  decrypt(ciphertext: string): string {
    const buf = Buffer.from(ciphertext, 'base64');
    const salt = buf.subarray(0, SALT_LEN);
    const iv = buf.subarray(SALT_LEN, SALT_LEN + IV_LEN);
    const tag = buf.subarray(SALT_LEN + IV_LEN, SALT_LEN + IV_LEN + TAG_LEN);
    const encrypted = buf.subarray(SALT_LEN + IV_LEN + TAG_LEN);
    const key = scryptSync(this.masterKey(), salt, KEY_LEN);
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  }
}

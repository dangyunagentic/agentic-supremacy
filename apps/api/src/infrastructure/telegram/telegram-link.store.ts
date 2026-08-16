import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import type { TelegramLinkPort } from '../../domain/ports/ports';

interface PendingLink {
  userId: string;
  expiresAt: number;
}

const TTL_MS = 15 * 60 * 1000;

/**
 * In-memory pairing codes. Single API instance per deployment (see the VPS
 * layout in DESIGN.md), so a Map is sufficient; swap for Redis if the API
 * ever scales horizontally.
 */
@Injectable()
export class InMemoryTelegramLinkStore implements TelegramLinkPort {
  private readonly codes = new Map<string, PendingLink>();

  createCode(userId: string): { code: string; expiresAt: Date } {
    this.sweep();
    const code = randomBytes(4).toString('hex').toUpperCase();
    const expiresAt = Date.now() + TTL_MS;
    this.codes.set(code, { userId, expiresAt });
    return { code, expiresAt: new Date(expiresAt) };
  }

  consumeCode(code: string, _telegramId: string): string | null {
    this.sweep();
    const entry = this.codes.get(code.trim().toUpperCase());
    if (!entry) return null;
    this.codes.delete(code.trim().toUpperCase());
    return entry.userId;
  }

  private sweep() {
    const now = Date.now();
    for (const [code, entry] of this.codes) {
      if (entry.expiresAt < now) this.codes.delete(code);
    }
  }
}

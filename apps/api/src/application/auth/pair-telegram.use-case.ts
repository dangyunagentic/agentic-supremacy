import { Inject, Injectable } from '@nestjs/common';
import { TOKENS } from '../../domain/tokens';
import type { TelegramLinkPort } from '../../domain/ports/ports';

@Injectable()
export class CreateTelegramPairCodeUseCase {
  constructor(@Inject(TOKENS.TelegramLink) private readonly links: TelegramLinkPort) {}

  execute(userId: string) {
    return this.links.createCode(userId);
  }
}

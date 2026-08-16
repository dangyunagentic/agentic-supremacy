import { Inject, Injectable } from '@nestjs/common';
import { TOKENS } from '../../domain/tokens';
import type { NotifierPort } from '../../domain/ports/ports';
import type { UserRepository } from '../../domain/repositories/user.repository';
import { TelegramBotService } from './telegram-bot.service';

@Injectable()
export class TelegramNotifier implements NotifierPort {
  constructor(
    @Inject(TOKENS.UserRepository) private readonly users: UserRepository,
    private readonly bot: TelegramBotService,
  ) {}

  async notifyUser(userId: string, message: string): Promise<void> {
    const user = await this.users.findById(userId);
    if (!user?.telegramId) return; // web-only users get dashboard toasts
    await this.bot.sendTelegram(user.telegramId, message);
  }
}

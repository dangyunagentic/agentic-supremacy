import { Global, Module } from '@nestjs/common';
import { TelegramBotService } from './telegram-bot.service';
import { TelegramNotifier } from './telegram-notifier';
import { InMemoryTelegramLinkStore } from './telegram-link.store';
import { TOKENS } from '../../domain/tokens';
import { CreateWalletUseCase } from '../../application/wallets/create-wallet.use-case';
import { GetAdminStatsUseCase } from '../../application/admin/system.use-cases';
import { AdminUpdateUserUseCase } from '../../application/admin/user.use-cases';

@Global()
@Module({
  providers: [
    InMemoryTelegramLinkStore,
    CreateWalletUseCase,
    GetAdminStatsUseCase,
    AdminUpdateUserUseCase,
    TelegramBotService,
    { provide: TOKENS.Notifier, useClass: TelegramNotifier },
    { provide: TOKENS.TelegramLink, useExisting: InMemoryTelegramLinkStore },
  ],
  exports: [TOKENS.Notifier, TOKENS.TelegramLink],
})
export class TelegramModule {}

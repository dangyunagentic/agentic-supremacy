import { forwardRef, Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Telegraf, type Context as TelegrafContext } from 'telegraf';
import { Role, TaskStatus, shortAddress } from '@mintbot/shared';
import { TOKENS } from '../../domain/tokens';
import type { UserRepository } from '../../domain/repositories/user.repository';
import type { TaskRepository } from '../../domain/repositories/task.repository';
import type { WalletRepository } from '../../domain/repositories/wallet.repository';
import type { NotifierPort, TelegramLinkPort } from '../../domain/ports/ports';
import { CreateWalletUseCase } from '../../application/wallets/create-wallet.use-case';
import { GetAdminStatsUseCase } from '../../application/admin/system.use-cases';
import { AdminUpdateUserUseCase } from '../../application/admin/user.use-cases';

interface Ctx extends TelegrafContext {
  // resolved account for the linked telegram id, set by the middleware below
  session?: { userId: string; role: Role };
}

/**
 * Telegram adapter. Registers every command from the PRD and forwards to the
 * same application use cases the REST API uses.
 */
@Injectable()
export class TelegramBotService implements OnModuleDestroy {
  private readonly logger = new Logger(TelegramBotService.name);
  private readonly bot?: Telegraf<Ctx>;

  constructor(
    @Inject(TOKENS.UserRepository) private readonly users: UserRepository,
    @Inject(TOKENS.TaskRepository) private readonly tasks: TaskRepository,
    @Inject(TOKENS.WalletRepository) private readonly wallets: WalletRepository,
    @Inject(TOKENS.TelegramLink) private readonly links: TelegramLinkPort,
    @Inject(forwardRef(() => TOKENS.Notifier)) private readonly notifier: NotifierPort,
    private readonly createWallet: CreateWalletUseCase,
    private readonly getStats: GetAdminStatsUseCase,
    private readonly updateUser: AdminUpdateUserUseCase,
  ) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      this.logger.warn('TELEGRAM_BOT_TOKEN not set; bot disabled');
      return;
    }
    this.bot = new Telegraf<Ctx>(token);
    this.register();
    void this.bot.telegram.deleteWebhook().catch(() => undefined);
    void this.bot.launch().catch((err) => this.logger.error(`Bot launch failed: ${err.message}`));
  }

  private register() {
    const bot = this.bot!;

    bot.use(async (ctx, next) => {
      if (!ctx.from) return;
      const user = await this.users.findByTelegramId(String(ctx.from.id));
      if (user) ctx.session = { userId: user.id, role: user.role };
      return next();
    });

    bot.start(async (ctx) => {
      const code = ctx.message?.text?.split(/\s+/)[1];
      if (code && ctx.from) {
        const userId = this.links.consumeCode(code, String(ctx.from.id));
        if (!userId) return ctx.reply('That pairing code is invalid or expired. Generate a new one from the dashboard.');
        await this.users.update(userId, { telegramId: String(ctx.from.id) });
        return ctx.reply('Account linked. You will now receive task notifications here.');
      }
      return ctx.reply(
        'Mintbot\n\nOpen the web dashboard, go to Profile and generate a Telegram pairing code, then send:\n/start <code>',
      );
    });

    bot.command('tasks', async (ctx) => {
      const s = ctx.session;
      if (!s) return ctx.reply('Link your account first: /start <pairing-code>');
      const list = await this.tasks.list({ page: 1, limit: 10, ownerId: s.userId });
      if (list.data.length === 0) return ctx.reply('No tasks yet. Create one from the dashboard.');
      const lines = list.data.map(
        (t) => `${statusIcon(t.status)} ${t.name} - ${t.status} (${t.chainKey})`,
      );
      return ctx.reply(['Your tasks:', ...lines].join('\n'));
    });

    bot.command('newtask', (ctx) =>
      ctx.reply(
        `Create tasks from the dashboard wizard:\n${process.env.WEB_URL ?? 'http://localhost:3000'}/tasks/new`,
      ),
    );

    bot.command('task', async (ctx) => {
      const s = ctx.session;
      const id = ctx.message?.text?.split(/\s+/)[1];
      if (!s || !id) return ctx.reply('Usage: /task <task-id>');
      const task = await this.tasks.findById(id);
      if (!task || (s.role !== Role.Admin && task.userId !== s.userId)) {
        return ctx.reply('Task not found.');
      }
      return ctx.reply(
        [
          `Task: ${task.name}`,
          `Status: ${task.status}`,
          `Chain: ${task.chainKey}`,
          `Wallets: ${task.walletIds.length} x ${task.quantity}`,
          `Mode: ${task.mintMode} / ${task.walletMode}`,
          task.resolvedFireAt ? `Fire at: ${task.resolvedFireAt.toISOString()}` : 'Fire at: waiting for stage',
        ].join('\n'),
      );
    });

    bot.command('stop', async (ctx) => {
      const s = ctx.session;
      const id = ctx.message?.text?.split(/\s+/)[1];
      if (!s || !id) return ctx.reply('Usage: /stop <task-id>');
      const task = await this.tasks.findById(id);
      if (!task || (s.role !== Role.Admin && task.userId !== s.userId)) {
        return ctx.reply('Task not found.');
      }
      await this.tasks.updateStatus(id, TaskStatus.Cancelled, { completedAt: new Date() });
      await this.notifier.notifyUser(task.userId, `Task "${task.name}" was cancelled.`);
      return ctx.reply('Task cancelled.');
    });

    bot.command('wallets', async (ctx) => {
      const s = ctx.session;
      if (!s) return ctx.reply('Link your account first: /start <pairing-code>');
      const list = await this.wallets.listByUser(s.userId);
      if (list.length === 0) return ctx.reply('No wallets. Add one with /addwallet');
      return ctx.reply(['Your wallets:', ...list.map((w) => `${shortAddress(w.address)} ${w.label ?? ''}`)].join('\n'));
    });

    bot.command('addwallet', async (ctx) => {
      const s = ctx.session;
      if (!s) return ctx.reply('Link your account first: /start <pairing-code>');
      const arg = ctx.message?.text?.split(/\s+/).slice(1).join(' ');
      try {
        const wallet = await this.createWallet.execute(
          arg ? { userId: s.userId, mode: 'import', privateKey: arg } : { userId: s.userId, mode: 'generate' },
        );
        return ctx.reply(`Wallet added: ${shortAddress(wallet.address)}\nKey is encrypted at rest and never shown again.`);
      } catch (err) {
        return ctx.reply(`Could not add wallet: ${(err as Error).message}`);
      }
    });

    bot.command('balance', async (ctx) => {
      const s = ctx.session;
      if (!s) return ctx.reply('Link your account first: /start <pairing-code>');
      const list = await this.wallets.listByUser(s.userId);
      if (list.length === 0) return ctx.reply('No wallets yet.');
      return ctx.reply(
        ['Balances are chain-dependent; check live values in the dashboard:', ...list.map((w) => shortAddress(w.address))].join('\n'),
      );
    });

    bot.command('help', (ctx) =>
      ctx.reply(
        [
          'Commands:',
          '/tasks - list your tasks',
          '/task <id> - task detail',
          '/stop <id> - cancel a task',
          '/newtask - open the creation wizard',
          '/wallets - list your wallets',
          '/addwallet [key] - generate or import a wallet',
          '/balance - wallet info',
          ...(ctx.session?.role === Role.Admin
            ? ['Admin: /users, /suspend <id>, /stats, /active, /chains']
            : []),
        ].join('\n'),
      ),
    );

    // ── Admin commands ──
    bot.command('users', async (ctx) => {
      if (ctx.session?.role !== Role.Admin) return ctx.reply('Admin only.');
      const list = await this.users.list({ page: 1, limit: 20 });
      return ctx.reply(
        ['Users:', ...list.data.map((u) => `${u.username} - ${u.role} - ${u.status}`)].join('\n'),
      );
    });

    bot.command('suspend', async (ctx) => {
      if (ctx.session?.role !== Role.Admin) return ctx.reply('Admin only.');
      const id = ctx.message?.text?.split(/\s+/)[1];
      if (!id) return ctx.reply('Usage: /suspend <user-id>');
      await this.updateUser.execute(ctx.session.userId, id, { status: 'suspended' });
      return ctx.reply('User suspended.');
    });

    bot.command('stats', async (ctx) => {
      if (ctx.session?.role !== Role.Admin) return ctx.reply('Admin only.');
      const stats = await this.getStats.execute();
      return ctx.reply(
        [
          'System stats:',
          `Users: ${stats.totalUsers}`,
          `Wallets: ${stats.totalWallets}`,
          `Tasks: ${stats.totalTasks} (active ${stats.activeTasks})`,
          `Success rate: ${(stats.successRate * 100).toFixed(1)}%`,
          `NFTs minted: ${stats.totalMinted}`,
        ].join('\n'),
      );
    });

    bot.command('active', async (ctx) => {
      if (ctx.session?.role !== Role.Admin) return ctx.reply('Admin only.');
      const list = await this.tasks.list({
        page: 1,
        limit: 20,
        statuses: ['scheduled', 'pre_flight', 'calldata', 'pre_sign', 'dispatching', 'awaiting_receipt'],
      });
      if (list.data.length === 0) return ctx.reply('No active tasks.');
      return ctx.reply(['Active tasks:', ...list.data.map((t) => `${t.name} - ${t.status}`)].join('\n'));
    });

    bot.command('chains', async (ctx) => {
      if (ctx.session?.role !== Role.Admin) return ctx.reply('Admin only.');
      const list = await import('@mintbot/shared').then((m) => Object.values(m.CHAIN_PROFILES));
      return ctx.reply(
        ['Configured chain profiles:', ...list.map((c) => `${c.key} (${c.chainId}) - ${c.name}`)].join('\n'),
      );
    });
  }

  async sendTelegram(telegramId: string, message: string): Promise<void> {
    if (!this.bot) return;
    await this.bot.telegram.sendMessage(telegramId, message).catch((err) => {
      this.logger.warn(`Telegram send failed to ${telegramId}: ${err.message}`);
    });
  }

  async onModuleDestroy() {
    await this.bot?.stop();
  }
}

function statusIcon(status: TaskStatus): string {
  if (status === TaskStatus.Completed) return '[ok]';
  if (status === TaskStatus.Failed) return '[fail]';
  if (status === TaskStatus.Cancelled) return '[stop]';
  return `[${status}]`;
}

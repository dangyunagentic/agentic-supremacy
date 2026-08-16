import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../shared/jwt.strategy';
import { CurrentUser } from '../shared/current-user.decorator';
import type { RequestUser } from '../shared/jwt.strategy';
import { LoginDto, RefreshDto, RegisterDto } from '../dto/auth.dto';
import { LoginUseCase, MeUseCase, RefreshUseCase } from '../../application/auth/login.use-case';
import { RegisterUseCase } from '../../application/auth/register.use-case';
import { CreateTelegramPairCodeUseCase } from '../../application/auth/pair-telegram.use-case';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly register: RegisterUseCase,
    private readonly login: LoginUseCase,
    private readonly refresh: RefreshUseCase,
    private readonly me: MeUseCase,
    private readonly pairCode: CreateTelegramPairCodeUseCase,
  ) {}

  @Post('register')
  @Throttle({ default: { limit: 3, ttl: 3600_000 } })
  registerAction(@Body() dto: RegisterDto) {
    return this.register.execute(dto);
  }

  @Post('login')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  loginAction(@Body() dto: LoginDto) {
    return this.login.execute(dto.email, dto.password);
  }

  @Post('refresh')
  refreshAction(@Body() dto: RefreshDto) {
    return this.refresh.execute(dto.refreshToken);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  meAction(@CurrentUser() user: RequestUser) {
    return this.me.execute(user.userId);
  }

  @Post('telegram/pair-code')
  @UseGuards(JwtAuthGuard)
  pairCodeAction(@CurrentUser() user: RequestUser) {
    return this.pairCode.execute(user.userId);
  }
}

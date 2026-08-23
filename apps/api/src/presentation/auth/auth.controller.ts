import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@mintbot/shared';
import { JwtAuthGuard, Public } from '../shared/jwt.strategy';
import { CurrentUser } from '../shared/current-user.decorator';
import { Roles, RolesGuard } from '../shared/roles.guard';
import type { RequestUser } from '../shared/jwt.strategy';
import { LoginDto, LogoutDto, RefreshDto, RegisterDto, ChangePasswordDto } from '../dto/auth.dto';
import {
  LoginUseCase,
  LogoutUseCase,
  MeUseCase,
  RefreshUseCase,
} from '../../application/auth/login.use-case';
import { RegisterUseCase } from '../../application/auth/register.use-case';
import { ChangePasswordUseCase } from '../../application/auth/change-password.use-case';
import { CreateTelegramPairCodeUseCase } from '../../application/auth/pair-telegram.use-case';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly register: RegisterUseCase,
    private readonly login: LoginUseCase,
    private readonly refresh: RefreshUseCase,
    private readonly logout: LogoutUseCase,
    private readonly me: MeUseCase,
    private readonly pairCode: CreateTelegramPairCodeUseCase,
    private readonly changePassword: ChangePasswordUseCase,
  ) {}

  @Post('register')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.Admin)
  @Throttle({ default: { limit: 3, ttl: 3600_000 } })
  registerAction(@Body() dto: RegisterDto) {
    return this.register.execute(dto);
  }

  @Public()
  @Post('login')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  loginAction(@Body() dto: LoginDto) {
    return this.login.execute(dto.identifier, dto.password);
  }

  @Public()
  @Post('refresh')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  refreshAction(@Body() dto: RefreshDto) {
    return this.refresh.execute(dto.refreshToken);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  logoutAction(@Body() dto: LogoutDto) {
    return this.logout.execute(dto?.refreshToken);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  meAction(@CurrentUser() user: RequestUser) {
    return this.me.execute(user.userId);
  }

  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  changePasswordAction(@CurrentUser() user: RequestUser, @Body() dto: ChangePasswordDto) {
    return this.changePassword.execute({
      userId: user.userId,
      currentPassword: dto.currentPassword,
      newPassword: dto.newPassword,
    });
  }

  @Post('telegram/pair-code')
  @UseGuards(JwtAuthGuard)
  pairCodeAction(@CurrentUser() user: RequestUser) {
    return this.pairCode.execute(user.userId);
  }
}

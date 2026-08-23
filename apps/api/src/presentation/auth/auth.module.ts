import { Module } from '@nestjs/common';
import { JwtStrategy } from '../shared/jwt.strategy';
import { AuthController } from './auth.controller';
import { RegisterUseCase } from '../../application/auth/register.use-case';
import {
  LoginUseCase,
  LogoutUseCase,
  MeUseCase,
  RefreshUseCase,
} from '../../application/auth/login.use-case';
import { CreateTelegramPairCodeUseCase } from '../../application/auth/pair-telegram.use-case';
import { ChangePasswordUseCase } from '../../application/auth/change-password.use-case';

@Module({
  providers: [
    JwtStrategy,
    RegisterUseCase,
    LoginUseCase,
    RefreshUseCase,
    LogoutUseCase,
    MeUseCase,
    CreateTelegramPairCodeUseCase,
    ChangePasswordUseCase,
  ],
  controllers: [AuthController],
})
export class AuthModule {}

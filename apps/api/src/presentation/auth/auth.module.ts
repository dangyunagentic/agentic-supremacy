import { Module } from '@nestjs/common';
import { JwtStrategy } from '../shared/jwt.strategy';
import { AuthController } from './auth.controller';
import { RegisterUseCase } from '../../application/auth/register.use-case';
import { LoginUseCase, MeUseCase, RefreshUseCase } from '../../application/auth/login.use-case';
import { CreateTelegramPairCodeUseCase } from '../../application/auth/pair-telegram.use-case';

@Module({
  providers: [
    JwtStrategy,
    RegisterUseCase,
    LoginUseCase,
    RefreshUseCase,
    MeUseCase,
    CreateTelegramPairCodeUseCase,
  ],
  controllers: [AuthController],
})
export class AuthModule {}

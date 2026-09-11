import { Module } from '@nestjs/common';
import { SocialController } from './social.controller';
import { SocialAccountUseCases } from '../../application/social/social.use-cases';
import { SocialExecutor } from '../../infrastructure/social/social.executor';
import { TOKENS } from '../../domain/tokens';
import { AesGcmKeyEncryption } from '../../infrastructure/security/aes-gcm-encryption';

@Module({
  controllers: [SocialController],
  providers: [
    SocialAccountUseCases,
    AesGcmKeyEncryption,
    { provide: TOKENS.SocialExecutor, useClass: SocialExecutor },
  ],
})
export class SocialModule {}

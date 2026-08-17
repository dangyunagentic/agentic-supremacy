import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { BcryptPasswordHasher } from './bcrypt-hasher';
import { JwtTokenService } from './jwt-token.service';
import { AesGcmKeyEncryption } from './aes-gcm-encryption';
import { jwtSecret } from './require-secrets';
import { TOKENS } from '../../domain/tokens';

@Global()
@Module({
  imports: [
    JwtModule.register({
      secret: jwtSecret(),
      signOptions: { issuer: 'mintbot' },
    }),
  ],
  providers: [
    { provide: TOKENS.PasswordHasher, useClass: BcryptPasswordHasher },
    { provide: TOKENS.TokenService, useClass: JwtTokenService },
    { provide: TOKENS.KeyEncryption, useClass: AesGcmKeyEncryption },
  ],
  exports: [
    JwtModule,
    TOKENS.PasswordHasher,
    TOKENS.TokenService,
    TOKENS.KeyEncryption,
  ],
})
export class SecurityModule {}

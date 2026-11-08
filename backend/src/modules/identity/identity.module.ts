import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { APP_CONFIG, type AppConfig } from '../../config/config.js';
import { AccessService } from './access/access.service.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { ServiceKeyGuard } from './service-key.guard.js';
import { TokenService } from './token.service.js';
import { UserDirectory } from './user-directory.service.js';

/**
 * Identity: sign-in, 2FA, tokens.
 * Access control: AccessService (roles x scopes x field groups) and AuthGuard.
 * Managing users, roles and delegations lives in the users module.
 */
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        secret: config.auth.jwtSecret,
        signOptions: { algorithm: 'HS256' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    AuthGuard,
    ServiceKeyGuard,
    AccessService,
    UserDirectory,
  ],
  // Other modules use AuthGuard in @UseGuards(AuthGuard) (it needs TokenService and
  // AccessService) and AccessService in their services.
  exports: [
    AuthGuard,
    ServiceKeyGuard,
    TokenService,
    AccessService,
    UserDirectory,
  ],
})
export class IdentityModule {}

/**
 * Routes (base URL http://localhost:3000):
 *
 *   POST /auth/login        public   { workspace, login, password }
 *   POST /auth/mfa/verify   public   { mfaToken, code }
 *   GET  /auth/me           token    the user, linked employee and roles
 *   POST /auth/sign-out     token    ends every session this user holds
 *   POST /auth/mfa/setup    token
 *   POST /auth/mfa/enable   token    { code }  -> new accessToken that counts as 2FA
 *
 * "token" = header  Authorization: Bearer <accessToken from /auth/login>
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { SkipIdempotency } from '../../platform/idempotency/idempotency.interceptor.js';
import { AllowWithoutMfa, AnyAuthenticated } from './access/decorators.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { EnableMfaDto, LoginDto, VerifyMfaDto } from './dto/auth.dto.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // POST /auth/login  — sign in (public, max 10 attempts per minute per IP)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.authService.login(dto, clientInfo(req));
  }

  // POST /auth/mfa/verify  — second login step when 2FA is on (public)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('mfa/verify')
  @HttpCode(200)
  verifyMfa(@Body() dto: VerifyMfaDto, @Req() req: Request) {
    return this.authService.verifyMfa(dto, clientInfo(req));
  }

  // GET /auth/me  — the signed-in user
  @UseGuards(AuthGuard)
  @AnyAuthenticated()
  @AllowWithoutMfa()
  @Get('me')
  me() {
    return this.authService.me();
  }

  // POST /auth/sign-out  — end every session this user holds (0049)
  //
  // AllowWithoutMfa, because signing out must never be the one thing a user
  // cannot do: someone who suspects their token was copied has to be able to
  // kill it even from a session that has not passed the 2FA step.
  @UseGuards(AuthGuard)
  @AnyAuthenticated()
  @AllowWithoutMfa()
  @Post('sign-out')
  @HttpCode(200)
  signOut() {
    return this.authService.signOut();
  }

  // POST /auth/mfa/setup  — start 2FA setup, returns secret + QR link.
  // Not idempotent on purpose: the response holds the plain 2FA secret,
  // which must never be saved in idempotency_keys.
  @UseGuards(AuthGuard)
  @AnyAuthenticated()
  @AllowWithoutMfa()
  @SkipIdempotency()
  @Post('mfa/setup')
  @HttpCode(200)
  setupMfa() {
    return this.authService.setupMfa();
  }

  // POST /auth/mfa/enable  — confirm 2FA with a code from the authenticator app
  @UseGuards(AuthGuard)
  @AnyAuthenticated()
  @AllowWithoutMfa()
  @Post('mfa/enable')
  @HttpCode(200)
  enableMfa(@Body() dto: EnableMfaDto) {
    return this.authService.enableMfa(dto);
  }

  // GET /auth/devices  — the devices this user chose to remember
  @UseGuards(AuthGuard)
  @AnyAuthenticated()
  @Get('devices')
  devices() {
    return this.authService.myDevices();
  }

  // DELETE /auth/devices  — stop trusting every device of this user
  // (after this the 2FA code is asked for again everywhere)
  @UseGuards(AuthGuard)
  @AnyAuthenticated()
  @Delete('devices')
  forgetAllDevices() {
    return this.authService.forgetDevices();
  }

  // DELETE /auth/devices/:deviceId  — stop trusting one of them
  @UseGuards(AuthGuard)
  @AnyAuthenticated()
  @Delete('devices/:deviceId')
  forgetDevice(@Param('deviceId', ParseUUIDPipe) deviceId: string) {
    return this.authService.forgetDevices(deviceId);
  }
}

function clientInfo(req: Request) {
  return { ip: req.ip, device: req.headers['user-agent']?.slice(0, 300) };
}

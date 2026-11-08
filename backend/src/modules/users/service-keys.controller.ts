/**
 * Routes (all need  Authorization: Bearer <token>; writes need Idempotency-Key
 * and, when 2FA is enforced, X-OTP-Code):
 *
 *   POST /service-keys                   step-up  { name, permissions: ["attendance.ingest"], companyId? }
 *                                                 -> authorizationHeader (shown once)
 *   GET  /service-keys
 *   POST /service-keys/:keyId/revoke     step-up  { reason }
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  RequirePermission,
  RequireStepUp,
} from '../identity/access/decorators.js';
import { AuthGuard } from '../identity/auth.guard.js';
import { CreateServiceKeyDto, RevokeDto } from './dto/users.dto.js';
import { ServiceKeysService } from './service-keys.service.js';

@Controller('service-keys')
export class ServiceKeysController {
  constructor(private readonly serviceKeysService: ServiceKeysService) {}

  // POST /service-keys
  @UseGuards(AuthGuard)
  @RequirePermission('integrations.manage')
  @RequireStepUp()
  @Post()
  createKey(@Body() dto: CreateServiceKeyDto) {
    return this.serviceKeysService.createKey(dto);
  }

  // GET /service-keys
  @UseGuards(AuthGuard)
  @RequirePermission('integrations.manage')
  @Get()
  listKeys() {
    return this.serviceKeysService.listKeys();
  }

  // POST /service-keys/:keyId/revoke
  @UseGuards(AuthGuard)
  @RequirePermission('integrations.manage')
  @RequireStepUp()
  @Post(':keyId/revoke')
  @HttpCode(200)
  revokeKey(
    @Param('keyId', ParseUUIDPipe) keyId: string,
    @Body() dto: RevokeDto,
  ) {
    return this.serviceKeysService.revokeKey(keyId, dto);
  }
}

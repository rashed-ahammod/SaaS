/**
 * Routes (writes need Idempotency-Key):
 *
 *   Employee (Bearer token):
 *     POST /me/devices                       { deviceId, name }        register my phone (HR approves)
 *     GET  /me/devices
 *     POST /me/punches/mobile                { deviceId, latitude, longitude }
 *     POST /me/punches/web                   (approved remote staff only)
 *
 *   HR (Bearer token):
 *     GET  /attendance/devices?status=pending
 *     POST /attendance/devices/:deviceId/approve
 *     POST /attendance/devices/:deviceId/revoke   { reason }
 *
 *   Office sync agent (Authorization: ServiceKey <id>.<secret>):
 *     POST /attendance/device-batches        { deviceSerial, branchId, deviceTime, punches: [{ deviceUserId, punchedAt }] }
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RequirePermission } from '../identity/access/decorators.js';
import { AuthGuard } from '../identity/auth.guard.js';
import { ServiceKeyGuard } from '../identity/service-key.guard.js';
import {
  DeviceBatchDto,
  DeviceStatusQueryDto,
  MobilePunchDto,
  ReasonDto,
  RegisterDeviceDto,
} from './dto/attendance.dto.js';
import { PunchesService } from './punches.service.js';

@Controller()
export class PunchesController {
  constructor(private readonly punchesService: PunchesService) {}

  // POST /me/devices
  @UseGuards(AuthGuard)
  @RequirePermission('attendance.own')
  @Post('me/devices')
  registerOwnDevice(@Body() dto: RegisterDeviceDto) {
    return this.punchesService.registerOwnDevice(dto);
  }

  // GET /me/devices
  @UseGuards(AuthGuard)
  @RequirePermission('attendance.own')
  @Get('me/devices')
  listOwnDevices() {
    return this.punchesService.listOwnDevices();
  }

  // POST /me/punches/mobile
  @UseGuards(AuthGuard)
  @RequirePermission('attendance.own')
  @Post('me/punches/mobile')
  mobilePunch(@Body() dto: MobilePunchDto) {
    return this.punchesService.mobilePunch(dto);
  }

  // POST /me/punches/web
  @UseGuards(AuthGuard)
  @RequirePermission('attendance.own')
  @Post('me/punches/web')
  webPunch() {
    return this.punchesService.webPunch();
  }

  // GET /attendance/devices?status=
  @UseGuards(AuthGuard)
  @RequirePermission('attendance.manage')
  @Get('attendance/devices')
  listDevices(@Query() query: DeviceStatusQueryDto) {
    return this.punchesService.listDevices(query.status);
  }

  // POST /attendance/devices/:deviceId/approve
  @UseGuards(AuthGuard)
  @RequirePermission('attendance.manage')
  @Post('attendance/devices/:deviceId/approve')
  @HttpCode(200)
  approveDevice(@Param('deviceId', ParseUUIDPipe) deviceId: string) {
    return this.punchesService.approveDevice(deviceId);
  }

  // POST /attendance/devices/:deviceId/revoke
  @UseGuards(AuthGuard)
  @RequirePermission('attendance.manage')
  @Post('attendance/devices/:deviceId/revoke')
  @HttpCode(200)
  revokeDevice(
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
    @Body() dto: ReasonDto,
  ) {
    return this.punchesService.revokeDevice(deviceId, dto);
  }

  // POST /attendance/device-batches   (service key, not a user)
  @UseGuards(ServiceKeyGuard)
  @RequirePermission('attendance.ingest')
  @Post('attendance/device-batches')
  @HttpCode(200)
  deviceBatch(@Body() dto: DeviceBatchDto) {
    return this.punchesService.deviceBatch(dto);
  }
}

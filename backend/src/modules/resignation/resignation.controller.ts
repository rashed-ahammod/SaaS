/**
 * Routes (all need  Authorization: Bearer <token>; writes need Idempotency-Key):
 *
 *   GET   /me/resignation            my latest resignation and the notice period
 *   POST  /me/resignation            { lastWorkingDay, reason }   -> Dept Head, then HR
 *   POST  /me/resignation/withdraw   { reason }   while it waits for approval
 *
 * The login must be linked to an employee record (users.employee_id).
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { RequirePermission } from '../identity/access/decorators.js';
import { AuthGuard } from '../identity/auth.guard.js';
import { ResignationDto, WithdrawResignationDto } from './resignation.dto.js';
import { ResignationService } from './resignation.service.js';

@Controller('me')
export class ResignationController {
  constructor(private readonly resignationService: ResignationService) {}

  // GET /me/resignation
  @UseGuards(AuthGuard)
  @RequirePermission('employee.view')
  @Get('resignation')
  mine() {
    return this.resignationService.mine();
  }

  // POST /me/resignation
  @UseGuards(AuthGuard)
  @RequirePermission('employee.view')
  @Post('resignation')
  @HttpCode(201)
  submit(@Body() dto: ResignationDto) {
    return this.resignationService.submit(dto);
  }

  // POST /me/resignation/withdraw
  @UseGuards(AuthGuard)
  @RequirePermission('employee.view')
  @Post('resignation/withdraw')
  @HttpCode(200)
  withdraw(@Body() dto: WithdrawResignationDto) {
    return this.resignationService.withdraw(dto.reason);
  }
}

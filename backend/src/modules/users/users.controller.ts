/**
 * Routes (all need  Authorization: Bearer <token>; writes need Idempotency-Key;
 * "step-up" routes also need  X-OTP-Code: <6-digit code from the authenticator>):
 *
 *   POST  /users                                       { email, password, phone?, preferredLanguage?, employeeId? }
 *   GET   /users?q=
 *   GET   /users/:userId                               login + active roles + field grants
 *   PATCH /users/:userId                               { status?, preferredLanguage?, phone?, employeeId?, version }
 *   POST  /users/:userId/password                      step-up  { newPassword }
 *   POST  /users/:userId/roles                         step-up  { role | customRoleId, scopeType, scopeId?, expiresAt? }
 *   POST  /users/:userId/roles/:grantId/revoke         step-up  { reason }
 *   POST  /users/:userId/field-grants                  step-up  { fieldGroup: salary | bank | identity | complaint }
 *   POST  /users/:userId/field-grants/:grantId/revoke  step-up  { reason }
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  RequirePermission,
  RequireStepUp,
} from '../identity/access/decorators.js';
import { AuthGuard } from '../identity/auth.guard.js';
import {
  CreateUserDto,
  GrantFieldAccessDto,
  GrantRoleDto,
  ResetPasswordDto,
  RevokeDto,
  UpdateUserDto,
} from './dto/users.dto.js';
import { RoleGrantsService } from './role-grants.service.js';
import { UsersService } from './users.service.js';

@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly roleGrantsService: RoleGrantsService,
  ) {}

  // POST /users
  @UseGuards(AuthGuard)
  @RequirePermission('users.manage')
  @Post()
  createUser(@Body() dto: CreateUserDto) {
    return this.usersService.createUser(dto);
  }

  // GET /users?q=
  @UseGuards(AuthGuard)
  @RequirePermission('users.manage')
  @Get()
  listUsers(@Query('q') q?: string) {
    return this.usersService.listUsers(q);
  }

  // GET /users/:userId
  @UseGuards(AuthGuard)
  @RequirePermission('users.manage')
  @Get(':userId')
  getUser(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.usersService.getUser(userId);
  }

  // PATCH /users/:userId
  @UseGuards(AuthGuard)
  @RequirePermission('users.manage')
  @Patch(':userId')
  updateUser(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.updateUser(userId, dto);
  }

  // POST /users/:userId/password
  @UseGuards(AuthGuard)
  @RequirePermission('users.manage')
  @RequireStepUp()
  @Post(':userId/password')
  @HttpCode(200)
  resetPassword(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: ResetPasswordDto,
  ) {
    return this.usersService.resetPassword(userId, dto);
  }

  // POST /users/:userId/roles
  @UseGuards(AuthGuard)
  @RequirePermission('roles.grant')
  @RequireStepUp()
  @Post(':userId/roles')
  grantRole(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: GrantRoleDto,
  ) {
    return this.roleGrantsService.grantRole(userId, dto);
  }

  // POST /users/:userId/roles/:grantId/revoke
  @UseGuards(AuthGuard)
  @RequirePermission('roles.grant')
  @RequireStepUp()
  @Post(':userId/roles/:grantId/revoke')
  @HttpCode(200)
  revokeRole(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('grantId', ParseUUIDPipe) grantId: string,
    @Body() dto: RevokeDto,
  ) {
    return this.roleGrantsService.revokeRole(userId, grantId, dto);
  }

  // POST /users/:userId/field-grants
  @UseGuards(AuthGuard)
  @RequirePermission('roles.grant')
  @RequireStepUp()
  @Post(':userId/field-grants')
  grantFieldAccess(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: GrantFieldAccessDto,
  ) {
    return this.roleGrantsService.grantFieldAccess(userId, dto);
  }

  // POST /users/:userId/field-grants/:grantId/revoke
  @UseGuards(AuthGuard)
  @RequirePermission('roles.grant')
  @RequireStepUp()
  @Post(':userId/field-grants/:grantId/revoke')
  @HttpCode(200)
  revokeFieldAccess(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('grantId', ParseUUIDPipe) grantId: string,
    @Body() dto: RevokeDto,
  ) {
    return this.roleGrantsService.revokeFieldAccess(userId, grantId, dto);
  }
}

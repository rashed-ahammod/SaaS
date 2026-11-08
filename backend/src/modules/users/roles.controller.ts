/**
 * Routes (all need  Authorization: Bearer <token>; writes need Idempotency-Key):
 *
 *   GET   /permissions          the permission catalogue
 *   GET   /roles                system roles (read-only) + custom roles
 *   POST  /roles                { nameEn, nameBn?, basedOn, permissions?, description? }
 *   PATCH /roles/:roleId        { nameEn?, nameBn?, permissions?, isActive?, version }   (custom roles only)
 *
 *   POST  /delegations          { toUserId, startsOn, endsOn, reason?, fromUserId? }
 *   GET   /delegations          delegations I gave or received
 *   GET   /delegations/candidates   who I can hand my approvals to (users with a role beyond Employee)
 *   POST  /delegations/:id/revoke
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
  UseGuards,
} from '@nestjs/common';
import {
  AnyAuthenticated,
  RequirePermission,
} from '../identity/access/decorators.js';
import { AuthGuard } from '../identity/auth.guard.js';
import { CustomRolesService } from './custom-roles.service.js';
import { DelegationsService } from './delegations.service.js';
import {
  CreateCustomRoleDto,
  CreateDelegationDto,
  UpdateCustomRoleDto,
} from './dto/users.dto.js';

@Controller()
export class RolesController {
  constructor(
    private readonly customRolesService: CustomRolesService,
    private readonly delegationsService: DelegationsService,
  ) {}

  // GET /permissions
  @UseGuards(AuthGuard)
  @RequirePermission('roles.manage', 'roles.grant')
  @Get('permissions')
  listPermissions() {
    return this.customRolesService.listPermissions();
  }

  // GET /roles
  @UseGuards(AuthGuard)
  @RequirePermission('roles.manage', 'roles.grant')
  @Get('roles')
  listRoles() {
    return this.customRolesService.listRoles();
  }

  // POST /roles
  @UseGuards(AuthGuard)
  @RequirePermission('roles.manage')
  @Post('roles')
  createCustomRole(@Body() dto: CreateCustomRoleDto) {
    return this.customRolesService.createCustomRole(dto);
  }

  // PATCH /roles/:roleId
  @UseGuards(AuthGuard)
  @RequirePermission('roles.manage')
  @Patch('roles/:roleId')
  updateCustomRole(
    @Param('roleId', ParseUUIDPipe) roleId: string,
    @Body() dto: UpdateCustomRoleDto,
  ) {
    return this.customRolesService.updateCustomRole(roleId, dto);
  }

  // POST /delegations  (anyone may delegate their own approvals)
  @UseGuards(AuthGuard)
  @AnyAuthenticated()
  @Post('delegations')
  createDelegation(@Body() dto: CreateDelegationDto) {
    return this.delegationsService.createDelegation(dto);
  }

  // GET /delegations/candidates
  @UseGuards(AuthGuard)
  @AnyAuthenticated()
  @Get('delegations/candidates')
  delegationCandidates() {
    return this.delegationsService.candidates();
  }

  // GET /delegations
  @UseGuards(AuthGuard)
  @AnyAuthenticated()
  @Get('delegations')
  listMyDelegations() {
    return this.delegationsService.listMyDelegations();
  }

  // POST /delegations/:delegationId/revoke
  @UseGuards(AuthGuard)
  @AnyAuthenticated()
  @Post('delegations/:delegationId/revoke')
  @HttpCode(200)
  revokeDelegation(@Param('delegationId', ParseUUIDPipe) delegationId: string) {
    return this.delegationsService.revokeDelegation(delegationId);
  }
}

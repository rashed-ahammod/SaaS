import { Module } from '@nestjs/common';
import { EmployeesModule } from '../employees/employees.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { OrgModule } from '../org/org.module.js';
import { CustomRolesService } from './custom-roles.service.js';
import { DelegationsService } from './delegations.service.js';
import { RoleGrantsService } from './role-grants.service.js';
import { RolesController } from './roles.controller.js';
import { ServiceKeysController } from './service-keys.controller.js';
import { ServiceKeysService } from './service-keys.service.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

/**
 * Users and access administration (WP2): logins, role grants with scopes,
 * custom roles, sensitive-field grants, delegations.
 * Owns tables: custom_roles, custom_role_permissions, user_roles, field_grants,
 *              delegations, service_keys (users is owned by identity; this module manages it).
 */
@Module({
  imports: [IdentityModule, OrgModule, EmployeesModule],
  controllers: [UsersController, RolesController, ServiceKeysController],
  providers: [
    UsersService,
    RoleGrantsService,
    CustomRolesService,
    DelegationsService,
    ServiceKeysService,
  ],
  exports: [UsersService],
})
export class UsersModule {}

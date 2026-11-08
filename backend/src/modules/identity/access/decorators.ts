/**
 * Route decorators read by AuthGuard. Every route that uses AuthGuard must
 * declare who may call it (checked by test/integration/route-permissions.int-spec.ts):
 *
 *   @UseGuards(AuthGuard)
 *   @RequirePermission('employee.manage')      // user needs this permission in some scope
 *   @Post('employees')
 *
 *   @UseGuards(AuthGuard)
 *   @AnyAuthenticated()                        // every signed-in user (e.g. own inbox)
 *
 * The service then checks the specific record:  this.access.assert('employee.manage', resource)
 */
import { SetMetadata } from '@nestjs/common';
import type { PermissionKey } from './permissions.js';

export const PERMISSIONS_KEY = 'requiredPermissions';
export const ANY_AUTHENTICATED_KEY = 'anyAuthenticated';
export const ALLOW_WITHOUT_MFA_KEY = 'allowWithoutMfa';
export const STEP_UP_KEY = 'requireStepUp';

/** The user must hold at least one of these permissions (in any scope). */
export const RequirePermission = (...permissions: PermissionKey[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/** Any signed-in user may call this route (the service limits what they see). */
export const AnyAuthenticated = () => SetMetadata(ANY_AUTHENTICATED_KEY, true);

/**
 * Reachable before a privileged user has set up 2FA (only /auth/me and the
 * 2FA setup routes), so they can set it up.
 */
export const AllowWithoutMfa = () => SetMetadata(ALLOW_WITHOUT_MFA_KEY, true);

/**
 * High-risk action (spec §11): the request must carry a fresh 2FA code in the
 * `X-OTP-Code` header, even within a signed-in session.
 *
 * `{ employeesWithout2fa: 'allow' }`: an employee (no privileged role) who has
 * not set up 2FA may still send the request, because a privileged user approves
 * it afterwards (e.g. their own salary account change, approved by HR).
 */
export type StepUpRule = true | 'allow_unenrolled_employees';
export const RequireStepUp = (options?: { employeesWithout2fa: 'allow' }) =>
  SetMetadata(
    STEP_UP_KEY,
    (options?.employeesWithout2fa === 'allow'
      ? 'allow_unenrolled_employees'
      : true) satisfies StepUpRule,
  );

import { Module } from '@nestjs/common';
import { ApprovalsModule } from '../approvals/approvals.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { OrgModule } from '../org/org.module.js';
import { PortalController } from './portal.controller.js';
import { PortalService } from './portal.service.js';

/**
 * The portal's home screen: setup progress and the user's waiting work in one
 * call, so the dashboard is one request instead of eight. Owns no tables
 * (counts other modules' tables read-only; see portal.service.ts).
 */
@Module({
  imports: [IdentityModule, OrgModule, ApprovalsModule],
  controllers: [PortalController],
  providers: [PortalService],
})
export class PortalModule {}

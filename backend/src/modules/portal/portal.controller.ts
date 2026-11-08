/**
 * Routes for the HR & Admin portal's home screen:
 *
 *   GET /companies/:companyId/portal/overview   setup progress + what waits for me
 *
 * Every signed-in user may ask; the answer only holds the steps and counts
 * their own permissions cover, so two users of one company see different lists.
 */
import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { AnyAuthenticated } from '../identity/access/decorators.js';
import { AuthGuard } from '../identity/auth.guard.js';
import { PortalService } from './portal.service.js';

@Controller()
export class PortalController {
  constructor(private readonly portalService: PortalService) {}

  // GET /companies/:companyId/portal/overview
  @UseGuards(AuthGuard)
  @AnyAuthenticated()
  @Get('companies/:companyId/portal/overview')
  overview(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.portalService.overview(companyId);
  }
}

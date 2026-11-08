/**
 * Routes (all need  Authorization: Bearer <token>; writes need Idempotency-Key):
 *
 *   GET  /rule-packs                    published packs + which my company accepted
 *   GET  /rule-packs/:packId            every value with source, status, verification history
 *   POST /rule-packs/:packId/accept     { effectiveFrom, note? }      (Admin)
 *   GET  /rules?date=YYYY-MM-DD         the rules in force on a date (default today)
 *   GET  /rules/:key?date=YYYY-MM-DD    one rule; refused in production while unverified
 *
 * Publishing and verifying packs is not an API: the compliance owner uses
 * `npm run rules -- ...` (scripts/rules.ts).
 */
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  businessDate,
  todayInDhaka,
} from '../../platform/dates/business-date.js';
import { RequirePermission } from '../identity/access/decorators.js';
import { AuthGuard } from '../identity/auth.guard.js';
import { AcceptRulePackDto, RulesOnDateQueryDto } from './dto/rules.dto.js';
import { RulesService } from './rules.service.js';

@Controller()
export class RulesController {
  constructor(private readonly rulesService: RulesService) {}

  // GET /rule-packs
  @UseGuards(AuthGuard)
  @RequirePermission('rules.view')
  @Get('rule-packs')
  listPacks() {
    return this.rulesService.listPacks();
  }

  // GET /rule-packs/:packId
  @UseGuards(AuthGuard)
  @RequirePermission('rules.view')
  @Get('rule-packs/:packId')
  getPack(@Param('packId', ParseUUIDPipe) packId: string) {
    return this.rulesService.getPack(packId);
  }

  // POST /rule-packs/:packId/accept
  @UseGuards(AuthGuard)
  @RequirePermission('rules.accept')
  @Post('rule-packs/:packId/accept')
  acceptPack(
    @Param('packId', ParseUUIDPipe) packId: string,
    @Body() dto: AcceptRulePackDto,
  ) {
    return this.rulesService.acceptPack(packId, dto);
  }

  // GET /rules?date=
  @UseGuards(AuthGuard)
  @RequirePermission('rules.view')
  @Get('rules')
  effectiveRules(@Query() query: RulesOnDateQueryDto) {
    return this.rulesService.effectiveRules(query.date);
  }

  // GET /rules/:key?date=
  @UseGuards(AuthGuard)
  @RequirePermission('rules.view')
  @Get('rules/:key')
  getRule(@Param('key') key: string, @Query() query: RulesOnDateQueryDto) {
    return this.rulesService.get(
      key,
      query.date ? businessDate(query.date) : todayInDhaka(),
    );
  }
}

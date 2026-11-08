import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module.js';
import { RulesController } from './rules.controller.js';
import { RulesService } from './rules.service.js';

/**
 * Compliance rule pack (WP3). Other modules read statutory values through
 * RulesService.get*(key, date); they never hardcode them (guide §5 rule 12).
 * Owns tables: rule_packs, rule_values, rule_value_history (central),
 *              tenant_rule_packs (per tenant).
 */
@Module({
  imports: [IdentityModule],
  controllers: [RulesController],
  providers: [RulesService],
  exports: [RulesService],
})
export class RulesModule {}

import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module.js';
import { SystemController } from './system.controller.js';
import { SystemService } from './system.service.js';

/** Admin tools: audit log viewer, dead-letter list and replay (WP2). Owns no tables (reads platform tables). */
@Module({
  imports: [IdentityModule],
  controllers: [SystemController],
  providers: [SystemService],
})
export class SystemModule {}

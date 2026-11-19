/**
 * Shared building blocks every business module can inject:
 *   DatabaseService, WORKER_DB, Clock, AuditService, OutboxService, FieldEncryption,
 *   FileStorage, APP_CONFIG.
 *
 * Global, so business modules do not need to import it.
 */
import { Global, Module, OnApplicationShutdown } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { APP_CONFIG, loadConfig, type AppConfig } from '../config/config.js';
import { AuditService } from './audit/audit.service.js';
import { Clock, ManualClock } from './clock.js';
import { FieldEncryption } from './crypto/field-encryption.js';
import { DatabaseService, WORKER_DB } from './db/database.service.js';
import { HealthController } from './http/health.controller.js';
import { MetricsTokenGuard } from './monitoring/metrics-token.guard.js';
import { MonitoringService } from './monitoring/monitoring.service.js';
import { OutboxService } from './outbox/outbox.service.js';
import {
  FileStorage,
  LocalFileStorage,
  S3FileStorage,
} from './storage/file-storage.js';

@Global()
@Module({
  controllers: [HealthController],
  providers: [
    { provide: APP_CONFIG, useFactory: () => loadConfig() },
    {
      provide: DatabaseService,
      useFactory: (config: AppConfig) => new DatabaseService(config, 'erp_app'),
      inject: [APP_CONFIG],
    },
    // erp_worker connection for jobs that scan all tenants (outbox, SLA). Connects lazily.
    {
      provide: WORKER_DB,
      useFactory: (config: AppConfig) =>
        new DatabaseService(config, 'erp_worker'),
      inject: [APP_CONFIG],
    },
    // The real clock, unless this is a development run telling the demo's story
    // on its own day (config.devClock; refused in production).
    {
      provide: Clock,
      useFactory: (config: AppConfig) =>
        config.devClock ? new ManualClock(config.devClock) : new Clock(),
      inject: [APP_CONFIG],
    },
    {
      provide: FieldEncryption,
      useFactory: (config: AppConfig) =>
        new FieldEncryption(config.fieldEncryptionKey),
      inject: [APP_CONFIG],
    },
    {
      provide: FileStorage,
      useFactory: (config: AppConfig): FileStorage =>
        config.storage.driver === 's3'
          ? new S3FileStorage(config.storage)
          : new LocalFileStorage(config.storage.dir),
      inject: [APP_CONFIG],
    },
    AuditService,
    MonitoringService,
    MetricsTokenGuard,
    OutboxService,
  ],
  exports: [
    APP_CONFIG,
    DatabaseService,
    WORKER_DB,
    Clock,
    FieldEncryption,
    FileStorage,
    AuditService,
    OutboxService,
  ],
})
export class PlatformModule implements OnApplicationShutdown {
  constructor(private readonly moduleRef: ModuleRef) {}

  async onApplicationShutdown() {
    await this.moduleRef.get(DatabaseService).close();
    await this.moduleRef.get<DatabaseService>(WORKER_DB).close();
    await this.moduleRef.get(FileStorage).close();
  }
}

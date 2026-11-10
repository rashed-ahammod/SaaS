import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { APP_CONFIG, type AppConfig } from './config/config.js';
import { startJobs } from './jobs.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get<AppConfig>(APP_CONFIG);
  configureApp(app, { hsts: config.isProduction });

  // With RUN_JOBS_IN_API the scheduled jobs (src/jobs.ts) run here instead of in
  // a worker process of its own. Only correct with a single API instance.
  if (config.runJobsInApi) {
    const timers = await startJobs(app);
    const stop = () => timers.forEach(clearInterval);
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    console.log(`Scheduled jobs run in this process (${timers.length} jobs).`);
  }

  // No host: listen on every interface, which is what a container platform
  // (Render, Fly, Docker) needs to reach the process.
  await app.listen(config.port);
  console.log(`API listening on port ${config.port}`);
}
await bootstrap();

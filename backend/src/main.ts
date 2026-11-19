import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { APP_CONFIG, type AppConfig } from './config/config.js';
import { startJobs } from './jobs.js';

/** Print the stack, not just the message: a bare "exited with status 1" in a
 *  host's event log tells you nothing (deploy-free.md Phase 7). */
const die = (what: string, err: unknown) => {
  console.error(`${what}:`, err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
};

process.on('unhandledRejection', (reason) => die('Unhandled rejection', reason));
process.on('uncaughtException', (err) => die('Uncaught exception', err));

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get<AppConfig>(APP_CONFIG);
  configureApp(app, { hsts: config.isProduction });

  // With RUN_JOBS_IN_API the scheduled jobs (src/jobs.ts) run here instead of in
  // a worker process of its own. Only correct with a single API instance.
  const timers = config.runJobsInApi ? await startJobs(app) : [];
  if (config.runJobsInApi)
    console.log(`Scheduled jobs run in this process (${timers.length} jobs).`);

  // A container platform (Render, Fly, Docker) sends SIGTERM on every deploy and,
  // on a free plan, on every spin-down. Registering a listener REPLACES Node's
  // default "exit on SIGTERM", so this handler has to finish the job itself:
  // stop the timers, close the app (PlatformModule.onApplicationShutdown closes
  // the database pools and file storage), then exit. Without the exit the
  // platform waits out its grace period and SIGKILLs the process, which it
  // reports as a failed instance and which leaves pooler connections behind.
  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`${signal} received, shutting down.`);
    timers.forEach(clearInterval);
    // Never let a hung connection hold the process past the platform's grace
    // period: a forced exit is still cleaner than being killed.
    const force = setTimeout(() => {
      console.error('Shutdown timed out after 10s, exiting anyway.');
      process.exit(0);
    }, 10_000);
    force.unref();
    try {
      await app.close();
    } catch (err) {
      console.error('Shutdown error:', err instanceof Error ? err.stack : err);
    }
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  // No host: listen on every interface, which is what a container platform
  // (Render, Fly, Docker) needs to reach the process.
  await app.listen(config.port);
  console.log(`API listening on port ${config.port}`);
}

bootstrap().catch((err) => die('API failed to start', err));

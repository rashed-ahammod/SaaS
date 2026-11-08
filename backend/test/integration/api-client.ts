/**
 * Starts the real Nest app for HTTP tests and gives a small client that
 * signs requests in and adds a fresh Idempotency-Key to every write.
 */
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { Clock } from '../../src/platform/clock.js';
import {
  AI_PROVIDER,
  type AiProvider,
} from '../../src/modules/ai/gateway/provider.js';

/** aiProvider: replace the configured AI provider (null = AI switched off). */
export async function startApp(
  options: { clock?: Clock; aiProvider?: AiProvider | null } = {},
): Promise<INestApplication> {
  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (options.clock)
    builder = builder.overrideProvider(Clock).useValue(options.clock);
  if (options.aiProvider !== undefined)
    builder = builder
      .overrideProvider(AI_PROVIDER)
      .useValue(options.aiProvider);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  return app;
}

export interface Login {
  slug: string;
  email: string;
  password: string;
}

export async function apiFor(app: INestApplication, login: Login) {
  const server = app.getHttpServer();
  const res = await request(server)
    .post('/auth/login')
    .send({
      workspace: login.slug,
      login: login.email,
      password: login.password,
    })
    .expect(200);
  return clientWithToken(app, res.body.accessToken);
}

export function clientWithToken(app: INestApplication, accessToken: string) {
  const server = app.getHttpServer();
  const auth = { Authorization: `Bearer ${accessToken}` };
  return {
    token: accessToken,
    get: (url: string) => request(server).get(url).set(auth),
    post: (
      url: string,
      body: object = {},
      headers: Record<string, string> = {},
    ) =>
      request(server)
        .post(url)
        .set(auth)
        .set('Idempotency-Key', randomUUID())
        .set(headers)
        .send(body),
    put: (url: string, body: object) =>
      request(server)
        .put(url)
        .set(auth)
        .set('Idempotency-Key', randomUUID())
        .send(body),
    patch: (url: string, body: object) =>
      request(server)
        .patch(url)
        .set(auth)
        .set('Idempotency-Key', randomUUID())
        .send(body),
    upload: (
      url: string,
      fields: Record<string, string>,
      file: { content: Buffer; name: string },
    ) => {
      const req = request(server)
        .post(url)
        .set(auth)
        .set('Idempotency-Key', randomUUID());
      for (const [k, v] of Object.entries(fields)) req.field(k, v);
      return req.attach('file', file.content, file.name);
    },
  };
}

export type Api = ReturnType<typeof clientWithToken>;

/**
 * Every HTTP route of the API, found by reading the controllers' decorators
 * (used by route-permissions and cross-tenant-sweep).
 */
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants.js';
import { RequestMethod } from '@nestjs/common';
import {
  ANY_AUTHENTICATED_KEY,
  PERMISSIONS_KEY,
} from '../../src/modules/identity/access/decorators.js';
import { AuthGuard } from '../../src/modules/identity/auth.guard.js';
import { ServiceKeyGuard } from '../../src/modules/identity/service-key.guard.js';
import { EventTokenGuard } from '../../src/modules/notifications/event-token.guard.js';
import { MetricsTokenGuard } from '../../src/platform/monitoring/metrics-token.guard.js';

const SRC = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../src',
);

async function controllerFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((e) =>
      e.isDirectory()
        ? controllerFiles(path.join(dir, e.name))
        : e.name.endsWith('.controller.ts')
          ? [path.join(dir, e.name)]
          : [],
    ),
  );
  return files.flat();
}

export interface RouteInfo {
  route: string;
  guarded: boolean;
  declared: boolean;
}

export async function allRoutes(): Promise<RouteInfo[]> {
  const routes: RouteInfo[] = [];
  for (const file of await controllerFiles(SRC)) {
    const mod = await import(pathToFileURL(file).href);
    for (const exported of Object.values(mod)) {
      if (
        typeof exported !== 'function' ||
        Reflect.getMetadata(PATH_METADATA, exported) === undefined
      )
        continue;
      const prefix = String(Reflect.getMetadata(PATH_METADATA, exported) ?? '');
      const proto = (exported as { prototype: Record<string, unknown> })
        .prototype;
      for (const name of Object.getOwnPropertyNames(proto)) {
        const handler = proto[name];
        if (name === 'constructor' || typeof handler !== 'function') continue;
        const method = Reflect.getMetadata(METHOD_METADATA, handler);
        if (method === undefined) continue;
        const sub = String(Reflect.getMetadata(PATH_METADATA, handler) ?? '');
        const route =
          `${RequestMethod[method]} /${[prefix, sub].filter((p) => p && p !== '/').join('/')}`.replace(
            /\/+/g,
            '/',
          );
        const guards: unknown[] = [
          ...(Reflect.getMetadata(GUARDS_METADATA, exported) ?? []),
          ...(Reflect.getMetadata(GUARDS_METADATA, handler) ?? []),
        ];
        // the metrics guard admits only the monitoring system's token: that is its declaration
        const declared =
          Reflect.getMetadata(PERMISSIONS_KEY, handler) !== undefined ||
          Reflect.getMetadata(ANY_AUTHENTICATED_KEY, handler) === true ||
          guards.includes(MetricsTokenGuard);
        routes.push({
          route,
          guarded:
            guards.includes(AuthGuard) ||
            guards.includes(ServiceKeyGuard) ||
            guards.includes(EventTokenGuard) ||
            guards.includes(MetricsTokenGuard),
          declared,
        });
      }
    }
  }
  return routes;
}

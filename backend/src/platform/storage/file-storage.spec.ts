/**
 * The guarantees both FileStorage implementations must keep:
 * only our own key shape is accepted, and a key is never overwritten.
 */
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FileAlreadyExistsError,
  LocalFileStorage,
  S3FileStorage,
  assertStorageKey,
  detectFileType,
} from './file-storage.js';

const TENANT = '11111111-1111-1111-1111-111111111111';
const FILE = '22222222-2222-2222-2222-222222222222';
const KEY = `${TENANT}/employee-documents/${FILE}`;

describe('assertStorageKey', () => {
  it('accepts the shape our code produces', () => {
    expect(() => assertStorageKey(KEY)).not.toThrow();
  });

  it.each([
    ['path traversal', `${TENANT}/../../etc/passwd`],
    ['absolute path', `/etc/passwd`],
    ['missing folder', `${TENANT}/${FILE}`],
    ['extra segment', `${TENANT}/employee-documents/${FILE}/x`],
    ['uppercase folder', `${TENANT}/Employee-Documents/${FILE}`],
    ['empty', ''],
  ])('rejects %s', (_name, key) => {
    expect(() => assertStorageKey(key)).toThrow(/Invalid storage key/);
  });
});

describe('LocalFileStorage', () => {
  let root: string;
  let storage: LocalFileStorage;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'erp-storage-'));
    storage = new LocalFileStorage(root);
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('stores and returns the same bytes', async () => {
    const content = Buffer.from('%PDF-1.7 payslip');
    await storage.put(KEY, content);
    expect(await storage.get(KEY)).toEqual(content);
  });

  it('refuses to overwrite a key that exists', async () => {
    const key = `${TENANT}/expense-claims/${FILE}`;
    await storage.put(key, Buffer.from('first'));
    await expect(storage.put(key, Buffer.from('second'))).rejects.toThrow(
      FileAlreadyExistsError,
    );
    // the original survives
    expect(await storage.get(key)).toEqual(Buffer.from('first'));
  });

  it('keeps one tenant out of another tenant’s folder', async () => {
    await expect(
      storage.put(`${TENANT}/../${TENANT}/x/${FILE}`, Buffer.from('x')),
    ).rejects.toThrow(/Invalid storage key/);
  });

  it('writes under the root, by tenant and folder', async () => {
    const key = `${TENANT}/employee-documents/${FILE}`;
    expect(
      await readFile(path.join(root, TENANT, 'employee-documents', FILE)),
    ).toEqual(await storage.get(key));
  });
});

describe('detectFileType', () => {
  it.each([
    ['application/pdf', Buffer.from('%PDF-1.4')],
    [
      'image/png',
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
    ],
    ['image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00])],
  ])('reads %s from the first bytes', (expected, content) => {
    expect(detectFileType(content)).toBe(expected);
  });

  it('does not trust a renamed executable', () => {
    expect(detectFileType(Buffer.from('MZ\u0090\u0000executable'))).toBeUndefined();
  });
});

/**
 * S3FileStorage against a fake bucket in this process: no network, but the real
 * AWS client, so the request it builds and the responses it must survive are
 * exercised. A live bucket is covered by the deploy smoke test instead.
 */
describe('S3FileStorage', () => {
  let server: Server;
  let storage: S3FileStorage;
  let seen: Array<{ method: string; url: string; headers: IncomingMessage['headers'] }>;
  /** What the next request should answer with. */
  let reply: { status: number; body?: Buffer };

  beforeAll(async () => {
    seen = [];
    reply = { status: 200 };
    server = createServer((req, res) => {
      // the AWS client appends ?x-id=PutObject / ?x-id=GetObject; keep the path only
      seen.push({
        method: req.method ?? '',
        url: (req.url ?? '').split('?')[0],
        headers: req.headers,
      });
      req.resume(); // drain the body
      req.on('end', () => {
        res.writeHead(reply.status, {
          'Content-Type': 'application/octet-stream',
          ETag: '"abc"',
        });
        res.end(reply.body ?? Buffer.alloc(0));
      });
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const { port } = server.address() as AddressInfo;
    storage = new S3FileStorage({
      bucket: 'erp-docs',
      region: 'auto',
      endpoint: `http://127.0.0.1:${port}`,
      accessKeyId: 'AK',
      secretAccessKey: 'SK',
      forcePathStyle: true,
    });
  });

  afterAll(async () => {
    await storage.close();
    await new Promise<void>((done) => server.close(() => done()));
  });

  it('puts the file at bucket/key, refusing to overwrite', async () => {
    seen.length = 0;
    reply = { status: 200 };
    await storage.put(KEY, Buffer.from('%PDF-1.7 contract'));

    expect(seen).toHaveLength(1);
    expect(seen[0].method).toBe('PUT');
    expect(seen[0].url).toBe(`/erp-docs/${KEY}`);
    // the conditional write that stands in for the local "wx" flag
    expect(seen[0].headers['if-none-match']).toBe('*');
    // the type comes from the bytes, not from the browser
    expect(seen[0].headers['content-type']).toBe('application/pdf');
    // the request is signed
    expect(seen[0].headers.authorization).toMatch(/^AWS4-HMAC-SHA256 /);
  });

  it('turns the bucket’s 412 into FileAlreadyExistsError', async () => {
    reply = { status: 412 };
    await expect(storage.put(KEY, Buffer.from('%PDF-1.7'))).rejects.toThrow(
      FileAlreadyExistsError,
    );
  });

  it('returns the stored bytes', async () => {
    seen.length = 0;
    reply = { status: 200, body: Buffer.from('%PDF-1.7 payslip') };
    expect(await storage.get(KEY)).toEqual(Buffer.from('%PDF-1.7 payslip'));
    expect(seen[0].method).toBe('GET');
    expect(seen[0].url).toBe(`/erp-docs/${KEY}`);
  });

  it('checks the key before it reaches the bucket', async () => {
    seen.length = 0;
    await expect(
      storage.put(`${TENANT}/../other/${FILE}`, Buffer.from('x')),
    ).rejects.toThrow(/Invalid storage key/);
    await expect(storage.get('/etc/passwd')).rejects.toThrow(/Invalid storage key/);
    expect(seen).toHaveLength(0); // nothing was sent
  });
});

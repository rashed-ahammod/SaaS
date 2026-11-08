/**
 * File storage (guide §2: S3-compatible storage, MinIO on-premise).
 *
 * Modules depend on the abstract FileStorage only. Two implementations:
 *
 *   LocalFileStorage  a folder on disk. Simple, and fine for one API instance
 *                     with a mounted volume. Two instances cannot share it.
 *   S3FileStorage     any S3-compatible bucket: AWS S3, Cloudflare R2, MinIO.
 *                     Needed as soon as more than one API instance runs.
 *
 * FILE_STORAGE_DRIVER picks one. See config.ts and .env.example.
 *
 * Keys are created by our code ("<tenantId>/employee-documents/<uuid>"), never
 * from user input, so a request cannot reach another tenant's files. Both
 * implementations check the shape anyway (assertStorageKey) and both refuse to
 * overwrite a key that exists, so a bug cannot silently replace a document.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

export abstract class FileStorage {
  abstract put(key: string, content: Buffer): Promise<void>;
  abstract get(key: string): Promise<Buffer>;
  /** Releases sockets and handles. Called on application shutdown. */
  async close(): Promise<void> {}
}

/** "<uuid>/<folder>/<uuid>", the only shape our code produces. */
const STORAGE_KEY_RE = /^[0-9a-f-]{36}\/[a-z-]+\/[0-9a-f-]{36}$/;

export function assertStorageKey(key: string): void {
  if (!STORAGE_KEY_RE.test(key))
    throw new Error(`Invalid storage key: ${key}`);
}

/** Thrown instead of overwriting a key that already holds a file. */
export class FileAlreadyExistsError extends Error {
  constructor(key: string) {
    super(`Storage key already exists: ${key}`);
    this.name = 'FileAlreadyExistsError';
  }
}

export class LocalFileStorage extends FileStorage {
  private readonly root: string;

  constructor(rootDir: string) {
    super();
    this.root = path.resolve(rootDir);
  }

  async put(key: string, content: Buffer): Promise<void> {
    const file = this.pathFor(key);
    await mkdir(path.dirname(file), { recursive: true });
    try {
      await writeFile(file, content, { flag: 'wx' }); // never overwrite
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST')
        throw new FileAlreadyExistsError(key);
      throw err;
    }
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.pathFor(key));
  }

  private pathFor(key: string): string {
    assertStorageKey(key);
    return path.join(this.root, ...key.split('/'));
  }
}

export interface S3StorageOptions {
  bucket: string;
  region: string;
  /** Empty for AWS S3; the account endpoint for R2, the server for MinIO. */
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** MinIO and some proxies need path-style addressing. */
  forcePathStyle: boolean;
}

export class S3FileStorage extends FileStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(options: S3StorageOptions) {
    super();
    this.bucket = options.bucket;
    this.client = new S3Client({
      region: options.region,
      ...(options.endpoint ? { endpoint: options.endpoint } : {}),
      forcePathStyle: options.forcePathStyle,
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
    });
  }

  async put(key: string, content: Buffer): Promise<void> {
    assertStorageKey(key);
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: content,
          // The browser's Content-Type is not trusted; store what the bytes say.
          ContentType: detectFileType(content) ?? 'application/octet-stream',
          // Conditional write: fails rather than overwriting, matching
          // LocalFileStorage's "wx". Supported by S3, R2 and recent MinIO.
          IfNoneMatch: '*',
        }),
      );
    } catch (err) {
      if (isPreconditionFailed(err)) throw new FileAlreadyExistsError(key);
      throw err;
    }
  }

  async get(key: string): Promise<Buffer> {
    assertStorageKey(key);
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (!result.Body) throw new Error(`Empty response for storage key: ${key}`);
    return Buffer.from(await result.Body.transformToByteArray());
  }

  override async close(): Promise<void> {
    this.client.destroy();
  }
}

/** The bucket refused the write because the key already exists (HTTP 412). */
function isPreconditionFailed(err: unknown): boolean {
  const e = err as {
    name?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return e?.name === 'PreconditionFailed' || e?.$metadata?.httpStatusCode === 412;
}

/**
 * The real type of an uploaded file, from its first bytes. The browser's
 * Content-Type header is not trusted (a renamed .exe could claim to be a PDF).
 */
export function detectFileType(
  content: Buffer,
): 'application/pdf' | 'image/png' | 'image/jpeg' | undefined {
  if (content.subarray(0, 5).toString('latin1') === '%PDF-')
    return 'application/pdf';
  if (
    content
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return 'image/png';
  if (content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff)
    return 'image/jpeg';
  return undefined;
}

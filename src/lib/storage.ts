import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { readableDocumentTitle } from "./document-title";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export type StorageProvider = "local" | "r2";
export type BackupStatus = "local_only" | "backed_up" | "failed";

export type UploadedBinary = {
  fileName: string;
  fileType?: string | null;
  arrayBuffer: ArrayBuffer;
};

export type StoredDocumentFile = {
  fileName: string;
  fileType: string;
  localPath: string;
  objectKey: string | null;
  sizeBytes: number;
  sha256: string;
};

let r2Client: S3Client | null | undefined;

export function getDataDir() {
  return process.env.DATA_DIR || "./data";
}

function getR2Config() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  const endpoint =
    process.env.R2_ENDPOINT ||
    (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : undefined);

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !endpoint) {
    return null;
  }

  return { accessKeyId, secretAccessKey, bucket, endpoint };
}

function getR2Client() {
  if (r2Client !== undefined) return r2Client;
  const config = getR2Config();
  if (!config) {
    r2Client = null;
    return r2Client;
  }
  r2Client = new S3Client({
    region: "auto",
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    forcePathStyle: true,
  });
  return r2Client;
}

function sanitizeObjectSegment(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "unknown"
  );
}

export function guessDocumentKind(fileName: string, mimeType?: string | null) {
  const lower = fileName.toLowerCase();
  if (mimeType === "application/pdf" || lower.endsWith(".pdf")) return "pdf" as const;
  if (
    mimeType === "text/markdown" ||
    lower.endsWith(".md") ||
    lower.endsWith(".markdown") ||
    lower.endsWith(".mdx")
  )
    return "markdown" as const;
  if (mimeType?.startsWith("text/") || lower.endsWith(".txt")) return "text" as const;
  return "other" as const;
}

export function guessContentType(fileName: string, fallback?: string | null) {
  if (fallback && fallback !== "application/octet-stream") return fallback;
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".md") || lower.endsWith(".markdown") || lower.endsWith(".mdx")) {
    return "text/markdown; charset=utf-8";
  }
  if (lower.endsWith(".txt")) return "text/plain; charset=utf-8";
  return fallback || "application/octet-stream";
}

export function titleFromFileName(fileName: string) {
  return readableDocumentTitle(basename(fileName));
}

export function getDocumentVersionDir(ownerUserId: string, documentId: string, versionId: string) {
  return join(getDataDir(), "owners", ownerUserId, "documents", documentId, "versions", versionId);
}

export function buildDocumentObjectKey(args: {
  ownerUserId: string;
  documentId: string;
  versionId: string;
  fileName: string;
}) {
  return [
    "owners",
    sanitizeObjectSegment(args.ownerUserId),
    "documents",
    sanitizeObjectSegment(args.documentId),
    "versions",
    sanitizeObjectSegment(args.versionId),
    "original",
    sanitizeObjectSegment(args.fileName),
  ].join("/");
}

export async function storeDocumentOriginal(args: {
  ownerUserId: string;
  documentId: string;
  versionId: string;
  file: UploadedBinary;
}): Promise<{
  file: StoredDocumentFile;
  storageProvider: StorageProvider;
  backupStatus: BackupStatus;
}> {
  const fileType = guessContentType(args.file.fileName, args.file.fileType);
  const buffer = Buffer.from(args.file.arrayBuffer);
  const sha256 = createHash("sha256").update(buffer).digest("hex");

  const versionDir = getDocumentVersionDir(args.ownerUserId, args.documentId, args.versionId);
  const originalDir = join(versionDir, "original");
  await mkdir(originalDir, { recursive: true });

  const config = getR2Config();
  const client = getR2Client();
  let objectKey: string | null = null;
  let storageProvider: StorageProvider = config && client ? "r2" : "local";
  let backupStatus: BackupStatus = config && client ? "backed_up" : "local_only";

  if (config && client) {
    objectKey = buildDocumentObjectKey({
      ownerUserId: args.ownerUserId,
      documentId: args.documentId,
      versionId: args.versionId,
      fileName: args.file.fileName,
    });
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: objectKey,
          Body: buffer,
          ContentType: fileType,
        }),
      );
    } catch {
      objectKey = null;
      storageProvider = "local";
      backupStatus = "failed";
    }
  }

  const localPath = join(originalDir, args.file.fileName);
  await mkdir(dirname(localPath), { recursive: true });
  await import("node:fs/promises").then((fs) => fs.writeFile(localPath, buffer));

  return {
    file: {
      fileName: args.file.fileName,
      fileType,
      localPath,
      objectKey,
      sizeBytes: buffer.byteLength,
      sha256,
    },
    storageProvider,
    backupStatus,
  };
}

async function bodyToBuffer(body: unknown): Promise<Buffer> {
  if (!body) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;
  if (typeof (body as { transformToByteArray?: unknown }).transformToByteArray === "function") {
    const bytes = await (
      body as { transformToByteArray: () => Promise<Uint8Array> }
    ).transformToByteArray();
    return Buffer.from(bytes);
  }
  if (typeof (body as { arrayBuffer?: unknown }).arrayBuffer === "function") {
    const arrayBuffer = await (body as { arrayBuffer: () => Promise<ArrayBuffer> }).arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
  return Buffer.from(await new Response(body as BodyInit).arrayBuffer());
}

export async function readStoredDocumentFile(args: {
  localPath: string | null;
  fileName: string;
  objectKey?: string | null;
}): Promise<{ buffer: Buffer; contentType: string }> {
  const contentType = guessContentType(args.fileName);
  if (args.localPath && existsSync(args.localPath)) {
    return { buffer: await readFile(args.localPath), contentType };
  }

  const config = getR2Config();
  const client = getR2Client();
  if (!config || !client || !args.objectKey) throw new Error("Document file not found");

  const response = await client.send(
    new GetObjectCommand({ Bucket: config.bucket, Key: args.objectKey }),
  );
  return {
    buffer: await bodyToBuffer(response.Body),
    contentType: response.ContentType || contentType,
  };
}

export async function getPresignedDocumentUrl(
  objectKey: string,
  options: { expiresInSeconds?: number; filename?: string } = {},
) {
  const config = getR2Config();
  const client = getR2Client();
  if (!config || !client) return null;
  try {
    const command = new GetObjectCommand({
      Bucket: config.bucket,
      Key: objectKey,
      ...(options.filename
        ? {
            ResponseContentDisposition: `attachment; filename="${encodeURIComponent(options.filename)}"`,
          }
        : {}),
    });
    return await getSignedUrl(client, command, { expiresIn: options.expiresInSeconds ?? 3600 });
  } catch {
    return null;
  }
}

export async function deleteBackedUpDocuments(objectKeys: string[]) {
  const config = getR2Config();
  const client = getR2Client();
  if (!config || !client || objectKeys.length === 0) return;
  await Promise.all(
    objectKeys
      .filter(Boolean)
      .map((objectKey) =>
        client
          .send(new DeleteObjectCommand({ Bucket: config.bucket, Key: objectKey }))
          .catch(() => undefined),
      ),
  );
}

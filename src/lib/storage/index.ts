import fs from 'node:fs/promises';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { ConfigError, storageConfig } from '@/lib/config';

/**
 * File storage for uploaded PDFs. In production the browser uploads straight to a
 * private Supabase Storage bucket with a short-lived signed URL (so large judgments
 * are not squeezed through a serverless function's 4.5 MB request limit); the server
 * then reads the file back to check and analyse it. Nothing is ever public.
 */
export interface UploadTarget {
  /** Absolute URL, or a path on this site (local development). */
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
}

export interface Storage {
  createUpload(objectPath: string, contentType: string, documentId: string): Promise<UploadTarget>;
  read(objectPath: string): Promise<Uint8Array | null>;
  write?(objectPath: string, data: Uint8Array): Promise<void>;
  remove(objectPath: string): Promise<void>;
}

function supabaseStorage(): Storage {
  const cfg = storageConfig();
  if (!cfg.supabaseUrl || !cfg.serviceKey) {
    throw new ConfigError('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are needed for document uploads.');
  }
  const bucket = createClient(cfg.supabaseUrl, cfg.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }).storage.from(cfg.bucket);
  return {
    async createUpload(objectPath, contentType) {
      const { data, error } = await bucket.createSignedUploadUrl(objectPath);
      if (error || !data) throw new Error(`Could not prepare the upload: ${error?.message}`);
      return { url: data.signedUrl, method: 'PUT', headers: { 'Content-Type': contentType } };
    },
    async read(objectPath) {
      const { data, error } = await bucket.download(objectPath);
      if (error || !data) return null;
      return new Uint8Array(await data.arrayBuffer());
    },
    async remove(objectPath) {
      await bucket.remove([objectPath]);
    },
  };
}

function localStorage(): Storage {
  const root = path.resolve(storageConfig().localDir);
  const resolve = (p: string) => {
    const full = path.resolve(root, p);
    if (!full.startsWith(root + path.sep)) throw new Error('Bad storage path');
    return full;
  };
  return {
    async createUpload(_p, contentType, documentId) {
      return { url: `/api/documents/${documentId}/content`, method: 'PUT', headers: { 'Content-Type': contentType } };
    },
    async read(p) {
      try { return new Uint8Array(await fs.readFile(resolve(p))); } catch { return null; }
    },
    async write(p, data) {
      await fs.mkdir(path.dirname(resolve(p)), { recursive: true });
      await fs.writeFile(resolve(p), data);
    },
    async remove(p) {
      await fs.rm(resolve(p), { force: true });
    },
  };
}

let override: Storage | undefined;
export const setStorage = (s: Storage | undefined) => { override = s; };
export function getStorage(): Storage {
  return override ?? (storageConfig().driver === 'local' ? localStorage() : supabaseStorage());
}

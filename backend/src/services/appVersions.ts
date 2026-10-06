import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import { runIpatool } from './ipatool.js';
import { withSessionRetry } from './appleAccounts.js';

const CACHE_FILE = path.join(config.dataDir, 'version-cache.json');
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 1 day
const META_CONCURRENCY = 6;

export interface AppVersion {
  externalVersionId: string;
  version: string;
  releaseDate: string;
}

interface CacheEntry {
  updatedAt: number;
  /** All external version IDs, newest-first. */
  ids: string[];
  /** Fetched metadata by external version ID. */
  meta: Record<string, AppVersion>;
}

export interface VersionListResult {
  versions: AppVersion[];
  total: number;
  hasMore: boolean;
}

function loadCache(): Record<string, CacheEntry> {
  try {
    if (!fs.existsSync(CACHE_FILE)) return {};
    const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

function saveCache(cache: Record<string, CacheEntry>): void {
  try {
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
  } catch {
    // cache is best-effort
  }
}

async function fetchMetadata(
  accountHash: string,
  appId: string,
  externalVersionId: string,
): Promise<AppVersion | null> {
  try {
    // Shared read lock: metadata fetches are read-only and run concurrently.
    // No per-fetch session retry here — the session is validated once before
    // the batch (see listAppVersions). Holding a read lock across relogin
    // (which needs the write lock) would deadlock.
    const res = await runIpatool(
      accountHash,
      [
        'get-version-metadata',
        '--app-id',
        appId,
        '--external-version-id',
        externalVersionId,
      ],
      { shared: true },
    );
    const version =
      typeof res.data['displayVersion'] === 'string'
        ? (res.data['displayVersion'] as string)
        : '';
    if (!version) return null;
    const releaseDate =
      typeof res.data['releaseDate'] === 'string'
        ? (res.data['releaseDate'] as string)
        : '';
    return { externalVersionId, version, releaseDate };
  } catch {
    return null;
  }
}

/**
 * List historical versions of an app (display version + release date).
 * Only the requested page of metadata is fetched; the ID list and fetched
 * metadata are cached for 24h. IDs are sorted newest-first.
 */
export async function listAppVersions(
  accountHash: string,
  appId: string,
  limit = 15,
  offset = 0,
): Promise<VersionListResult> {
  const cache = loadCache();
  const key = `${accountHash}:${appId}`;
  let entry: CacheEntry | undefined = cache[key];
  // Invalidate stale cache entries (old format without ids/meta).
  if (entry && (!Array.isArray((entry as any).ids) || typeof (entry as any).meta !== 'object')) {
    entry = undefined;
  }
  if (!entry || Date.now() - entry.updatedAt >= CACHE_TTL_MS) {
    // Validate the session first with the exclusive lock (+ auto re-login).
    const listRes = await withSessionRetry(accountHash, () =>
      runIpatool(accountHash, ['list-versions', '--app-id', appId]),
    );
    const ids = listRes.data['externalVersionIdentifiers'];
    if (!Array.isArray(ids)) {
      throw new Error('无法获取版本列表');
    }
    const sorted = [...ids]
      .map(String)
      .sort((a, b) => Number(b) - Number(a));
    entry = { updatedAt: Date.now(), ids: sorted, meta: {} };
    cache[key] = entry;
    saveCache(cache);
  }

  const ids = entry.ids;
  const pageIds = ids.slice(offset, offset + limit);

  // Fetch missing metadata with bounded concurrency (shared read lock).
  const missing = pageIds.filter((id) => !entry!.meta[id]);
  if (missing.length > 0) {
    const queue = [...missing];
    const workers = Array.from(
      { length: Math.min(META_CONCURRENCY, queue.length) },
      async () => {
        while (queue.length > 0) {
          const id = queue.shift()!;
          const meta = await fetchMetadata(accountHash, appId, id);
          if (meta) entry!.meta[id] = meta;
        }
      },
    );
    await Promise.all(workers);
    entry.updatedAt = Date.now();
    saveCache(cache);
  }

  const versions = pageIds
    .map((id) => entry!.meta[id])
    .filter((v): v is AppVersion => !!v);
  return {
    versions,
    total: ids.length,
    hasMore: offset + limit < ids.length,
  };
}

/** Drop cached versions for an app (e.g. after a fresh release). */
export function invalidateVersionCache(
  accountHash: string,
  appId: string,
): void {
  const cache = loadCache();
  delete cache[`${accountHash}:${appId}`];
  saveCache(cache);
}

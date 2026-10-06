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
  versions: AppVersion[];
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
 * List all historical versions of an app (display version + release date).
 * Results are cached per app for 24h. Metadata lookups run with bounded
 * concurrency since an app can have 50+ versions.
 */
export async function listAppVersions(
  accountHash: string,
  appId: string,
): Promise<AppVersion[]> {
  const cache = loadCache();
  const key = `${accountHash}:${appId}`;
  const hit = cache[key];
  if (hit && Date.now() - hit.updatedAt < CACHE_TTL_MS) {
    return hit.versions;
  }

  // Validate the session first with the exclusive lock (+ auto re-login).
  // Metadata fetches below use the shared lock without per-fetch retry:
  // holding a read lock across relogin (write lock) would deadlock, and the
  // session was just validated so mid-batch expiry is unlikely.
  const listRes = await withSessionRetry(accountHash, () =>
    runIpatool(accountHash, ['list-versions', '--app-id', appId]),
  );
  const ids = listRes.data['externalVersionIdentifiers'];
  if (!Array.isArray(ids)) {
    throw new Error('无法获取版本列表');
  }

  const versions: AppVersion[] = [];
  // Bounded-concurrency pool over the id list.
  const queue = [...ids].map(String);
  const workers = Array.from(
    { length: Math.min(META_CONCURRENCY, queue.length) },
    async () => {
      while (queue.length > 0) {
        const id = queue.shift()!;
        const meta = await fetchMetadata(accountHash, appId, id);
        if (meta) versions.push(meta);
      }
    },
  );
  await Promise.all(workers);

  // Sort newest-first by numeric external id (Apple ids increase over time).
  versions.sort((a, b) => Number(b.externalVersionId) - Number(a.externalVersionId));

  cache[key] = { updatedAt: Date.now(), versions };
  saveCache(cache);
  return versions;
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

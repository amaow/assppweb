import fs from 'fs';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import { config, DOWNLOAD_TIMEOUT_MS } from '../config.js';
import {
  IPATOOL_BIN,
  getKeychainPassphrase,
  ipatoolStateDir,
  withAccountLock,
  mapIpatoolError,
} from './ipatool.js';
import { withSessionRetry } from './appleAccounts.js';
import type { DownloadTask, Software } from '../types/index.js';

const tasks = new Map<string, DownloadTask>();
const childProcs = new Map<string, ChildProcess>();
const progressListeners = new Map<string, Set<(task: DownloadTask) => void>>();
const pollTimers = new Map<string, NodeJS.Timeout>();

const PACKAGES_DIR = path.join(config.dataDir, 'packages');
const TMP_DIR = path.join(config.dataDir, 'tmp');
const TASKS_FILE = path.join(config.dataDir, 'tasks.json');
// Legacy file from old code — cleaned up on startup
const LEGACY_DOWNLOADS_FILE = path.join(config.dataDir, 'downloads.json');

// --- Security: path segment validation ---
const SAFE_SEGMENT_RE = /^[a-zA-Z0-9._-]+$/;

/** Validate and sanitize a path segment. Rejects traversal, replaces unsafe chars. */
function safePathSegment(value: string, label: string): string {
  if (!value || value === '.' || value === '..') {
    throw new Error(`Invalid ${label}`);
  }
  if (SAFE_SEGMENT_RE.test(value)) return value;
  const cleaned = value.replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!cleaned || cleaned === '.' || cleaned === '..') {
    throw new Error(`Invalid ${label}`);
  }
  return cleaned;
}

// --- Security: sanitize task for API responses ---
export function sanitizeTaskForResponse(
  task: DownloadTask,
): Omit<DownloadTask, 'filePath'> & { hasFile?: boolean } {
  const { filePath, ...safe } = task;
  return {
    ...safe,
    hasFile: !!filePath && fs.existsSync(filePath),
  };
}

// --- Persistence: save only completed task metadata (no secrets) ---
function persistTasks() {
  const completed = Array.from(tasks.values())
    .filter((t) => t.status === 'completed' && t.filePath)
    .map((t) => ({
      id: t.id,
      software: t.software,
      accountHash: t.accountHash,
      appId: t.appId,
      externalVersionId: t.externalVersionId,
      status: t.status,
      progress: t.progress,
      speed: t.speed,
      filePath: t.filePath,
      createdAt: t.createdAt,
    }));
  fs.writeFileSync(TASKS_FILE, JSON.stringify(completed, null, 2));
}

// Auto-cleanup: delete completed files older than configured days
export function runTimeCleanup() {
  const { autoCleanupDays } = config;
  if (autoCleanupDays <= 0) return;
  const cutoff = Date.now() - autoCleanupDays * 24 * 60 * 60 * 1000;

  const expiredIds: string[] = [];
  for (const task of tasks.values()) {
    if (
      task.status === 'completed' &&
      task.filePath &&
      fs.existsSync(task.filePath)
    ) {
      try {
        const stat = fs.statSync(task.filePath);
        if (stat.mtimeMs < cutoff) {
          expiredIds.push(task.id);
        }
      } catch {
        // File inaccessible — skip
      }
    }
  }

  for (const id of expiredIds) {
    console.log(`[Cleanup] Deleting expired task: ${id}`);
    deleteTask(id);
  }
}

// Auto-cleanup: evict oldest completed files when total size exceeds limit
export function runSpaceCleanup() {
  const { autoCleanupMaxMB } = config;
  if (autoCleanupMaxMB <= 0) return;
  const maxBytes = autoCleanupMaxMB * 1024 * 1024;

  let totalBytes = 0;
  const fileTasks: { id: string; size: number; mtimeMs: number }[] = [];

  for (const task of tasks.values()) {
    if (
      task.status === 'completed' &&
      task.filePath &&
      fs.existsSync(task.filePath)
    ) {
      try {
        const stat = fs.statSync(task.filePath);
        totalBytes += stat.size;
        fileTasks.push({ id: task.id, size: stat.size, mtimeMs: stat.mtimeMs });
      } catch {
        // File inaccessible — skip
      }
    }
  }

  if (totalBytes <= maxBytes) return;

  fileTasks.sort((a, b) => a.mtimeMs - b.mtimeMs);
  for (const ft of fileTasks) {
    console.log(`[Cleanup] Space limit exceeded, deleting task: ${ft.id}`);
    deleteTask(ft.id);
    totalBytes -= ft.size;
    if (totalBytes <= maxBytes) break;
  }
}

function scheduleDailyCleanup() {
  function msUntilMidnight(): number {
    const now = new Date();
    const next = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
      0,
      0,
      0,
    );
    return next.getTime() - now.getTime();
  }

  function tick() {
    runTimeCleanup();
    setTimeout(tick, msUntilMidnight());
  }

  setTimeout(tick, msUntilMidnight());
}

function initOnStartup() {
  if (fs.existsSync(LEGACY_DOWNLOADS_FILE)) {
    fs.unlinkSync(LEGACY_DOWNLOADS_FILE);
  }

  fs.mkdirSync(PACKAGES_DIR, { recursive: true });
  fs.mkdirSync(TMP_DIR, { recursive: true });

  // Clean stale temp files from interrupted downloads
  for (const entry of fs.readdirSync(TMP_DIR)) {
    try {
      fs.unlinkSync(path.join(TMP_DIR, entry));
    } catch {
      // best effort
    }
  }

  if (fs.existsSync(TASKS_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(TASKS_FILE, 'utf-8'));
      if (Array.isArray(data)) {
        for (const item of data) {
          if (
            item.id &&
            item.status === 'completed' &&
            item.filePath &&
            fs.existsSync(item.filePath)
          ) {
            const task: DownloadTask = {
              id: item.id,
              software: item.software,
              accountHash: item.accountHash,
              appId: item.appId,
              externalVersionId: item.externalVersionId,
              status: 'completed',
              progress: 100,
              speed: '0 B/s',
              filePath: item.filePath,
              createdAt: item.createdAt,
            };
            tasks.set(task.id, task);
          }
        }
      }
    } catch {
      // Corrupted file — start fresh
    }
  }

  cleanOrphanedPackages();

  runTimeCleanup();
  scheduleDailyCleanup();
}

function cleanOrphanedPackages() {
  const knownPaths = new Set<string>();
  for (const task of tasks.values()) {
    if (task.filePath) {
      knownPaths.add(path.resolve(task.filePath));
    }
  }

  const packagesBase = path.resolve(PACKAGES_DIR);

  function walkAndClean(dir: string) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkAndClean(fullPath);
        if (fs.readdirSync(fullPath).length === 0) {
          fs.rmdirSync(fullPath);
        }
      } else if (entry.isFile() && !knownPaths.has(path.resolve(fullPath))) {
        fs.unlinkSync(fullPath);
      }
    }
  }

  walkAndClean(packagesBase);
}

initOnStartup();

function notifyProgress(task: DownloadTask) {
  const listeners = progressListeners.get(task.id);
  if (listeners) {
    for (const listener of listeners) {
      listener(task);
    }
  }
}

export function addProgressListener(
  taskId: string,
  listener: (task: DownloadTask) => void,
) {
  let listeners = progressListeners.get(taskId);
  if (!listeners) {
    listeners = new Set();
    progressListeners.set(taskId, listeners);
  }
  listeners.add(listener);
}

export function removeProgressListener(
  taskId: string,
  listener: (task: DownloadTask) => void,
) {
  const listeners = progressListeners.get(taskId);
  if (listeners) {
    listeners.delete(listener);
    if (listeners.size === 0) {
      progressListeners.delete(taskId);
    }
  }
}

export function getAllTasks(): DownloadTask[] {
  return Array.from(tasks.values());
}

export function getTask(id: string): DownloadTask | undefined {
  return tasks.get(id);
}

export function deleteTask(id: string): boolean {
  const task = tasks.get(id);
  if (!task) return false;

  // Kill running ipatool process
  const proc = childProcs.get(id);
  if (proc) {
    try {
      proc.kill('SIGKILL');
    } catch {
      // already exited
    }
    childProcs.delete(id);
  }
  const timer = pollTimers.get(id);
  if (timer) {
    clearInterval(timer);
    pollTimers.delete(id);
  }

  // Remove temp file if a download was in flight
  const tmpPath = path.join(TMP_DIR, `${task.id}.ipa`);
  for (const p of [tmpPath, `${tmpPath}.tmp`]) {
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch {
      // best effort
    }
  }

  // Remove final file with path safety check
  if (task.filePath) {
    const resolved = path.resolve(task.filePath);
    const packagesBase = path.resolve(PACKAGES_DIR);
    if (
      resolved.startsWith(packagesBase + path.sep) &&
      fs.existsSync(resolved)
    ) {
      fs.unlinkSync(resolved);

      let dir = path.dirname(resolved);
      while (dir !== packagesBase && dir.startsWith(packagesBase)) {
        const contents = fs.readdirSync(dir);
        if (contents.length === 0) {
          fs.rmdirSync(dir);
          dir = path.dirname(dir);
        } else {
          break;
        }
      }
    }
  }

  tasks.delete(id);
  progressListeners.delete(id);
  persistTasks();
  return true;
}

export interface CreateTaskOptions {
  /** Acquire a license for the app first (free apps). */
  purchase?: boolean;
  /** Expected total bytes (from iTunes metadata) for progress %. */
  totalBytes?: number;
}

export function createTask(
  software: Software,
  accountHash: string,
  appId: number,
  externalVersionId?: string,
  opts: CreateTaskOptions = {},
): DownloadTask {
  safePathSegment(accountHash, 'accountHash');
  safePathSegment(software.bundleID, 'bundleID');
  safePathSegment(software.version, 'version');
  if (!Number.isInteger(appId) || appId <= 0) {
    throw new Error('Invalid appId');
  }
  if (
    externalVersionId !== undefined &&
    !/^[0-9]+$/.test(externalVersionId)
  ) {
    throw new Error('Invalid externalVersionId');
  }

  if (config.maxDownloadMB > 0 && opts.totalBytes) {
    const sizeMB = opts.totalBytes / (1024 * 1024);
    if (sizeMB > config.maxDownloadMB) {
      throw new Error(
        `文件大小超过限制 ${config.maxDownloadMB} MB`,
      );
    }
  }

  const task: DownloadTask = {
    id: uuidv4(),
    software,
    accountHash,
    appId,
    externalVersionId,
    status: 'pending',
    progress: 0,
    speed: '0 B/s',
    totalBytes: opts.totalBytes,
    createdAt: new Date().toISOString(),
  };

  tasks.set(task.id, task);
  void startDownload(task, opts.purchase ?? false);
  return task;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

async function startDownload(task: DownloadTask, purchase: boolean) {
  runTimeCleanup();
  runSpaceCleanup();

  const safeAccountHash = safePathSegment(task.accountHash, 'accountHash');
  const safeBundleID = safePathSegment(task.software.bundleID, 'bundleID');
  const safeVersion = safePathSegment(task.software.version, 'version');

  const dir = path.join(PACKAGES_DIR, safeAccountHash, safeBundleID, safeVersion);
  const resolvedDir = path.resolve(dir);
  const packagesBase = path.resolve(PACKAGES_DIR);
  if (!resolvedDir.startsWith(packagesBase + path.sep)) {
    task.status = 'failed';
    task.error = 'Invalid path';
    notifyProgress(task);
    return;
  }
  fs.mkdirSync(dir, { recursive: true });

  const tmpOutput = path.join(TMP_DIR, `${task.id}.ipa`);
  const finalPath = path.join(dir, `${task.id}.ipa`);

  task.status = 'downloading';
  task.progress = 0;
  task.speed = '0 B/s';
  task.error = undefined;
  notifyProgress(task);

  const args = [
    'download',
    '--app-id',
    String(task.appId),
    '--output',
    tmpOutput,
  ];
  if (task.externalVersionId) {
    args.push('--external-version-id', task.externalVersionId);
  }
  if (purchase) {
    args.push('--purchase');
  }

  const runOnce = () =>
    new Promise<void>((resolve, reject) => {
      const stateDir = ipatoolStateDir(task.accountHash);
      const proc = spawn(IPATOOL_BIN, [
        ...args,
        '--non-interactive',
        '--format',
        'json',
        '--keychain-passphrase',
        getKeychainPassphrase(),
      ], {
        env: {
          ...process.env,
          XDG_STATE_HOME: stateDir,
          XDG_DATA_HOME: stateDir,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      childProcs.set(task.id, proc);

      let stdout = '';
      let stderr = '';
      proc.stdout?.on('data', (d: Buffer) => {
        stdout += d.toString();
      });
      proc.stderr?.on('data', (d: Buffer) => {
        stderr += d.toString();
      });

      const timeout = setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch {
          // already exited
        }
      }, DOWNLOAD_TIMEOUT_MS);

      // Progress polling: ipatool streams into <output>.tmp while downloading.
      let lastBytes = 0;
      let lastAt = Date.now();
      const timer = setInterval(() => {
        try {
          const st = fs.statSync(`${tmpOutput}.tmp`);
          const now = Date.now();
          const dt = Math.max(1, now - lastAt) / 1000;
          const bytes = st.size;
          const speed = (bytes - lastBytes) / dt;
          lastBytes = bytes;
          lastAt = now;
          task.speed = `${formatBytes(speed)}/s`;
          if (task.totalBytes && task.totalBytes > 0) {
            task.progress = Math.min(
              99,
              Math.round((bytes / task.totalBytes) * 100),
            );
          } else {
            task.speed = `${formatBytes(bytes)} / ${formatBytes(speed)}/s`;
          }
          notifyProgress(task);
        } catch {
          // .tmp not created yet (auth phase) — leave progress as-is
        }
      }, 1000);
      pollTimers.set(task.id, timer);

      proc.on('error', (err) => {
        clearTimeout(timeout);
        clearInterval(timer);
        pollTimers.delete(task.id);
        childProcs.delete(task.id);
        reject(new Error(`无法执行 ipatool: ${err.message}`));
      });

      proc.on('close', (code) => {
        clearTimeout(timeout);
        clearInterval(timer);
        pollTimers.delete(task.id);
        childProcs.delete(task.id);
        if (code === 0) {
          resolve();
        } else {
          reject(mapIpatoolError(`${stdout}\n${stderr}`));
        }
      });
    });

  try {
    // Serialize per account (shared keychain) + auto re-login on expiry.
    // NOTE: withSessionRetry must wrap withAccountLock (not vice versa):
    // relogin() -> runIpatool() acquires the same account lock, so holding
    // the lock across the retry would deadlock.
    await withSessionRetry(task.accountHash, () =>
      withAccountLock(task.accountHash, runOnce),
    );

    if (!fs.existsSync(tmpOutput)) {
      throw new Error('下载完成但未生成文件');
    }
    fs.renameSync(tmpOutput, finalPath);
    // Clean the .tmp if ipatool left it behind
    try {
      if (fs.existsSync(`${tmpOutput}.tmp`)) fs.unlinkSync(`${tmpOutput}.tmp`);
    } catch {
      // best effort
    }

    task.filePath = finalPath;
    task.status = 'completed';
    task.progress = 100;
    task.speed = '0 B/s';
    persistTasks();
    notifyProgress(task);
  } catch (err) {
    // Remove partial temp files
    for (const p of [tmpOutput, `${tmpOutput}.tmp`]) {
      try {
        if (fs.existsSync(p)) fs.unlinkSync(p);
      } catch {
        // best effort
      }
    }
    task.status = 'failed';
    task.error =
      err instanceof Error ? err.message.slice(0, 300) : 'Download failed';
    task.speed = '0 B/s';
    notifyProgress(task);
  }
}

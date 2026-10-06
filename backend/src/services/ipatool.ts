import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { config } from '../config.js';

const execFileAsync = promisify(execFile);

/** ipatool binary path (override with IPATOOL_BIN env). */
export const IPATOOL_BIN = process.env.IPATOOL_BIN || 'ipatool';

const IPATOOL_STATE_BASE = path.join(config.dataDir, 'ipatool-state');
const PASSPHRASE_FILE = path.join(config.dataDir, '.ipatool-passphrase');

/**
 * Keychain passphrase for ipatool's non-interactive mode.
 * Generated once and stored with 0600 perms; shared by all accounts
 * (their keychains live in separate state dirs anyway).
 */
export function getKeychainPassphrase(): string {
  try {
    if (fs.existsSync(PASSPHRASE_FILE)) {
      const existing = fs.readFileSync(PASSPHRASE_FILE, 'utf-8').trim();
      if (existing) return existing;
    }
  } catch {
    // fall through to generation
  }
  const pp = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(PASSPHRASE_FILE, pp, { mode: 0o600 });
  return pp;
}

/** Per-account ipatool state dir (XDG_STATE_HOME + XDG_DATA_HOME). */
export function ipatoolStateDir(accountHash: string): string {
  const dir = path.join(IPATOOL_STATE_BASE, accountHash);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Remove an account's ipatool state (keychain, cookies, caches). */
export function removeIpatoolState(accountHash: string): void {
  const dir = path.join(IPATOOL_STATE_BASE, accountHash);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// --- Per-account serialization -------------------------------------------
// ipatool commands for the same account share one keychain/cookie store;
// concurrent invocations can corrupt it, so serialize per account.

const locks = new Map<string, Promise<unknown>>();

export async function withAccountLock<T>(
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const cur = new Promise<void>((r) => {
    release = r;
  });
  locks.set(
    key,
    prev.then(() => cur),
  );
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}

// --- Error model --------------------------------------------------------

export type IpatoolErrorCode =
  | 'NEED_2FA'
  | 'SESSION_EXPIRED'
  | 'LICENSE_REQUIRED'
  | 'AUTH_FAILED'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'UNKNOWN';

export class IpatoolError extends Error {
  code: IpatoolErrorCode;
  raw: string;
  constructor(code: IpatoolErrorCode, message: string, raw: string) {
    super(message);
    this.name = 'IpatoolError';
    this.code = code;
    this.raw = raw;
  }
}

const ERROR_MAP: Array<[RegExp, IpatoolErrorCode, string]> = [
  [/auth code is required/i, 'NEED_2FA', '需要输入该 Apple ID 的两步验证码'],
  [/2fa code is required/i, 'NEED_2FA', '需要输入该 Apple ID 的两步验证码'],
  [/password token is expired/i, 'SESSION_EXPIRED', '登录会话已过期，正在尝试重新登录'],
  [/license is required/i, 'LICENSE_REQUIRED', '需要先获取该应用的许可'],
  [
    /invalid credentials|authentication failed|incorrect password|unauthorized/i,
    'AUTH_FAILED',
    'Apple ID 或密码错误',
  ],
  [/too many requests|rate limit/i, 'RATE_LIMITED', '请求过于频繁，请稍后再试'],
  [/account.*locked|locked.*account/i, 'AUTH_FAILED', '该 Apple ID 已被锁定，请先解锁'],
  [
    /no usable authentication response|unexpected response from apple|authentication request failed/i,
    'UNKNOWN',
    'Apple 认证服务器无响应（可能是网络或地区问题），请稍后重试或换个网络再试',
  ],
];

export function mapIpatoolError(raw: string): IpatoolError {
  const text = raw || '';
  for (const [re, code, message] of ERROR_MAP) {
    if (re.test(text)) return new IpatoolError(code, message, text);
  }
  const short = text.replace(/\s+/g, ' ').trim().slice(0, 200);
  return new IpatoolError('UNKNOWN', short || 'Apple 服务请求失败', text);
}

// --- JSON log parsing ----------------------------------------------------

interface LogLine {
  level?: string;
  message?: string;
  error?: string;
  [k: string]: unknown;
}

export interface IpatoolResult {
  /** Merged data fields from info-level JSON log lines. */
  data: Record<string, unknown>;
  raw: string;
}

const IGNORED_FIELDS = new Set(['level', 'time', 'message']);

/**
 * Run an ipatool command for one account and parse its `--format json` output.
 * Throws IpatoolError on failure (including the 2FA-required info message,
 * which ipatool reports with exit code 0).
 */
export async function runIpatool(
  accountHash: string,
  args: string[],
  opts: { timeoutMs?: number } = {},
): Promise<IpatoolResult> {
  return withAccountLock(accountHash, async () => {
    const stateDir = ipatoolStateDir(accountHash);
    const env = {
      ...process.env,
      XDG_STATE_HOME: stateDir,
      XDG_DATA_HOME: stateDir,
    };
    const fullArgs = [
      ...args,
      '--non-interactive',
      '--format',
      'json',
      '--keychain-passphrase',
      getKeychainPassphrase(),
    ];

    let stdout = '';
    let stderr = '';
    try {
      const res = await execFileAsync(IPATOOL_BIN, fullArgs, {
        env,
        timeout: opts.timeoutMs ?? 10 * 60 * 1000,
        maxBuffer: 64 * 1024 * 1024,
      });
      stdout = res.stdout ?? '';
      stderr = res.stderr ?? '';
    } catch (err) {
      const e = err as {
        stdout?: string;
        stderr?: string;
        killed?: boolean;
        message?: string;
      };
      stdout = e.stdout ?? '';
      stderr = e.stderr ?? '';
      if (!stdout && !stderr) {
        throw mapIpatoolError(
          e.killed ? '命令执行超时，请重试' : `无法执行 ipatool: ${e.message ?? '未知错误'}`,
        );
      }
      // Non-zero exit with output: parse the JSON logs below for the real error.
    }

    const raw = `${stdout}\n${stderr}`;
    const data: Record<string, unknown> = {};
    let errorRaw: string | null = null;

    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let obj: LogLine;
      try {
        obj = JSON.parse(trimmed);
      } catch {
        continue; // progress bars / non-JSON noise
      }
      if (obj.level === 'error' || obj.level === 'fatal') {
        errorRaw = String(obj.error ?? obj.message ?? trimmed);
      } else {
        for (const [k, v] of Object.entries(obj)) {
          if (!IGNORED_FIELDS.has(k)) data[k] = v;
        }
        // NOTE: ipatool signals "2FA required" via an info message with exit 0.
        if (
          typeof obj.message === 'string' &&
          /2fa code is required/i.test(obj.message)
        ) {
          throw mapIpatoolError(obj.message);
        }
      }
    }

    if (errorRaw) throw mapIpatoolError(errorRaw);
    return { data, raw };
  });
}

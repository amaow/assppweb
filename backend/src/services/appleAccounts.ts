import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import {
  runIpatool,
  removeIpatoolState,
  IpatoolError,
} from './ipatool.js';

const ACCOUNTS_FILE = path.join(config.dataDir, 'accounts.json');
const MASTER_KEY_FILE = path.join(config.dataDir, '.master.key');

export interface AppleAccount {
  email: string;
  accountHash: string;
  /** Display name from Apple, when known. */
  name?: string;
  storeFront: string;
  createdAt: string;
}

interface StoredAccount extends AppleAccount {
  /** "ivHex:cipherHex:tagHex" (AES-256-GCM). */
  passwordEnc: string;
}

/** sha256(email), lowercase+trimmed — the public account identifier. */
export function accountHashFor(email: string): string {
  return crypto
    .createHash('sha256')
    .update(email.toLowerCase().trim())
    .digest('hex');
}

// --- Password encryption (AES-256-GCM, key in data/.master.key 0600) -----

function getMasterKey(): Buffer {
  try {
    if (fs.existsSync(MASTER_KEY_FILE)) {
      const hex = fs.readFileSync(MASTER_KEY_FILE, 'utf-8').trim();
      if (/^[0-9a-f]{64}$/i.test(hex)) return Buffer.from(hex, 'hex');
    }
  } catch {
    // fall through to generation
  }
  const key = crypto.randomBytes(32);
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(MASTER_KEY_FILE, key.toString('hex'), { mode: 0o600 });
  return key;
}

export function encryptPassword(plain: string): string {
  const key = getMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${enc.toString('hex')}:${tag.toString('hex')}`;
}

export function decryptPassword(stored: string): string {
  const key = getMasterKey();
  const [ivH, dataH, tagH] = stored.split(':');
  if (!ivH || !dataH || !tagH) throw new Error('Bad encrypted password format');
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(ivH, 'hex'),
  );
  decipher.setAuthTag(Buffer.from(tagH, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataH, 'hex')),
    decipher.final(),
  ]).toString('utf8');
}

// --- Store ---------------------------------------------------------------

function loadAll(): StoredAccount[] {
  try {
    if (!fs.existsSync(ACCOUNTS_FILE)) return [];
    const data = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf-8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function saveAll(accounts: StoredAccount[]): void {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2), {
    mode: 0o600,
  });
}

function toPublic(a: StoredAccount): AppleAccount {
  const { passwordEnc: _drop, ...pub } = a;
  return pub;
}

export function listAccounts(): AppleAccount[] {
  return loadAll().map(toPublic);
}

export function getAccount(accountHash: string): StoredAccount | undefined {
  return loadAll().find((a) => a.accountHash === accountHash);
}

export function getAccountPassword(accountHash: string): string {
  const acc = getAccount(accountHash);
  if (!acc) throw new Error('Account not found');
  return decryptPassword(acc.passwordEnc);
}

function upsertAccount(acc: StoredAccount): AppleAccount {
  const all = loadAll().filter((a) => a.accountHash !== acc.accountHash);
  all.push(acc);
  saveAll(all);
  return toPublic(acc);
}

export type LoginResult =
  | { status: 'ok'; account: AppleAccount }
  | { status: 'need2FA'; accountHash: string; email: string };

/**
 * Log in with email+password. On NEED_2FA the account is stored in a
 * pending state and the caller must complete it via verify2FA().
 */
export async function login(
  email: string,
  password: string,
): Promise<LoginResult> {
  const accountHash = accountHashFor(email);
  try {
    const res = await runIpatool(accountHash, [
      'auth',
      'login',
      '--email',
      email,
      '--password',
      password,
    ]);
    const name =
      typeof res.data['name'] === 'string'
        ? (res.data['name'] as string)
        : undefined;
    const account = upsertAccount({
      email,
      accountHash,
      name,
      storeFront: '',
      passwordEnc: encryptPassword(password),
      createdAt: new Date().toISOString(),
    });
    return { status: 'ok', account };
  } catch (err) {
    if (err instanceof IpatoolError && err.code === 'NEED_2FA') {
      // Store pending credentials so verify2FA can retry with the code.
      upsertAccount({
        email,
        accountHash,
        storeFront: '',
        passwordEnc: encryptPassword(password),
        createdAt: new Date().toISOString(),
      });
      return { status: 'need2FA', accountHash, email };
    }
    // Clean up any partial state on hard failure.
    removeIpatoolState(accountHash);
    throw err;
  }
}

/** Complete a pending login with the 2FA code. */
export async function verify2FA(
  accountHash: string,
  code: string,
): Promise<AppleAccount> {
  const acc = getAccount(accountHash);
  if (!acc) throw new Error('Account not found');
  const password = decryptPassword(acc.passwordEnc);
  const res = await runIpatool(accountHash, [
    'auth',
    'login',
    '--email',
    acc.email,
    '--password',
    password,
    '--auth-code',
    code.trim(),
  ]);
  const name =
    typeof res.data['name'] === 'string'
      ? (res.data['name'] as string)
      : undefined;
  return upsertAccount({ ...acc, name });
}

/**
 * Run fn(); if the Apple session expired, re-login once with the stored
 * password and retry. May throw NEED_2FA if Apple asks for a code again.
 */
export async function withSessionRetry<T>(
  accountHash: string,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof IpatoolError && err.code === 'SESSION_EXPIRED') {
      await relogin(accountHash);
      return await fn();
    }
    throw err;
  }
}

/** Re-login with the stored password (used on SESSION_EXPIRED). */
export async function relogin(accountHash: string): Promise<AppleAccount> {
  const acc = getAccount(accountHash);
  if (!acc) throw new Error('Account not found');
  const password = decryptPassword(acc.passwordEnc);
  const res = await runIpatool(accountHash, [
    'auth',
    'login',
    '--email',
    acc.email,
    '--password',
    password,
  ]);
  const name =
    typeof res.data['name'] === 'string'
      ? (res.data['name'] as string)
      : undefined;
  return upsertAccount({ ...acc, name });
}

/** Revoke the Apple session, delete stored credentials and ipatool state. */
export async function deleteAccount(accountHash: string): Promise<boolean> {
  const acc = getAccount(accountHash);
  if (!acc) return false;
  try {
    await runIpatool(accountHash, ['auth', 'revoke']);
  } catch {
    // Best effort — still wipe local state.
  }
  removeIpatoolState(accountHash);
  saveAll(loadAll().filter((a) => a.accountHash !== accountHash));
  return true;
}

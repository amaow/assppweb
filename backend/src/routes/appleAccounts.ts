import { Router, Request, Response } from 'express';
import {
  login,
  verify2FA,
  listAccounts,
  deleteAccount,
  getAccount,
} from '../services/appleAccounts.js';
import { IpatoolError } from '../services/ipatool.js';

const router = Router();

function toStatusCode(err: unknown): number {
  if (err instanceof IpatoolError) {
    switch (err.code) {
      case 'NEED_2FA':
        return 428; // Precondition Required
      case 'AUTH_FAILED':
        return 401;
      case 'NOT_FOUND':
        return 404;
      case 'RATE_LIMITED':
        return 429;
      default:
        return 502;
    }
  }
  return 500;
}

function toErrorBody(err: unknown): { error: string; code?: string } {
  if (err instanceof IpatoolError) {
    return { error: err.message, code: err.code };
  }
  return { error: err instanceof Error ? err.message : 'Login failed' };
}

// POST /api/apple-accounts/login { email, password }
router.post('/apple-accounts/login', async (req: Request, res: Response) => {
  const { email, password } = req.body as {
    email?: string;
    password?: string;
  };
  if (!email || !password) {
    res.status(400).json({ error: '需要提供 Apple ID 邮箱和密码' });
    return;
  }
  try {
    const result = await login(email.trim(), password);
    if (result.status === 'need2FA') {
      res.status(428).json({
        need2FA: true,
        accountHash: result.accountHash,
        email: result.email,
        message: '需要输入该 Apple ID 的两步验证码',
      });
      return;
    }
    res.json({ account: result.account });
  } catch (err) {
    res.status(toStatusCode(err)).json(toErrorBody(err));
  }
});

// POST /api/apple-accounts/verify-2fa { accountHash, code }
router.post(
  '/apple-accounts/verify-2fa',
  async (req: Request, res: Response) => {
    const { accountHash, code } = req.body as {
      accountHash?: string;
      code?: string;
    };
    if (!accountHash || !code) {
      res.status(400).json({ error: '缺少 accountHash 或验证码' });
      return;
    }
    try {
      const account = await verify2FA(accountHash, code);
      res.json({ account });
    } catch (err) {
      res.status(toStatusCode(err)).json(toErrorBody(err));
    }
  },
);

// GET /api/apple-accounts
router.get('/apple-accounts', (_req: Request, res: Response) => {
  res.json(listAccounts());
});

// DELETE /api/apple-accounts/:accountHash
router.delete(
  '/apple-accounts/:accountHash',
  async (req: Request, res: Response) => {
    const accountHash = String(req.params.accountHash);
    const ok = await deleteAccount(accountHash);
    if (!ok) {
      res.status(404).json({ error: '账号不存在' });
      return;
    }
    res.json({ success: true });
  },
);

export default router;

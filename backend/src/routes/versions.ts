import { Router, Request, Response } from 'express';
import { listAppVersions } from '../services/appVersions.js';
import { getAccount } from '../services/appleAccounts.js';
import { IpatoolError } from '../services/ipatool.js';

const router = Router();

// GET /api/versions?accountHash=<hash>&appId=<id>[&limit=15&offset=0]
router.get('/versions', async (req: Request, res: Response) => {
  const accountHash = req.query.accountHash;
  const appId = req.query.appId;
  if (typeof accountHash !== 'string' || !accountHash) {
    res.status(400).json({ error: '缺少 accountHash' });
    return;
  }
  if (typeof appId !== 'string' || !appId) {
    res.status(400).json({ error: '缺少 appId' });
    return;
  }
  if (!getAccount(accountHash)) {
    res.status(404).json({ error: '账号不存在，请先登录' });
    return;
  }
  const limit = Math.min(
    Math.max(parseInt(String(req.query.limit ?? '15'), 10) || 15, 1),
    50,
  );
  const offset = Math.max(parseInt(String(req.query.offset ?? '0'), 10) || 0, 0);
  try {
    const result = await listAppVersions(accountHash, appId, limit, offset);
    res.json(result);
  } catch (err) {
    if (err instanceof IpatoolError) {
      res.status(502).json({ error: err.message, code: err.code });
      return;
    }
    res.status(502).json({
      error: err instanceof Error ? err.message : '获取版本列表失败',
    });
  }
});

export default router;

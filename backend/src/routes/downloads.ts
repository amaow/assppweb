import { Router, Request, Response } from 'express';
import {
  createTask,
  getAllTasks,
  getTask,
  deleteTask,
  addProgressListener,
  removeProgressListener,
  sanitizeTaskForResponse,
} from '../services/downloadManager.js';
import { getAccount } from '../services/appleAccounts.js';
import {
  getIdParam,
  requireAccountHash,
  verifyTaskOwnership,
} from '../utils/route.js';

const router = Router();

// Start a new download (server runs ipatool; no client-provided URLs/SINFs)
router.post('/downloads', async (req: Request, res: Response) => {
  const { software, accountHash, appId, externalVersionId, purchase } =
    req.body as {
      software?: {
        id: number;
        bundleID: string;
        name: string;
        version: string;
        fileSizeBytes?: string;
        [k: string]: unknown;
      };
      accountHash?: string;
      appId?: number;
      externalVersionId?: string;
      purchase?: boolean;
    };

  if (!software || !accountHash || !appId) {
    res.status(400).json({
      error: 'Missing required fields: software, accountHash, appId',
    });
    return;
  }

  if (!getAccount(accountHash)) {
    res.status(404).json({ error: '账号不存在，请先登录' });
    return;
  }

  let totalBytes: number | undefined;
  if (software.fileSizeBytes) {
    const parsed = parseInt(software.fileSizeBytes, 10);
    if (Number.isFinite(parsed) && parsed > 0) totalBytes = parsed;
  }

  try {
    const task = createTask(
      software as never,
      accountHash,
      appId,
      externalVersionId,
      { purchase: purchase ?? true, totalBytes },
    );
    res.status(201).json(sanitizeTaskForResponse(task));
  } catch (err) {
    console.error(
      'Create download error:',
      err instanceof Error ? err.message : err,
    );
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Failed to create download',
    });
  }
});

// List downloads filtered by account hashes
router.get('/downloads', (req: Request, res: Response) => {
  const hashesParam = req.query.accountHashes;
  if (!hashesParam || typeof hashesParam !== 'string') {
    res.json([]);
    return;
  }
  const hashes = new Set(hashesParam.split(',').filter(Boolean));
  if (hashes.size === 0) {
    res.json([]);
    return;
  }
  const filtered = getAllTasks()
    .filter((t) => hashes.has(t.accountHash))
    .map(sanitizeTaskForResponse);
  res.json(filtered);
});

// Get single download (requires accountHash)
router.get('/downloads/:id', (req: Request, res: Response) => {
  const accountHash = requireAccountHash(req, res);
  if (!accountHash) return;

  const id = getIdParam(req);
  const task = getTask(id);
  if (!task) {
    res.status(404).json({ error: 'Download not found' });
    return;
  }

  if (!verifyTaskOwnership(task, accountHash, res)) return;

  res.json(sanitizeTaskForResponse(task));
});

// SSE progress stream (requires accountHash)
router.get('/downloads/:id/progress', (req: Request, res: Response) => {
  const accountHash = requireAccountHash(req, res);
  if (!accountHash) return;

  const id = getIdParam(req);
  const task = getTask(id);
  if (!task) {
    res.status(404).json({ error: 'Download not found' });
    return;
  }

  if (!verifyTaskOwnership(task, accountHash, res)) return;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  // Send current state immediately
  res.write(`data: ${JSON.stringify(sanitizeTaskForResponse(task))}\n\n`);

  const listener = (updatedTask: typeof task) => {
    res.write(
      `data: ${JSON.stringify(sanitizeTaskForResponse(updatedTask))}\n\n`,
    );
  };

  addProgressListener(id, listener);

  req.on('close', () => {
    removeProgressListener(id, listener);
  });
});

// Delete download (requires accountHash)
router.delete('/downloads/:id', (req: Request, res: Response) => {
  const accountHash = requireAccountHash(req, res);
  if (!accountHash) return;

  const id = getIdParam(req);
  const task = getTask(id);
  if (!task) {
    res.status(404).json({ error: 'Download not found' });
    return;
  }

  if (!verifyTaskOwnership(task, accountHash, res)) return;

  const success = deleteTask(id);
  if (!success) {
    res.status(404).json({ error: 'Download not found' });
    return;
  }
  res.json({ success: true });
});

export default router;

import { Router } from 'express';
import type { Request, Response } from 'express';

const router = Router();

router.get('/', (_req: Request, res: Response): void => {
  res.json({ ok: true });
});

export default router;

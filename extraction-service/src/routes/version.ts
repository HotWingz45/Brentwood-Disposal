import { Router } from 'express';
import type { Request, Response } from 'express';

const router = Router();

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pkg = require('../../package.json') as { version: string; name: string };

router.get('/', (_req: Request, res: Response): void => {
  res.json({
    name:    pkg.name,
    version: pkg.version,
    node:    process.version,
    env:     process.env['NODE_ENV'] ?? 'development',
  });
});

export default router;

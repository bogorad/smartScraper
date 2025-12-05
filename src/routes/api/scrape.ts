import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { apiAuthMiddleware } from '../../middleware/auth.js';
import { getDefaultEngine } from '../../core/engine.js';
import { OUTPUT_TYPES } from '../../constants.js';

const scrapeSchema = z.object({
  url: z.string().url(),
  outputType: z.enum(['content_only', 'markdown', 'cleaned_html', 'full_html', 'metadata_only']).optional(),
  proxyServer: z.string().optional(),
  userAgent: z.string().optional(),
  timeoutMs: z.number().optional()
});

export const scrapeRouter = new Hono();

scrapeRouter.use('/*', apiAuthMiddleware);

scrapeRouter.post('/', zValidator('json', scrapeSchema), async (c) => {
  const body = c.req.valid('json');

  const engine = getDefaultEngine();
  const result = await engine.scrapeUrl(body.url, {
    outputType: body.outputType as typeof OUTPUT_TYPES[keyof typeof OUTPUT_TYPES],
    proxyDetails: body.proxyServer ? { server: body.proxyServer } : undefined,
    userAgentString: body.userAgent,
    timeoutMs: body.timeoutMs
  });

  return c.json(result);
});

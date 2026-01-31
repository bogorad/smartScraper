import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { apiAuthMiddleware } from '../../middleware/auth.js';
import { rateLimitMiddleware } from '../../middleware/rate-limit.js';
import { getDefaultEngine } from '../../core/engine.js';
import { OUTPUT_TYPES } from '../../constants.js';
import { sanitizeErrorForClient } from '../../utils/error-sanitizer.js';
import { logger } from '../../utils/logger.js';

const scrapeSchema = z.object({
  url: z.string().url(),
  outputType: z.enum(['content_only', 'markdown', 'cleaned_html', 'full_html', 'metadata_only']).optional(),
  proxyServer: z.string().optional(),
  userAgent: z.string().optional(),
  timeoutMs: z.number().optional(),
  xpath: z.string().optional(),
  debug: z.boolean().optional()
});

export const scrapeRouter = new Hono();

// Rate limit: 10 requests per minute per client
scrapeRouter.use('/*', rateLimitMiddleware({ maxRequests: 10, windowMs: 60000 }));
scrapeRouter.use('/*', apiAuthMiddleware);

scrapeRouter.post('/', zValidator('json', scrapeSchema), async (c) => {
  const body = c.req.valid('json');

  const engine = getDefaultEngine();
  try {
    const result = await engine.scrapeUrl(body.url, {
      outputType: body.outputType as typeof OUTPUT_TYPES[keyof typeof OUTPUT_TYPES],
      proxyDetails: body.proxyServer ? { server: body.proxyServer } : undefined,
      userAgentString: body.userAgent,
      timeoutMs: body.timeoutMs,
      xpathOverride: body.xpath,
      debug: body.debug
    });

    return c.json(result);
  } catch (error) {
    logger.error('[API] Scrape failed:', error);
    return c.json({
      success: false,
      error: sanitizeErrorForClient(error)
    }, 500);
  }
});

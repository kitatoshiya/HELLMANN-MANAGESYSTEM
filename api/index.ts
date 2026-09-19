import app from '../src/server/app.ts';

export default function handler(req: any, res: any) {
  // Ensure the original URL is preserved if Vercel rewrote it to /api/index
  const originalPath = (req.headers && (req.headers['x-matched-path'] || req.headers['x-vercel-original-url'] || req.headers['x-forwarded-uri'])) as string | undefined;
  if (originalPath && (req.url === '/api/index' || req.url.startsWith('/api/index?'))) {
    const queryIdx = req.url.indexOf('?');
    const queryString = queryIdx !== -1 ? req.url.slice(queryIdx) : '';
    req.url = originalPath + queryString;
  }
  return app(req, res);
}


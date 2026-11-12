// Worker entry: CORS + routing. All state lives in the single Wall Durable Object.

import { isOriginAllowed, type Env } from './env';

export { Wall } from './wall';

function corsHeaders(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get('Origin');
  if (!origin || !isOriginAllowed(env, req)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req, env) });

    if (url.pathname === '/' || url.pathname === '/health') {
      return new Response('projector wall api: ok', { headers: { 'Content-Type': 'text/plain' } });
    }

    if (url.pathname === '/ws' || url.pathname.startsWith('/api/')) {
      const stub = env.WALL.get(env.WALL.idFromName('wall'));
      const res = await stub.fetch(req);
      if (res.webSocket) return res;
      const out = new Response(res.body, res);
      const cors = corsHeaders(req, env);
      for (const k in cors) out.headers.set(k, cors[k]);
      return out;
    }

    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;

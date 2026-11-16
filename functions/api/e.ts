// Cookieless usage counter (Cloudflare Pages Function, POST /api/e).
// Body: {"k":"view"|"done","p":"/de/pdf-booklet","t":"pdf-booklet"}. Stored as daily totals only:
// day, kind, tool, language, count. No IP address, user agent, referrer or identifier is read or kept.
interface Env {
  STATS?: D1Database;
}

const TOOL = /^[a-z0-9][a-z0-9-]{0,63}$/;
const LANG = /^\/([a-z]{2}(?:-[A-Z]{2})?)\//;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const done = new Response(null, { status: 204 });
  if (!env.STATS) return done;
  let body: { k?: unknown; p?: unknown; t?: unknown };
  try {
    const text = await request.text();
    if (text.length > 512) return done;
    body = JSON.parse(text);
  } catch {
    return done;
  }
  const kind = body.k === 'view' || body.k === 'done' ? body.k : null;
  const tool = typeof body.t === 'string' && TOOL.test(body.t) ? body.t : null;
  if (!kind || !tool) return done;
  const lang = (typeof body.p === 'string' && body.p.match(LANG)?.[1]) || 'en';
  const day = new Date().toISOString().slice(0, 10);
  await env.STATS.prepare(
    `INSERT INTO counts (day, kind, tool, lang, n) VALUES (?1, ?2, ?3, ?4, 1)
     ON CONFLICT (day, kind, tool, lang) DO UPDATE SET n = n + 1`
  )
    .bind(day, kind, tool, lang)
    .run();
  return done;
};

export const onRequest: PagesFunction<Env> = () =>
  new Response('Method not allowed', {
    status: 405,
    headers: { Allow: 'POST' },
  });

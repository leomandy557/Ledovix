// TEMPORARY diagnostic — test outbound fetch with a 5s abort so a hang is a
// catchable error (returns JSON) instead of a platform kill (502 text/plain).
export async function onRequest({ request, env }) {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }
  const out = {};
  async function probe(name, url) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 5000);
    const t0 = Date.now();
    try {
      const r = await fetch(url, { method: 'GET', signal: ac.signal });
      const txt = await r.text().catch(() => '');
      out[name] = { status: r.status, ms: Date.now() - t0, len: txt.length };
    } catch (e) {
      out[name] = { error: e && e.name ? e.name : String(e), ms: Date.now() - t0 };
    } finally {
      clearTimeout(t);
    }
  }
  await probe('cloudflare', 'https://www.cloudflare.com');
  await probe('resend', 'https://api.resend.com/emails');
  return new Response(JSON.stringify({ ok: true, out, hasResend: !!env.RESEND_API_KEY }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

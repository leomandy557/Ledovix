// TEMPORARY diagnostic — test outbound fetch reachability from the function.
export async function onRequest({ request, env }) {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }
  const out = {};
  async function probe(name, url, opts) {
    const t0 = Date.now();
    try {
      const r = await fetch(url, opts);
      const txt = await r.text().catch(() => '');
      out[name] = { status: r.status, ms: Date.now() - t0, len: txt.length, head: txt.slice(0, 120) };
    } catch (e) {
      out[name] = { error: e && e.message ? e.message : String(e), ms: Date.now() - t0 };
    }
  }
  await probe('github', 'https://api.github.com', { method: 'GET' });
  await probe('resend', 'https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (env.RESEND_API_KEY || 're_test') },
    body: JSON.stringify({ from: 'a@b.com', to: ['c@d.com'], subject: 't', text: 'x' }),
  });
  return new Response(JSON.stringify({ ok: true, out, hasResend: !!env.RESEND_API_KEY }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

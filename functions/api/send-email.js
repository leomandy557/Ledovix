// TEMPORARY diagnostic — isolate GET vs POST to Resend. POST with real key,
// wrapped in AbortController so a hang is catchable (JSON) not a platform kill.
export async function onRequest({ request, env }) {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 9000);
  const t0 = Date.now();
  const out = {};
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + (env.RESEND_API_KEY || 're_missing'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'LEDOVIX <onboarding@resend.dev>',
        to: ['test@ledovix.com'],
        subject: 'probe',
        text: 'probe',
      }),
      signal: ac.signal,
    });
    const txt = await r.text().catch(() => '');
    out.post = { status: r.status, ms: Date.now() - t0, len: txt.length, head: txt.slice(0, 200) };
  } catch (e) {
    out.post = { error: e && e.name ? e.name : String(e), ms: Date.now() - t0 };
  } finally {
    clearTimeout(t);
  }
  return new Response(JSON.stringify({ ok: true, out, hasResend: !!env.RESEND_API_KEY }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

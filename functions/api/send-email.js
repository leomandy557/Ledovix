// TEMPORARY ping diagnostic — proves whether Cloudflare deploys function changes.
export async function onRequest({ request, env }) {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }
  return new Response(
    JSON.stringify({ ok: true, ping: 'pong', hasResend: !!env.RESEND_API_KEY, hasReview: !!env.REVIEW_EMAIL }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

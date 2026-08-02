// Cloudflare Pages Function — secure proxy to Alibaba Cloud DashScope (Qwen)
//
// WHY THIS EXISTS:
//   The LEDOVIX frontend (static HTML/JS) cannot safely hold the DashScope API key,
//   because any visitor can read it via "View Source". This server-side function
//   receives the chat request from the browser, injects the API key (stored as a
//   secret env var on Cloudflare), and streams the response back.
//
// DEPLOY:
//   1. This file auto-deploys with the Pages site (no extra setup needed).
//   2. In Cloudflare Dashboard → Pages project → Settings → Environment variables,
//      add:  DASHSCOPE_API_KEY = sk-ws-xxxx  (set for BOTH Production and Preview)
//
// The frontend calls same-origin "/api/chat" — no CORS, no exposed key.

const DASHSCOPE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

export async function onRequest({ request, env }) {
  // Only accept POST
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const apiKey = env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({
        error: 'Server misconfigured: DASHSCOPE_API_KEY is not set. ' +
               'Add it in Cloudflare Pages → Settings → Environment variables.'
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Forward the exact request body the browser sent (model, messages, stream, etc.)
  const body = await request.text();

  let upstream;
  try {
    upstream = await fetch(DASHSCOPE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body,
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'Upstream request failed: ' + err.message }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Stream the SSE response straight back to the browser (keeps the typing effect live)
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') || 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

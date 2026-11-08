// Cloudflare Pages Function — AI chat proxy for LEDOVIX
// ------------------------------------------------------------
// PRIMARY PATH : Cloudflare Workers AI (env.AI binding) — free daily quota, no API key needed.
// FALLBACK PATH: Alibaba Cloud DashScope (qwen) via DASHSCOPE_API_KEY, kept for rollback.
//
// The frontend (index.html callQwenAPI) speaks OpenAI-compatible SSE:
//   data: {"choices":[{"delta":{"content":"..."}}]}  ...  data: [DONE]
// This function converts Workers AI output into that format, so the frontend
// works unchanged no matter which backend serves the request.
//
// SETUP (one-time, in Cloudflare Dashboard):
//   Workers & Pages -> ledovix -> Settings -> Bindings -> Add -> Workers AI
//   Binding name:  AI        (required for the primary path)
//   Optional env var WORKERS_AI_MODEL to override the model, default:
//   @cf/meta/llama-3.1-8b-instruct  (fast, cheap, good English quality)

const DASHSCOPE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
const DEFAULT_MODEL = '@cf/meta/llama-3.1-8b-instruct';

export async function onRequest({ request, env }) {
  // GET = diagnostic probe (safe, no secrets returned)
  if (request.method === 'GET') {
    return new Response(JSON.stringify({
      aiBinding: !!env.AI,
      model: env.WORKERS_AI_MODEL || DEFAULT_MODEL,
      dashscopeFallback: !!env.DASHSCOPE_API_KEY,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonError(400, 'Invalid JSON body');
  }

  const messages = Array.isArray(body.messages) ? body.messages : null;
  if (!messages || messages.length === 0) {
    return jsonError(400, 'Missing "messages" array');
  }
  const wantStream = body.stream === true;
  const maxTokens = Number(body.max_tokens) > 0 ? Number(body.max_tokens) : 800;
  const temperature = typeof body.temperature === 'number' ? body.temperature : 0.7;

  // ---------------- PRIMARY: Workers AI ----------------
  if (env.AI) {
    const model = env.WORKERS_AI_MODEL || DEFAULT_MODEL;
    try {
      const options = { messages, max_tokens: maxTokens, temperature };

      if (wantStream) {
        const upstream = await env.AI.run(model, { ...options, stream: true });
        const transformed = transformStreamToOpenAI(upstream);
        return new Response(transformed, {
          status: 200,
          headers: {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no',
          },
        });
      }

      const result = await env.AI.run(model, options);
      const text = (result && result.response) || '';
      return new Response(
        JSON.stringify({
          id: 'wrai-' + Date.now(),
          object: 'chat.completion',
          model,
          choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    } catch (err) {
      // Surface the real error instead of silently falling back (debug mode).
      return jsonError(502, 'Workers AI failed [' + model + ']: ' + (err && err.message));
    }
  }

  // ---------------- FALLBACK: DashScope (qwen) ----------------
  if (!env.DASHSCOPE_API_KEY) {
    return jsonError(
      500,
      'No AI backend configured. Add a Workers AI binding named "AI" in ' +
      'Cloudflare Pages -> Settings -> Bindings (free), or set DASHSCOPE_API_KEY.'
    );
  }

  let upstream;
  try {
    upstream = await fetch(DASHSCOPE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.DASHSCOPE_API_KEY}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return jsonError(502, 'Upstream request failed: ' + (err && err.message));
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') || 'text/event-stream',
      'Cache-Control': 'no-cache',
    },
  });
}

// Convert Workers AI SSE stream (data: {"response":"..."}) into
// OpenAI-compatible SSE (data: {"choices":[{"delta":{"content":"..."}}]}).
function transformStreamToOpenAI(upstreamStream) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = '';

  const reader = upstreamStream.getReader();

  return new ReadableStream({
    async start(controller) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          try {
            const parsed = JSON.parse(payload);
            const chunk = parsed.response;
            if (chunk) {
              controller.enqueue(
                encoder.encode(
                  'data: ' + JSON.stringify({ choices: [{ delta: { content: chunk } }] }) + '\n\n'
                )
              );
            }
          } catch (e) { /* ignore unparsable line */ }
        }
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
}

function jsonError(status, message) {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
// deploy-marker: workers-ai-primary 1794112066

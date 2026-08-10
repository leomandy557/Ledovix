// Cloudflare Pages Function — auto-send a lead/quote email to Leo.
//
// DELIVERY: Resend (HTTP REST API) only.
//   One HTTPS request to https://api.resend.com/emails — negligible CPU, so it
//   never trips Cloudflare's CPU limit. This is the reliable path on the free
//   plan. (QQ SMTP over TCP+TLS is NOT used because Cloudflare aborts the
//   outbound handshake with HTTP 502 on the free tier.)
//
// ENVIRONMENT VARIABLES (set in Cloudflare Pages -> Settings -> Environment
// variables, on the PRODUCTION scope for the live site):
//   RESEND_API_KEY  (required) e.g. re_xxxx from resend.com
//   REVIEW_EMAIL    (required) recipient, e.g. leo@ledovix.com
//   RESEND_FROM     (optional) overrides the default onboarding@resend.dev sender
//
// IMPORTANT: Cloudflare Pages has separate Production / Preview env-var scopes.
// The live site reads PRODUCTION vars. A var set only on Preview is invisible to
// the production function, which will then report RESEND_API_KEY as missing.

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  const needs = payload && payload.needs ? payload.needs : {};
  const quoteText = (payload && payload.quoteText) || '';
  const quote = payload && payload.quote ? payload.quote : {};
  const attachment = payload && payload.attachment ? payload.attachment : null;

  const to = env.REVIEW_EMAIL;
  const hasResend = !!env.RESEND_API_KEY;
  const debug = {
    RESEND_API_KEY: hasResend,
    REVIEW_EMAIL: !!to,
    RESEND_FROM: !!env.RESEND_FROM,
  };

  // Clear error (JSON, never a 502 HTML page) when not configured.
  if (!hasResend || !to) {
    const missing = [];
    if (!to) missing.push('REVIEW_EMAIL');
    if (!hasResend) missing.push('RESEND_API_KEY');
    return json(
      {
        ok: false,
        error:
          'Email not configured: missing ' + missing.join(', ') +
          '. Set RESEND_API_KEY and REVIEW_EMAIL in Cloudflare Pages -> Settings -> Environment variables, ' +
          'on the PRODUCTION scope (not only Preview), with the exact names.',
        debug,
      },
      500
    );
  }

  const subject =
    'LEDOVIX 新咨询 / New Lead — ' +
    (needs.name || 'Unknown') +
    (needs.company ? ' (' + needs.company + ')' : '');

  const text = buildText(needs, quoteText, quote, attachment);
  const html = buildHtml(needs, quoteText, quote, attachment);

  try {
    const fromEmail = env.RESEND_FROM || 'LEDOVIX <onboarding@resend.dev>';
    const body = { from: fromEmail, to: [to], subject, text, html };
    if (attachment) {
      body.attachments = [
        { filename: attachment.filename, content: attachment.content },
      ];
    }
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + env.RESEND_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => null);
    if (r.ok && data && data.id) {
      return json({ ok: true, via: 'resend', id: data.id }, 200);
    }
    console.warn('[send-email] Resend error:', r.status, JSON.stringify(data));
    return json(
      {
        ok: false,
        via: 'resend',
        error:
          'Resend API error ' +
          r.status +
          ': ' +
          (data && (data.message || JSON.stringify(data)) || 'unknown') +
          '. Verify RESEND_API_KEY is valid and REVIEW_EMAIL is an allowed recipient.',
        debug,
      },
      502
    );
  } catch (e) {
    console.warn('[send-email] Resend request failed:', e && e.message ? e.message : String(e));
    return json(
      {
        ok: false,
        via: 'resend',
        error: 'Resend request failed: ' + (e && e.message ? e.message : String(e)),
        debug,
      },
      502
    );
  }
}

function fmtVal(v) {
  if (v === null || v === undefined || v === '') return '-';
  if (typeof v === 'object') return v.label !== undefined ? v.label : (v.display || JSON.stringify(v));
  return String(v);
}

function buildText(needs, quoteText, quote, attachment) {
  const n = needs || {};
  const L = [];
  L.push('New LEDOVIX consultation lead');
  L.push('='.repeat(54));
  L.push('Contact:');
  L.push('  Name   : ' + fmtVal(n.name));
  L.push('  Email  : ' + fmtVal(n.email));
  L.push('  Phone  : ' + fmtVal(n.phone));
  L.push('  Company: ' + fmtVal(n.company));
  L.push('');
  L.push('Requirements:');
  ['scenario', 'screenType', 'screenSize', 'installMethod', 'controlSystem', 'connectionType', 'viewingDistance'].forEach(function (k) {
    if (n[k]) L.push('  ' + k + ' : ' + fmtVal(n[k]));
  });
  L.push('');
  if (quote && (quote.total !== undefined || quote.usd !== undefined)) {
    L.push('Quote totals:');
    if (quote.total !== undefined) L.push('  RMB : ¥' + Math.round(quote.total));
    if (quote.usd !== undefined) L.push('  USD : $' + Math.round(quote.usd));
    if (quote.perSqm !== undefined) L.push('  /m² : ¥' + Math.round(quote.perSqm));
    L.push('');
  }
  if (attachment && attachment.filename) {
    L.push('Attachment: ' + attachment.filename + ' (filled SimpLED quotation in .xlsx)');
    L.push('');
  }
  L.push('--- Quote ---');
  L.push(quoteText || '(no quote text returned)');
  return L.join('\n');
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildHtml(needs, quoteText, quote, attachment) {
  const n = needs || {};
  const rows = [
    ['Name', fmtVal(n.name)],
    ['Email', fmtVal(n.email)],
    ['Phone', fmtVal(n.phone)],
    ['Company', fmtVal(n.company)],
    ['Scenario', fmtVal(n.scenario)],
    ['Screen size', fmtVal(n.screenSize)],
    ['Install', fmtVal(n.installMethod)],
    ['Control system', fmtVal(n.controlSystem)],
    ['Connection', fmtVal(n.connectionType)],
    ['Viewing distance', fmtVal(n.viewingDistance)],
  ];
  let contactRows = '';
  rows.forEach(function (r) {
    if (r[1] && r[1] !== '-') {
      contactRows +=
        '<tr><td style="padding:4px 8px;color:#666;">' +
        esc(r[0]) +
        '</td><td style="padding:4px 8px;font-weight:600;">' +
        esc(r[1]) +
        '</td></tr>';
    }
  });
  const totals =
    quote && (quote.total !== undefined || quote.usd !== undefined)
      ? '<p style="margin:8px 0;">' +
        (quote.total !== undefined ? '<strong>¥' + Math.round(quote.total) + ' RMB</strong> ' : '') +
        (quote.usd !== undefined ? ' / $' + Math.round(quote.usd) + ' USD' : '') +
        '</p>'
      : '';
  const quoteBlock = (quoteText || '')
    .split('\n')
    .map(function (line) {
      return '<div>' + esc(line) + '</div>';
    })
    .join('');

  const attNote = (attachment && attachment.filename)
    ? '<p style="margin:8px 0;"><em>📎 Attachment: ' + esc(attachment.filename) + ' — filled SimpLED quotation (.xlsx)</em></p>'
    : '';

  return (
    '<div style="font-family:Arial,Helvetica,sans-serif;color:#222;">' +
    '<h2 style="color:#0a4d8c;">New LEDOVIX Lead</h2>' +
    '<table style="border-collapse:collapse;font-size:14px;">' +
    contactRows +
    '</table>' +
    totals +
    attNote +
    '<h3 style="color:#0a4d8c;">Quote</h3>' +
    '<div style="background:#f6f8fa;border:1px solid #e1e4e8;border-radius:6px;' +
    'padding:12px;font-family:monospace;font-size:13px;white-space:pre-wrap;">' +
    quoteBlock +
    '</div>' +
    '</div>'
  );
}

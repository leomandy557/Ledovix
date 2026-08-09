// Cloudflare Pages Function — auto-send a lead/quote email to Leo via QQ SMTP
//
// WHY THIS EXISTS:
//   When a visitor finishes a LEDOVIX consultation, the frontend produces a
//   quote. This server-side function emails that quote + the customer's contact
//   details to the sales review inbox (REVIEW_EMAIL) so Leo's team can follow up.
//   Doing it server-side keeps the QQ SMTP credentials out of the browser.
//
// TRIGGERED BY:
//   The frontend calls same-origin POST "/api/send-email" (see index.html ->
//   notifyLead()) with: { needs, quoteText, quote }.
//
// ENV VARS (Cloudflare Dashboard -> Pages project -> Settings -> Environment
// variables; set for BOTH Production and Preview):
//   QQ_SMTP_USER  : QQ mail address used to SEND, e.g. 123456@qq.com
//   QQ_SMTP_PASS  : QQ mail "授权码" (authorization code) — NOT the login password
//   REVIEW_EMAIL  : recipient inbox, e.g. leo@ledovix.com
//
// COMPATIBILITY FLAG (required!):
//   Settings -> Functions -> Compatibility flags -> add `nodejs_compat`.
//   worker-mailer uses Cloudflare TCP sockets (node:net) which only exist when
//   this flag is enabled.

import { WorkerMailer } from 'worker-mailer';

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
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

  const user = env.QQ_SMTP_USER;
  const pass = env.QQ_SMTP_PASS;
  const to = env.REVIEW_EMAIL;

  if (!user || !pass || !to) {
    return json(
      {
        ok: false,
        error:
          'Server misconfigured: QQ_SMTP_USER / QQ_SMTP_PASS / REVIEW_EMAIL are not all set. ' +
          'Add them in Cloudflare Pages -> Settings -> Environment variables.',
      },
      500
    );
  }

  const subject =
    'LEDOVIX 新咨询 / New Lead — ' +
    (needs.name || 'Unknown') +
    (needs.company ? ' (' + needs.company + ')' : '');

  const text = buildText(needs, quoteText, quote);
  const html = buildHtml(needs, quoteText, quote);

  try {
    const result = await WorkerMailer.send(
      {
        host: 'smtp.qq.com',
        port: 465,
        secure: true, // implicit TLS on 465
        authType: 'login',
        credentials: {
          username: user,
          password: pass,
        },
        socketTimeoutMs: 15000,
        responseTimeoutMs: 15000,
      },
      {
        from: { name: 'LEDOVIX Lead Bot', email: user },
        to: { name: 'Leo', email: to },
        subject,
        text,
        html,
      }
    );

    return json({
      ok: true,
      accepted: result.accepted,
      rejected: result.rejected,
      messageId: result.messageId,
    });
  } catch (err) {
    console.error('[send-email] WorkerMailer.send failed:', err);
    return json(
      {
        ok: false,
        error:
          'SMTP send failed: ' +
          (err && err.message ? err.message : String(err)),
      },
      502
    );
  }
}

function fmtVal(v) {
  if (v === null || v === undefined || v === '') return '-';
  if (typeof v === 'object') return v.display || JSON.stringify(v);
  return String(v);
}

function buildText(needs, quoteText, quote) {
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
  ['scenario', 'screenType', 'screenSize', 'installMethod', 'viewingDistance'].forEach(function (k) {
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

function buildHtml(needs, quoteText, quote) {
  const n = needs || {};
  const rows = [
    ['Name', fmtVal(n.name)],
    ['Email', fmtVal(n.email)],
    ['Phone', fmtVal(n.phone)],
    ['Company', fmtVal(n.company)],
    ['Scenario', fmtVal(n.scenario)],
    ['Screen size', fmtVal(n.screenSize)],
    ['Install', fmtVal(n.installMethod)],
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

  return (
    '<div style="font-family:Arial,Helvetica,sans-serif;color:#222;">' +
    '<h2 style="color:#0a4d8c;">New LEDOVIX Lead</h2>' +
    '<table style="border-collapse:collapse;font-size:14px;">' +
    contactRows +
    '</table>' +
    totals +
    '<h3 style="color:#0a4d8c;">Quote</h3>' +
    '<div style="background:#f6f8fa;border:1px solid #e1e4e8;border-radius:6px;' +
    'padding:12px;font-family:monospace;font-size:13px;white-space:pre-wrap;">' +
    quoteBlock +
    '</div>' +
    '</div>'
  );
}

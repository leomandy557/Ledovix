import { buildQuotationXlsx } from './quotation_xlsx.js';

// Cloudflare Pages Function — auto-send a lead/quote email to Leo, with an
// optional backup webhook so a lead is never lost even if email fails.
//
// DELIVERY (primary): Resend (HTTP REST API) only.
//   One HTTPS request to https://api.resend.com/emails — negligible CPU, so it
//   never trips Cloudflare's CPU limit. This is the reliable path on the free
//   plan. (QQ SMTP over TCP+TLS is NOT used because Cloudflare aborts the
//   outbound handshake with HTTP 502 on the free tier.)
//
// BACKUP (optional, always-on fallback): if BACKUP_WEBHOOK_URL is set, the lead
//   is also POSTed there (a generic JSON webhook — Discord / Google Chat / Slack
//   incoming webhook / Make / Zapier / a Telegram-via-worker bridge, etc.). If
//   email is unavailable, the backup alone still captures the lead, so the
//   response is reported as a success (via:'backup').
//
// ENVIRONMENT VARIABLES (Cloudflare Pages -> Settings -> Environment variables,
// PRODUCTION scope for the live site):
//   RESEND_API_KEY  (required for email) e.g. re_xxxx from resend.com
//   REVIEW_EMAIL    (required for email) recipient. In Resend TEST mode this
//                   MUST be the Resend account owner email (e.g.
//                   leomandy557@gmail.com). To send to any address (e.g.
//                   leo@ledovix.com), verify a sending domain at
//                   https://resend.com/domains first.
//   RESEND_FROM     (optional) sender; defaults to onboarding@resend.dev
//                   (Resend's test sender, allowed in test mode).
//   BACKUP_WEBHOOK_URL (optional) generic JSON webhook for lead backup.
//
// The fetch is guarded by an AbortController(10s) so the function ALWAYS returns
// our own JSON (never a Cloudflare 502 HTML page), even if the upstream hangs.

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
  const rec = payload && payload.rec ? payload.rec : {};

  // Best-effort: build the filled Excel quotation server-side (template is
  // embedded in quotation_xlsx.js, contact info comes from the webpage). If it
  // fails we fall back to any attachment the client may have sent.
  let attachment = null;
  try {
    attachment = await buildQuotationXlsx({ needs, quote, rec });
  } catch (e) {
    console.warn('[send-email] failed to build xlsx attachment:', e && e.message ? e.message : String(e));
    attachment = payload && payload.attachment ? payload.attachment : null;
  }

  const hasResend = !!env.RESEND_API_KEY && !!env.REVIEW_EMAIL;
  const backupUrl = env.BACKUP_WEBHOOK_URL || '';
  const debug = {
    RESEND_API_KEY: !!env.RESEND_API_KEY,
    REVIEW_EMAIL: !!env.REVIEW_EMAIL,
    RESEND_FROM: !!env.RESEND_FROM,
    BACKUP_WEBHOOK_URL: !!backupUrl,
  };

  // Nothing configured at all -> clear, actionable error (JSON, never 502).
  if (!hasResend && !backupUrl) {
    return json(
      {
        ok: false,
        error:
          'No delivery channel configured. Set RESEND_API_KEY + REVIEW_EMAIL (email) ' +
          'and/or BACKUP_WEBHOOK_URL (lead backup) in Cloudflare Pages -> Settings -> ' +
          'Environment variables (PRODUCTION scope).',
        debug,
      },
      500
    );
  }

  // 1) Try primary email delivery.
  let emailResult = null;
  if (hasResend) {
    emailResult = await sendResendEmail({
      needs, quoteText, quote, attachment, env,
    });
  }

  // 2) If email did not succeed and a backup webhook is configured, capture the
  //    lead there so it is never lost.
  let backupResult = null;
  if ((!emailResult || !emailResult.ok) && backupUrl) {
    backupResult = await sendBackup(backupUrl, { needs, quoteText, quote, attachment });
  }

  // 3) Compose the outcome.
  if (emailResult && emailResult.ok) {
    return json(
      {
        ok: true,
        via: 'resend',
        id: emailResult.id,
        backedUp: !!(backupResult && backupResult.ok),
        backupVia: backupResult && backupResult.ok ? 'webhook' : null,
        debug,
      },
      200
    );
  }
  if (backupResult && backupResult.ok) {
    return json(
      {
        ok: true,
        via: 'backup',
        backupVia: 'webhook',
        emailError: emailResult ? emailResult.error : 'Email channel not configured',
        debug,
      },
      200
    );
  }
  // Both channels failed.
  return json(
    {
      ok: false,
      via: emailResult ? emailResult.via : (backupUrl ? 'backup' : 'none'),
      error:
        (emailResult && emailResult.error) ||
        (backupResult && backupResult.error) ||
        'No delivery channel succeeded.',
      backedUp: false,
      debug,
    },
    502
  );
}

async function sendResendEmail({ needs, quoteText, quote, attachment, env }) {
  const to = env.REVIEW_EMAIL;
  const subject =
    'New LEDOVIX Lead — ' +
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
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 10000);
    let r, data;
    try {
      r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + env.RESEND_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      data = await r.json().catch(() => null);
    } finally {
      clearTimeout(timer);
    }
    if (r.ok && data && data.id) {
      return { ok: true, via: 'resend', id: data.id };
    }
    console.warn('[send-email] Resend error:', r && r.status, JSON.stringify(data));
    // Test-mode restriction hint when Resend rejects the recipient.
    let hint = '';
    if (r && r.status === 403 && data && /own email address/i.test(data.message || '')) {
      hint =
        ' Resend is in TEST mode: it only delivers to the Resend account owner email. ' +
        'Set REVIEW_EMAIL to that address, or verify a sending domain at https://resend.com/domains.';
    }
    return {
      ok: false,
      via: 'resend',
      error:
        'Resend API error ' +
        (r ? r.status : 'no-response') +
        ': ' +
        (data && (data.message || JSON.stringify(data)) || 'unknown') +
        hint,
    };
  } catch (e) {
    console.warn('[send-email] Resend request failed:', e && e.message ? e.message : String(e));
    const aborted = e && e.name === 'AbortError';
    return {
      ok: false,
      via: 'resend',
      error: (aborted ? 'Resend request timed out (>10s). ' : 'Resend request failed: ') +
        (e && e.message ? e.message : String(e)),
    };
  }
}

// POST a clean lead object to a generic JSON webhook (backup channel).
async function sendBackup(url, { needs, quoteText, quote, attachment }) {
  const n = needs || {};
  const body = {
    source: 'LEDOVIX website',
    receivedAt: new Date().toISOString(),
    contact: {
      name: n.name || '',
      email: n.email || '',
      phone: n.phone || '',
      company: n.company || '',
    },
    requirements: {
      scenario: fmtVal(n.scenario),
      screenType: fmtVal(n.screenType),
      screenSize: fmtVal(n.screenSize),
      installMethod: fmtVal(n.installMethod),
      controlSystem: fmtVal(n.controlSystem),
      connectionType: fmtVal(n.connectionType),
      viewingDistance: fmtVal(n.viewingDistance),
    },
    quote: {
      total: quote && quote.total,
      usd: quote && quote.usd,
      perSqm: quote && quote.perSqm,
    },
    quoteText: quoteText,
    hasAttachment: !!attachment,
  };
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 10000);
    let r;
    try {
      r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (r.ok || r.status < 400) return { ok: true, via: 'backup' };
    const txt = await r.text().catch(() => '');
    return { ok: false, via: 'backup', error: 'Backup webhook returned HTTP ' + r.status + (txt ? ': ' + txt.slice(0, 200) : '') };
  } catch (e) {
    return { ok: false, via: 'backup', error: 'Backup webhook request failed: ' + (e && e.message ? e.message : String(e)) };
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

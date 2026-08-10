// Server-side quotation xlsx builder for LEDOVIX lead emails.
//
// The SimpLED template is embedded as base64 (see embedded_template.js), so the
// edge function needs no outbound fetch to read a file. At request time we:
//   1. unzip the embedded template,
//   2. substitute every {{token}} cell with the real lead + quote data
//      (English only; string tokens replaced inline, numeric tokens written as
//      real numbers so the =B*D totals compute),
//   3. re-zip and return base64.
// The layout, merged cells, styles, product image and live SUM formula are all
// preserved — only the cell text changes.

import { unzipSync, zipSync } from './vendor/fflate.js';
import { TEMPLATE_B64 } from './embedded_template.js';

const SHEET_PATH = 'xl/worksheets/sheet1.xml';

// (coord, token) pairs written as REAL numbers so the =B*D totals compute.
const NUMERIC = [
  ['B15', 'base_qty'], ['D15', 'base_price'],
  ['B23', 'opt0_qty'], ['D23', 'opt0_price'],
  ['B24', 'opt1_qty'], ['D24', 'opt1_price'],
  ['B25', 'opt2_qty'], ['D25', 'opt2_price'],
  ['B26', 'opt3_qty'], ['D26', 'opt3_price'],
  ['B27', 'opt4_qty'], ['D27', 'opt4_price'],
  ['B28', 'opt5_qty'], ['D28', 'opt5_price'],
  ['B29', 'opt6_qty'], ['D29', 'opt6_price'],
  ['B30', 'opt7_qty'], ['D30', 'opt7_price'],
  ['B31', 'opt8_qty'], ['D31', 'opt8_price'],
  ['B32', 'opt9_qty'], ['D32', 'opt9_price'],
];

// ---- helpers ---------------------------------------------------------------

// Take the English half of "中文 / English" strings.
function enHalf(s) {
  if (typeof s !== 'string') return s;
  const i = s.indexOf(' / ');
  return i >= 0 ? s.slice(i + 3).trim() : s;
}

// Strip Chinese and normalise symbols so output is fully English.
function enClean(s) {
  if (s == null) return '';
  let t = String(s);
  t = t.replace(/可升/g, 'upgradable to').replace(/含/g, 'with').replace(/不带/g, 'without');
  t = t.replace(/¥/g, 'RMB').replace(/￥/g, 'RMB').replace(/㎡/g, 'm2')
       .replace(/台/g, 'units').replace(/面议/g, 'TBC')
       .replace(/（/g, ' (').replace(/）/g, ')')
       .replace(/[一-鿿]/g, '');
  return t.replace(/\s+/g, ' ').trim();
}

function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

// ---- value mapping ---------------------------------------------------------

export function buildQuotationValues({ needs, quote, rec }) {
  const n = needs || {};
  const q = quote || {};
  const r = rec || {};
  const cfg = r.config || {};
  const spec = r.spec || null;
  const geo = q.geometry || null;

  const now = new Date();
  const y = now.getFullYear();
  const mo = String(now.getMonth() + 1).padStart(2, '0');
  const da = String(now.getDate()).padStart(2, '0');
  const dateStr = y + '-' + mo + '-' + da;
  const seq = String(Math.floor(now.getTime() / 1000) % 100000).padStart(5, '0');
  const currency = (q.currency && String(q.currency).trim()) || 'RMB';

  const typeEn = (cfg.typeName && cfg.typeName.en) ? cfg.typeName.en : 'LED Display';
  const pitch = cfg.pitch;

  const lines = Array.isArray(q.lines) ? q.lines : [];
  const base = lines[0] || null;
  const comps = lines.slice(1);
  // 10 option rows (opt0..opt9). Keep the first 9 components in their own rows;
  // if there are more, merge everything from the 10th component onward into the
  // last row so the grand total (SUM of the =B*D formulas) is always preserved
  // exactly — no component amount is ever dropped.
  const slots = comps.slice(0, 9);
  if (comps.length > 9) {
    const excess = comps.slice(9);
    const sum = excess.reduce(function (s, l) { return s + (Number(l.amount) || 0); }, 0);
    slots[9] = {
      name: 'Additional components',
      sub: excess.map(function (l) { return enHalf(l.name); }).join(', '),
      qty: 1, unit: sum, amount: sum, _merged: true,
    };
  }

  const map = {};
  map.seller_company = 'LEDOVIX Display Technology';
  map.seller_tagline = 'LED Display Solutions for Rental, Events & Fixed Installation';
  map.seller_name = 'Leo';
  map.prepared_by = 'Leo Mandy — LEDOVIX Sales Team';
  map.currency = currency;
  map.quotation_number = 'LED-Q-' + y + mo + da + '-' + seq;
  map.date = dateStr;
  map.customer_name = n.name || '—';
  map.customer_tel = n.phone || '—';
  map.customer_email = n.email || '—';

  map.product_title = typeEn + (pitch ? ' — P' + pitch : '');
  map.product_subtitle = typeEn + (cfg.ctrlBrandEn ? ' · ' + cfg.ctrlBrandEn + ' control system' : '');

  if (geo && geo.W != null && geo.H != null) {
    map.screen_size = round2(geo.W) + ' x ' + round2(geo.H) + ' m (' + round2(geo.area) + ' m2)';
  } else if (n.screenSize && n.screenSize.display) {
    map.screen_size = n.screenSize.display;
  } else {
    map.screen_size = '—';
  }
  map.pixel_pitch = pitch ? (pitch + ' mm (P' + pitch + ')') : '—';
  if (spec && spec.pxW && spec.pxH) map.resolution = Math.round(spec.pxW) + ' x ' + Math.round(spec.pxH) + ' px';
  else if (geo && geo.pxW && geo.pxH) map.resolution = Math.round(geo.pxW) + ' x ' + Math.round(geo.pxH) + ' px';
  else map.resolution = '—';
  map.brightness = (spec && spec.brightness) ? enClean(spec.brightness) : '—';
  map.refresh_rate = (spec && spec.refresh) ? enClean(spec.refresh) : '—';
  if (spec && spec.ipRating) map.ip_rating = enClean(spec.ipRating);
  else map.ip_rating = (cfg.env && /out/i.test(String(cfg.env))) ? 'IP65 front / IP54 rear' : 'IP43';

  // Base = screen body. price = UNIT price (so E15 = qty * unit = line amount).
  map.base_qty = base ? Number(base.qty) : 0;
  map.base_price = base ? Number(base.unit) : 0;
  map.base_desc = base ? (enHalf(base.name) + (base.sub ? ' — ' + enClean(base.sub) : '')) : '—';

  for (let i = 0; i < 10; i++) {
    const it = slots[i];
    if (it) {
      map['opt' + i + '_qty'] = Number(it.qty);
      map['opt' + i + '_price'] = Number(it.unit);
      map['opt' + i + '_desc'] = enHalf(it.name) + (it.sub ? ' — ' + enClean(it.sub) : '');
    } else {
      map['opt' + i + '_qty'] = 0;
      map['opt' + i + '_price'] = 0;
      map['opt' + i + '_desc'] = '—';
    }
  }

  map.services_note = 'Prices are indicative reference quotes, tax-included. Spare parts equal 5% of screen body. Final price is subject to a formal contract.';
  map.payment_terms = '50% deposit, 50% before shipment';
  map.warranty = '2 years';
  map.lead_time = '15-20 working days';
  map.price_validity = '30 days from quotation date';
  map.delivery_terms = 'EXW / FOB Shenzhen (Incoterms 2020)';
  map.vat_note = 'Price includes 13% VAT where applicable.';

  return map;
}

// ---- build -----------------------------------------------------------------

export async function buildQuotationXlsx({ needs, quote, rec }) {
  const map = buildQuotationValues({ needs, quote, rec });
  const bytes = b64ToBytes(TEMPLATE_B64);
  const files = unzipSync(bytes);
  let sheet = new TextDecoder('utf-8').decode(files[SHEET_PATH]);

  // 1) Substitute string tokens globally (each token lives in its own cell, or
  //    is shared by a few header cells with the same value, e.g. currency).
  Object.keys(map).forEach(function (tok) {
    const re = new RegExp('\\{\\{' + tok + '\\}\\}', 'g');
    if (re.test(sheet)) {
      sheet = sheet.replace(re, escapeXml(map[tok]));
    }
  });

  // 2) Convert numeric cells to real numbers so the =B*D totals compute.
  NUMERIC.forEach(function (pair) {
    const coord = pair[0];
    const tok = pair[1];
    const num = map[tok];
    if (num === undefined || num === null) return;
    const re = new RegExp('<c r="' + coord + '"([^>]*?)t="inlineStr"([^>]*>)[\\s\\S]*?</c>');
    if (re.test(sheet)) {
      sheet = sheet.replace(re, '<c r="' + coord + '"$1$2<v>' + num + '</v></c>');
    }
  });

  files[SHEET_PATH] = new TextEncoder().encode(sheet);
  const out = zipSync(files);
  const content = bytesToBase64(out);
  const safeName = (needs && needs.name ? String(needs.name) : 'Lead').replace(/[^\w\-]+/g, '_');
  return {
    filename: 'LEDOVIX_Quotation_' + safeName + '.xlsx',
    content: content,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
}

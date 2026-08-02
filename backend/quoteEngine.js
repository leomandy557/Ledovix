/* ============================================================
   LEDOVIX Quote Engine  (backend pricing brain)
   ------------------------------------------------------------
   Faithful, DOM-free port of the led-configurator `app.js`
   `compute()` pricing pipeline. It consumes the SAME catalogue
   (window.__CATALOG__) and the SAME selection result produced by
   `recommend.js` (LEDRecommend.recommend), so the numbers match the
   standalone configurator exactly.

   Usable from the browser (window.QuoteEngine) and from Node
   (module.exports) — both call sites share one brain.
   ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QuoteEngine = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

var ceil = Math.ceil;

/* ---------- small formatting helpers (work without a DOM) ---------- */
function fmt(n, d) {
  if (n === null || n === undefined || !isFinite(n)) return '—';
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });
}
function rmb(n) { return '¥' + fmt(Math.round(n)); }
function usd(n) { return '$' + fmt(Math.round(n)); }
function mm(n) { return fmt(n, n % 1 ? 1 : 0); }

/* ---------- catalogue lookups (mirror of app.js) ---------- */
function priceOf(m) { return (m.price_std || m.price_alt || m.price_rmb_per_cabinet || 0); }
function isPoster(t) { return !!(t && t.groups && t.groups[0] === '__MPS__'); }

function parseSize(str) {
  var m = String(str || '').match(/(\d+(?:\.\d+)?)\s*[*x×]\s*(\d+(?:\.\d+)?)/);
  return m ? [parseFloat(m[1]), parseFloat(m[2])] : null;
}
function isMult(a, b) { return b > 0 && Math.round(a / b) >= 1 && Math.abs(a / b - Math.round(a / b)) < 0.02; }

function cabCandidates(DB, mod) {
  var out = [];
  DB.cabinets.forEach(function (c, i) {
    if (c.unit === '元/㎡') { out.push({ i: i, c: c, cs: null }); return; }
    var cs = parseSize(c.size);
    if (cs && mod && isMult(cs[0], mod[0]) && isMult(cs[1], mod[1])) out.push({ i: i, c: c, cs: cs });
  });
  return out;
}
function virtualCab(mod) {
  return [Math.max(1, Math.round(640 / mod[0])) * mod[0], Math.max(1, Math.round(640 / mod[1])) * mod[1]];
}
function pickCabinet(DB, t, mod) {
  var cands = cabCandidates(DB, mod);
  if (!cands.length) return -1;
  var pref = t && t.cabinet_pref;
  if (pref) {
    var parts = pref.split('|');
    var hit = cands.find(function (x) { return parts.every(function (p) { return (x.c.env + ' ' + x.c.material + ' ' + x.c.size).indexOf(p) >= 0; }); });
    if (hit) return hit.i;
  }
  var perPc = cands.filter(function (x) { return x.cs; });
  return (perPc[0] || cands[0]).i;
}
function defaultPsu(DB) {
  var i = DB.power_supplies.findIndex(function (p) { return p.spec === '国外带认证300W' && p.brand === '友谊'; });
  return i < 0 ? 1 : i;
}

/* ---------- controller pools (mirror of app.js) ---------- */
var RECV_CATS = ['接收卡', 'R系列接收卡', 'K系列接收卡', '5A系列同步卡', '6A系列同步卡', 'K系列'];
var SEND_CATS = ['发送盒', 'LED视频控制器', '超级主控', '独立主控', '视频控制器（国内版）',
  '视频控制器（海外版）', 'LED同步发送卡', '同步发送卡', '同步发送盒',
  '4K同步发送盒', '4K超级主控', '插卡式发送卡'];
function recvPool(DB, b) { return DB.controllers.filter(function (c) { return c.brand === b && RECV_CATS.indexOf(c.category) >= 0 && c.price && c.load_px; }); }
function sendPool(DB, b) { return DB.controllers.filter(function (c) { return c.brand === b && SEND_CATS.indexOf(c.category) >= 0 && c.price && c.load_px; }); }

function rentalCabSize(rentalCab) { return rentalCab === '500x1000' ? [500, 1000] : [500, 500]; }
function rentalSendModel(DB, R, totalPx) {
  var nova = DB.controllers.filter(function (c) { return c.brand === '诺瓦 Novastar' && c.price && c.load_px; });
  var vxPro = nova.filter(function (c) { return /VX\d.*[Pp]ro/.test(c.model); });
  var tb = nova.filter(function (c) { return /^TB\d/.test(c.model); });
  var pool = (totalPx < (R.rental_small_px_threshold || 2000000)) ? tb : vxPro;
  var fit = pool.filter(function (c) { return c.load_px >= totalPx; }).sort(function (a, b) { return a.price - b.price; });
  return fit[0] || pool.slice().sort(function (a, b) { return (b.load_px - a.load_px) || (a.price - b.price); })[0] || null;
}

/* ============================================================
   MAIN: compute quote from a recommendation result
   ============================================================ */
function computeQuote(DB, rec, opts) {
  opts = opts || {};
  var R = DB.rules || {};
  var cfg = rec.config || {};
  var fx = opts.fx || R.fx_fallback || 7.15;
  var markup = (opts.markup !== undefined) ? opts.markup : 1.0;
  var qty = cfg.qty || 1;

  var t = DB.screen_types.filter(function (x) { return x.id === cfg.typeId; })[0] || null;
  if (!t) return { ok: false, error: 'unknown screen type ' + cfg.typeId };

  /* locate the selected model + its group inside the catalogue */
  var g = DB.screen_groups.filter(function (x) { return x.group === cfg.group; })[0] || null;
  if (!g) return { ok: false, error: 'group not found: ' + cfg.group };
  var m = g.items.filter(function (x) { return x.model === cfg.model; })[0] || g.items[0];
  if (!m) return { ok: false, error: 'model not found: ' + cfg.model };

  var inc = g.includes || { cabinet: null, psu: null, card: null };
  var poster = isPoster(t);
  var use = cfg.use || { cabinet: true, psu: true, powerbox: true, cables: true, install: true, crate: true, spare: true };

  /* ---- grid unit (mirror compute() 250-279) ---- */
  var mod = m.module_size || null;
  var u, cabObj = null, cabApplies = false;
  if (t.id === 'rental' && mod) {
    var rc = rentalCabSize(cfg.rentalCab);
    cabObj = DB.cabinets.filter(function (c) { var cs = parseSize(c.size); return cs && cs[0] === rc[0] && cs[1] === rc[1]; })[0] || null;
    u = (isMult(rc[0], mod[0]) && isMult(rc[1], mod[1]))
      ? { w: rc[0], h: rc[1], kind: 'cabinet', fb: false, virtual: false }
      : (function () { var v = virtualCab(mod); return { w: v[0], h: v[1], kind: 'cabinet', fb: false, virtual: true }; })();
  } else {
    cabApplies = t.cabinet_applicable !== false && inc.cabinet !== true && use.cabinet;
    if (m.cabinet_size) {
      u = { w: m.cabinet_size[0], h: m.cabinet_size[1], kind: 'cabinet', fb: false, virtual: false };
    } else if (mod) {
      var taken = false;
      if (cabApplies) {
        cabObj = DB.cabinets[pickCabinet(DB, t, mod)] || null;
        var csb = cabObj && cabObj.unit !== '元/㎡' ? parseSize(cabObj.size) : null;
        if (csb && isMult(csb[0], mod[0]) && isMult(csb[1], mod[1])) {
          u = { w: csb[0], h: csb[1], kind: 'cabinet', fb: false, virtual: false }; taken = true;
        } else {
          var vv = virtualCab(mod);
          u = { w: vv[0], h: vv[1], kind: 'cabinet', fb: false, virtual: true }; taken = true;
        }
      }
      if (!taken) u = { w: mod[0], h: mod[1], kind: 'module', fb: false, virtual: false };
    } else {
      u = { w: 500, h: 500, kind: 'module', fb: true, virtual: false };
    }
  }

  /* ---- geometry ---- */
  var units = cfg.units || 1, cols, rows, wMM, hMM, unitCount;
  if (poster) {
    unitCount = Math.max(1, units);
    cols = unitCount; rows = 1;
    wMM = u.w * cols; hMM = u.h * rows;
  } else {
    cols = Math.max(1, Math.round(cfg.targetW * 1000 / u.w));
    rows = Math.max(1, Math.round(cfg.targetH * 1000 / u.h));
    wMM = cols * u.w; hMM = rows * u.h;
    unitCount = cols * rows;
  }
  var W = wMM / 1000, H = hMM / 1000, area = W * H;
  var ph = m.pitch || 1, pv = m.pitch_v || m.pitch || 1;
  var pxW = Math.round(wMM / ph), pxH = Math.round(hMM / pv), totalPx = pxW * pxH;
  var unitPx = Math.round(u.w / ph) * Math.round(u.h / pv);
  var modPx = mod ? Math.round(mod[0] / ph) * Math.round(mod[1] / pv) : unitPx;

  var moduleCount = 0, cabinetCount = 0, cabSize = null;
  if (u.kind === 'cabinet') {
    cabinetCount = unitCount;
    cabSize = [u.w, u.h];
    if (mod) moduleCount = unitCount * Math.max(1, Math.round(u.w / mod[0])) * Math.max(1, Math.round(u.h / mod[1]));
  } else {
    moduleCount = unitCount;
  }

  var maxWsqm = m.max_power_sqm || (t.power && t.power.max_w_sqm) || 500;
  var avgWsqm = (t.power && t.power.avg_w_sqm) || Math.round(maxWsqm * 0.35);
  var maxW = area * maxWsqm, avgW = area * avgWsqm, maxKW = maxW / 1000;

  /* ---- controllers ---- */
  var ctrlBrand = cfg.ctrlBrand || '诺瓦 Novastar';
  var rp = recvPool(DB, ctrlBrand);
  var sp = sendPool(DB, ctrlBrand);
  var recv = null, send = null;
  if (cabinetCount > 0) {
    var fitR = rp.filter(function (c) { return c.load_px >= unitPx; }).sort(function (a, b) { return a.price - b.price; });
    recv = fitR[0] || rp.slice().sort(function (a, b) { return (b.load_px - a.load_px) || (a.price - b.price); })[0] || null;
  } else {
    var fitR2 = rp.filter(function (c) { return c.load_px >= modPx; }).sort(function (a, b) { return (a.price / a.load_px) - (b.price / b.load_px) || a.price - b.price; });
    recv = fitR2[0] || rp.slice().sort(function (a, b) { return (b.load_px - a.load_px) || (a.price - b.price); })[0] || null;
  }
  if (t.id === 'rental') {
    send = rentalSendModel(DB, R, totalPx);
  } else {
    var fitS = sp.filter(function (c) { return c.load_px >= totalPx; }).sort(function (a, b) { return a.price - b.price; });
    send = fitS[0] || sp.slice().sort(function (a, b) { return (b.load_px - a.load_px) || (a.price - b.price); })[0] || null;
  }
  var recvCount = !recv ? 0
    : cabinetCount > 0 ? cabinetCount * Math.max(1, ceil(unitPx / recv.load_px))
      : Math.max(1, ceil(totalPx / recv.load_px));
  var sendCount = send ? Math.max(1, ceil(totalPx / send.load_px)) : 1;

  /* ---- line items ---- */
  var L = [];
  function push(name, sub, qty2, unitPrice, opt) {
    opt = opt || {};
    var amt = opt.amount !== undefined ? opt.amount : qty2 * unitPrice;
    L.push({ name: name, sub: sub, qty: qty2, unit: unitPrice, amount: amt, included: !!opt.included, tbd: !!opt.tbd });
  }

  /* 1) screen body */
  var screenAmt = 0, screenNote = '';
  if (poster) {
    screenAmt = (m.price_rmb_per_cabinet || 0) * units;
    screenNote = rmb(m.price_rmb_per_cabinet) + ' × ' + units + ' 台';
    push('屏体 · ' + m.model + ' / Screen body', screenNote, units, (m.price_rmb_per_cabinet || 0), { amount: screenAmt });
  } else {
    var p = priceOf(m);
    screenAmt = (p || 0) * area;
    screenNote = (p ? rmb(p) + '/㎡' : '面议') + ' × ' + area.toFixed(2) + '㎡';
    push('屏体 · ' + g.group + ' ' + m.model + ' / Screen body', screenNote, area, p || 0, { amount: screenAmt, tbd: !p });
  }

  /* 1b) rental cabinet upgrade */
  if (t.id === 'rental' && cfg.rentalCab === '500x1000') {
    var up = R.rental_cab_upgrade_per_sqm || 0;
    push('箱体规格升级 / Cabinet upgrade', '500 × 1000 mm', area, up);
  }

  /* 2) cabinet */
  if (!poster && t.cabinet_applicable !== false) {
    if (inc.cabinet === true) push('箱体 / Cabinet', '已含在屏体价内 / included', 0, 0, { included: true });
    else if (use.cabinet && !m.cabinet_size) {
      var cab = cabObj;
      if (cab) {
        if (u.virtual || cab.unit === '元/㎡') {
          var sqmCab = cab.unit === '元/㎡' ? cab : (DB.cabinets.filter(function (c) { return c.unit === '元/㎡'; })[0] || cab);
          push('箱体 · ' + cabName(cab) + (u.virtual ? ' ' + mm(u.w) + '×' + mm(u.h) + 'mm' : '') + ' / Cabinet', rmb(sqmCab.price) + '/㎡', area, sqmCab.price);
        } else {
          push('箱体 · ' + cabName(cab) + ' / Cabinet', rmb(cab.price) + '/个', cabinetCount, cab.price);
        }
      }
    }
  }

  /* 3) psu */
  var psuCount = 0, psu = null;
  if (!poster && use.psu) {
    if (inc.psu === true) push('电源 / Power supply', '已含 / included', 0, 0, { included: true });
    else {
      psu = DB.power_supplies[opts.psuIdx !== undefined ? opts.psuIdx : defaultPsu(DB)] || DB.power_supplies[defaultPsu(DB)];
      psuCount = ceil(maxW / (psu.watt || R.psu_default_watt));
      push('电源 · ' + psuName(psu) + ' / Power supply', ceil(maxW) + 'W / ' + psu.watt + 'W', psuCount, psu.price);
    }
  }

  /* 4) receiving card */
  if (inc.card === true) push('接收卡 / Receiving card', '已含 / included', 0, 0, { included: true });
  else if (recv) push('接收卡 · ' + bname(recv.brand) + ' ' + recv.model + ' / Receiving card',
    '带载 ' + fmt(recv.load_px) + 'px × ' + recvCount, recvCount, recv.price);

  /* 5) sending card */
  if (send) push('发送卡 · ' + bname(send.brand) + ' ' + send.model + ' / Sending card',
    '带载 ' + fmt(send.load_px) + 'px ≥ ' + fmt(totalPx) + 'px', sendCount, send.price);

  /* 6) distribution box */
  var pbox = null;
  if (use.powerbox && !poster) {
    var cands = DB.power_boxes.filter(function (b) { return b.price && b.kw && b.kw >= maxKW; }).sort(function (a, b) { return a.kw - b.kw || a.price - b.price; });
    pbox = cands[0] || DB.power_boxes.filter(function (b) { return b.price && b.kw; }).sort(function (a, b) { return b.kw - a.kw; })[0];
    if (pbox) push('配电箱 · ' + pbox.model + ' / Power distribution box', maxKW.toFixed(1) + 'kW → ' + pbox.kw + 'kW', 1, pbox.price);
  }

  /* 7) cables */
  if (use.cables && !poster) {
    var up2 = function (s) { var mt = String(s || '').match(/-(\d+(?:\.\d+)?)/); return mt ? parseFloat(mt[1]) : 0; };
    var mainCable = DB.cables.main.filter(function (c) { return up2(c.kw_3p) >= maxKW; })[0] || DB.cables.main[DB.cables.main.length - 1];
    var mainLen = R.main_cable_default_len_m || 30;
    push('主电缆 ' + mainCable.spec + ' / Main power cable', mainLen + 'm × ' + rmb(mainCable.price_per_m) + '/m', mainLen, mainCable.price_per_m);
    var duct = (String(mainCable.note || '').match(/(\d+(?:\.\d+)?)\s*元\/米/) || [])[1];
    if (duct) push('线槽及配件 / Duct & fittings', mainLen + 'm × ' + rmb(+duct) + '/m', mainLen, +duct);
    var br = DB.cables.branch[1] || DB.cables.branch[0];
    var branchLen = R.branch_cable_default_len_m || 60;
    push('分支线 ' + br.spec + ' / Branch cable', branchLen + 'm × ' + rmb(br.price_per_m) + '/m', branchLen, br.price_per_m);
    var netLen = R.signal_cable_default_len_m || 80;
    push('网线（含接头） / Signal cable', netLen + 'm × ' + rmb(R.net_cable_per_m) + '/m', netLen, R.net_cable_per_m);
  }

  /* 8) install */
  var ins = null;
  if (use.install) {
    ins = DB.install.filter(function (x) { return x.name === (cfg.installName || t.install_default); })[0] || null;
    if (ins && ins.price) push('安装 · ' + iname(ins.name) + ' / Installation', rmb(ins.price) + '/㎡', area, ins.price);
    else if (ins) push('安装 · ' + iname(ins.name) + ' / Installation', ins.price_raw || '面议', 0, 0, { tbd: true });
  }

  /* 9) crate / packing */
  if (use.crate) {
    var pk = cfg.packing || t.packing || 'wooden';
    var perSqm = pk === 'flight' ? (R.flight_case_per_sqm || 0) : (R.wood_crate_per_sqm || 0);
    push('包装 · ' + (pk === 'flight' ? '航空箱 / Flight case' : '木箱 / Wooden crate'),
      rmb(perSqm) + '/㎡', area, perSqm);
  }

  /* 10) spare — 5% of screen body price (modules + PSU + cards, excl. cabinet frame) */
  if (use.spare) push('备品备件 · 模组/电源/接收卡 / Spare parts', '5% × 屏体 / screen body', 1, screenAmt * 0.05);

  /* 11) outdoor small area surcharge */
  if (t.env === 'outdoor' && !poster) {
    var tierRow = (R.outdoor_small_area_surcharge || []).filter(function (x) { return area <= x.max_sqm; })[0];
    if (tierRow) push('户外小面积附加 / Outdoor small-area surcharge',
      '≤' + tierRow.max_sqm + '㎡ · ' + rmb(tierRow.add_per_sqm) + '/㎡', area, tierRow.add_per_sqm);
  }

  var sub = L.reduce(function (a, x) { return a + (x.included ? 0 : x.amount); }, 0);
  var withMarkup = sub * markup;
  var total = withMarkup * qty;
  var perSqm = area ? withMarkup / area : 0;

  return {
    ok: true,
    lines: L,
    sub: sub,
    markup: markup,
    qty: qty,
    total: total,
    perSqm: perSqm,
    usd: total / fx,
    fx: fx,
    geometry: {
      W: W, H: H, area: area, cols: cols, rows: rows, unitCount: unitCount,
      unitKind: u.kind, unitW: u.w, unitH: u.h, cabSize: cabSize,
      pxW: pxW, pxH: pxH, totalPx: totalPx, cabinetCount: cabinetCount, moduleCount: moduleCount,
      maxKW: Math.round(maxKW * 100) / 100, avgKW: Math.round((avgW / 1000) * 100) / 100,
      brightness: t.id === 'rental' ? '4500 cd/m² (峰值)' : (t.brightness_hint || null)
    },
    ctrl: { recv: recv, recvCount: recvCount, send: send, sendCount: sendCount, psu: psu, psuCount: psuCount, pbox: pbox, install: ins }
  };
}

/* ---------- name helpers (bilingual-aware, lang-agnostic) ---------- */
function cabName(c) {
  if (!c) return '';
  if (c.unit === '元/㎡') return (c.env || '') + (c.material || '') + ' ' + c.size + ' (㎡)';
  return (c.env || '') + (c.material || '') + ' ' + c.size;
}
function psuName(p) { return p ? (p.brand + ' ' + p.spec) : ''; }
function bname(b) { return b ? (b.split(' ')[1] || b) : ''; }
function iname(n) { return n || ''; }

return {
  computeQuote: computeQuote,
  priceOf: priceOf,
  /* exposed for debugging / tests */
  _internals: { parseSize: parseSize, isMult: isMult, cabCandidates: cabCandidates, virtualCab: virtualCab, pickCabinet: pickCabinet, recvPool: recvPool, sendPool: sendPool }
};
}));

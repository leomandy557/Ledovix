/* ============================================================
   LEDOVIX backend bridge
   ------------------------------------------------------------
   Thin orchestration layer that the website calls after Leo has
   collected the customer's needs. It feeds those needs into the
   led-configurator brain (catalog + recommend.js) and the pricing
   engine (quoteEngine.js), then returns a ready-to-show text quote.

   Exposes (all global, callable from the page):
     buildNeedFromCollected(needs)  -> need object for LEDRecommend
     generateQuote(needs, opts)     -> { ok, rec, quote, text, error }
     formatQuoteText(rec, quote, lang) -> human-readable quote string
   ============================================================ */
(function () {
'use strict';

var DB = function () { return (typeof window !== 'undefined' && window.__CATALOG__) || null; };

/* ---- scenario / install / distance mapping (chat -> backend) ---- */
function mapScenario(scenarioText, screenTypeText) {
  // screenType overrides scenario when it gives more specific info
  var st = (screenTypeText || '').toLowerCase();
  var sc = (scenarioText || '').toLowerCase();
  var env = /outdoor|户外|室外/i.test(sc + st) ? 'outdoor' : 'indoor';

  if (/rental|租赁|舞台|演出|活动|event|concert|stage|festival|touring|roadshow|quick setup|teardown/i.test(st)) {
    return { env: env, scene: 'rental' };
  }
  if (/billboard|广告|signage|大屏|outdoor.*fixed|fixed.*outdoor/i.test(st)) {
    return { env: 'outdoor', scene: 'outdoor_fixed' };
  }
  if (/outdoor|户外|室外/i.test(sc)) {
    return { env: 'outdoor', scene: 'outdoor_fixed' };
  }
  // Default: indoor fixed (could be conference, retail, etc.)
  if (/indoor|室内/i.test(sc)) return { env: 'indoor', scene: 'indoor_fixed' };
  return { env: 'indoor', scene: 'indoor_fixed' };
}
function mapInstall(scenarioEnv, screenType, text) {
  // Rental screens are always floor-standing / mobile
  if (/rental|租赁|舞台|演出|活动|event|concert|stage/i.test((screenType||'') + (text||''))) return '落地移动支架';
  var floor = /floor|落地|移动|支架|ground|mobile|stand/i.test(text);
  if (scenarioEnv === 'outdoor') return floor ? '落地+斜撑' : '挂墙后维护';
  return floor ? '落地移动支架' : '挂墙';
}
function mapDistance(text) {
  if (/very far|20m\+|billboard|超大|室外广告塔|高速/i.test(text)) return 25;
  if (/<\s*2m|very close|ultra fine/i.test(text)) return 1.5;
  if (/2-5m|close|fine pitch/i.test(text)) return 3.5;
  if (/5-10m|medium|standard/i.test(text)) return 7.5;
  if (/10-20m|far|large pitch/i.test(text)) return 15;
  var m = String(text).match(/(\d+(?:\.\d+)?)\s*m/);
  return m ? parseFloat(m[1]) : null;
}

/* ---- build the structured need object the backend expects ----
   Strategy: run the backend's own parseNeed() on a descriptive sentence
   (so every field parseNeed produces — evidence, scores, etc. — is
   present and valid), then override the fields we know for certain from
   the structured chat result. This keeps recommendLocal() happy and lets
   us steer scene / size / distance / install precisely. ---- */
function buildNeedFromCollected(needs) {
  needs = needs || {};
  var sc = mapScenario(needs.scenario || '', needs.screenType || '');
  var env = sc.env, scene = sc.scene;
  var size = needs.screenSize;
  var w = (size && size.width) ? parseFloat(size.width) : null;
  var h = (size && size.height) ? parseFloat(size.height) : null;
  var dist = mapDistance(needs.viewingDistance || '');
  var installHint = mapInstall(env, needs.screenType || '', needs.installMethod || '');

  var raw = 'Customer request: ' + env + ' LED display. '
    + 'Type: ' + (needs.screenType || 'fixed') + '. '
    + 'Installation: ' + (needs.installMethod || 'n/a') + '. '
    + (w && h ? ('Target size ' + w + ' x ' + h + ' m. ') : '')
    + (dist ? ('Viewing distance about ' + dist + ' m. ') : '')
    + (needs.name ? ('Contact: ' + needs.name + '.') : '');

  var base = (typeof LEDRecommend !== 'undefined' && LEDRecommend.parseNeed)
    ? LEDRecommend.parseNeed(raw)
    : { raw: raw, lang: 'en', evidence: [], sceneRanked: [], sceneScore: 0, budget: 'standard', connHint: null, confidence: 'high' };

  base.raw = raw;
  base.lang = 'en';
  base.scene = scene;
  base.env = env;
  base.budget = 'standard';
  base.size = (w && h) ? { w: w, h: h, src: 'wxh' } : base.size;
  base.distance = (dist !== null) ? dist : base.distance;
  base.qty = 1;
  base.installHint = installHint;

  // Control system brand -> drives card pricing in quoteEngine (cfg.ctrlBrand).
  // Option objects carry the exact catalog brand string (诺瓦 Novastar / 灰度 Huidu
  // / 卡莱特 Colorlight); fall back to a label parse for safety.
  var cs = needs.controlSystem;
  base.ctrlBrand = (cs && typeof cs === 'object' && cs.brand) ? cs.brand : mapControlBrand(cs);

  // Connection type (hard / soft) -> steers rental model selection in recommend.js.
  var ct = needs.connectionType;
  var connKind = (ct && typeof ct === 'object' && ct.kind) ? ct.kind : mapConnKind(ct);
  base.connHint = (connKind === 'hard' || connKind === 'soft') ? connKind : null;

  base.confidence = 'high';
  return base;
}

/* control-system label (or object) -> catalog brand string used by controllers[] */
function mapControlBrand(s) {
  s = String(s || '');
  if (/诺瓦|novastar/i.test(s)) return '诺瓦 Novastar';
  if (/灰度|huidu/i.test(s)) return '灰度 Huidu';
  if (/卡莱特|colorlight/i.test(s)) return '卡莱特 Colorlight';
  return '诺瓦 Novastar';
}
/* connection label (or object) -> 'hard' | 'soft' (language-agnostic) */
function mapConnKind(s) {
  s = String(s || '');
  if (/硬|hard|rigid|cableada|filiare|rígida|rigide/i.test(s)) return 'hard';
  if (/软|soft|flex|modular|souple|flexível/i.test(s)) return 'soft';
  return null;
}

/* ---- full pipeline: needs -> recommendation -> quote ---- */
function generateQuote(needs, opts) {
  opts = opts || {};
  var catalog = DB();
  if (!catalog) return { ok: false, error: 'Catalogue not loaded (window.__CATALOG__ missing).' };
  if (typeof LEDRecommend === 'undefined' || !LEDRecommend.recommend) return { ok: false, error: 'Recommendation engine not loaded.' };
  if (typeof QuoteEngine === 'undefined' || !QuoteEngine.computeQuote) return { ok: false, error: 'Quote engine not loaded.' };

  try {
    var need = buildNeedFromCollected(needs);
    var rec = LEDRecommend.recommend(catalog, need);
    if (!rec || !rec.ok) return { ok: false, error: (rec && rec.error) ? rec.error : 'Recommendation failed.' };

    var quote = QuoteEngine.computeQuote(catalog, rec, {
      fx: opts.fx || (catalog.rules && catalog.rules.fx_fallback) || 7.15,
      markup: (opts.markup !== undefined) ? opts.markup : 1.0,
      psuIdx: opts.psuIdx
    });
    if (!quote || !quote.ok) return { ok: false, error: (quote && quote.error) ? quote.error : 'Quote computation failed.' };

    var text = formatQuoteText(rec, quote, opts.lang || 'en');
    return { ok: true, rec: rec, quote: quote, text: text, need: need };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

/* ---- render a clean, human-readable text quote ---- */
function fmt(n, d) {
  if (n === null || n === undefined || !isFinite(n)) return '—';
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });
}
function rmb(n) { return '¥' + fmt(Math.round(n)); }
function usd(n) { return '$' + fmt(Math.round(n)); }
function mm(n) { return fmt(n, n % 1 ? 1 : 0); }

function formatQuoteText(rec, quote, lang) {
  lang = lang || 'en';
  var cfg = rec.config, spec = rec.spec, geo = quote.geometry, t = rec.config || {};
  var L = [];
  var line = function (s) { L.push(s === undefined ? '' : s); };

  var title = (lang === 'zh') ? 'LED 显示屏方案与报价' : 'LED DISPLAY PROPOSAL & QUOTATION';
  line(title);
  line('='.repeat(58));
  line('');

  /* configuration summary */
  line((lang === 'zh' ? '配置概览 / CONFIGURATION' : 'CONFIGURATION'));
  line('-'.repeat(58));
  line('  ' + (lang === 'zh' ? '类型' : 'Type') + '         : ' + (cfg.typeName.cn) + '  (' + (cfg.typeName.en || cfg.typeName.cn) + ')');
  line('  ' + (lang === 'zh' ? '推荐型号' : 'Model') + '        : ' + cfg.model + '   P' + cfg.pitch + (cfg.pitchV && cfg.pitchV !== cfg.pitch ? ' x P' + cfg.pitchV : '') + 'mm');
  line('  ' + (lang === 'zh' ? '屏幕尺寸' : 'Screen size') + '    : ' + geo.W.toFixed(3) + ' m (W) x ' + geo.H.toFixed(3) + ' m (H)  =  ' + geo.area.toFixed(2) + ' m²'
    + (cfg.qty > 1 ? '   x ' + cfg.qty + ' sets' : ''));
  line('  ' + (lang === 'zh' ? '分辨率' : 'Resolution') + '     : ' + fmt(geo.pxW) + ' x ' + fmt(geo.pxH) + ' px  (' + (geo.totalPx / 1e6).toFixed(2) + ' M pixels)');
  if (geo.unitKind === 'cabinet') line('  ' + (lang === 'zh' ? '箱体' : 'Cabinet') + '         : ' + mm(geo.unitW) + ' x ' + mm(geo.unitH) + ' mm   /  ' + fmt(geo.cabinetCount) + ' pcs');
  line('  ' + (lang === 'zh' ? '功耗' : 'Power') + '          : ' + geo.maxKW.toFixed(2) + ' kW max  /  ' + geo.avgKW.toFixed(2) + ' kW avg');
  line('  ' + (lang === 'zh' ? '安装方式' : 'Installation') + '    : ' + (cfg.installName || (lang === 'zh' ? '待确认' : 'TBC')));
  line('  ' + (lang === 'zh' ? '包装' : 'Packing') + '         : ' + (cfg.packing === 'flight' ? (lang === 'zh' ? '航空箱' : 'Flight case') : (lang === 'zh' ? '木箱' : 'Wooden crate')) + ' (export standard)');
  line('');

  /* price breakdown */
  line((lang === 'zh' ? '价格明细 / PRICE BREAKDOWN' : 'PRICE BREAKDOWN'));
  line('-'.repeat(58));
  quote.lines.forEach(function (it) {
    if (it.included) {
      line('  ✓ ' + it.name + '  (' + (lang === 'zh' ? '已含' : 'included') + ')');
      return;
    }
    if (it.tbd) {
      line('  ' + it.name + '  → ' + (lang === 'zh' ? '面议' : 'TBC'));
      return;
    }
    var amt = rmb(it.amount);
    line('  ' + it.name);
    line('      ' + it.sub + '   =   ' + amt);
  });
  line('');

  /* totals */
  line('-'.repeat(58));
  var subtotal = quote.sub * quote.markup;
  if (quote.qty > 1) line('  ' + (lang === 'zh' ? '小计 × ' : 'Subtotal × ') + quote.qty + ' ' + (lang === 'zh' ? '套' : 'sets') + '      : ' + rmb(subtotal));
  line('  ' + (lang === 'zh' ? '合计（人民币）' : 'GRAND TOTAL (RMB)') + '  : ' + rmb(quote.total));
  line('  ' + (lang === 'zh' ? '折合美元 @ ' : 'USD equivalent @ ') + quote.fx.toFixed(2) + '  : ' + usd(quote.usd));
  line('  ' + (lang === 'zh' ? '单价 / ㎡' : 'Unit price / m²') + '        : ' + rmb(quote.perSqm) + '  /  ' + usd(quote.perSqm / quote.fx));
  line('');

  /* why this config (short) — skip the module-snap line so the
     explanation stays consistent with the cabinet-based geometry above */
  if (rec.reasons && rec.reasons.length) {
    var shown = rec.reasons.filter(function (r) {
      return !/snapped to whole|取整/.test(r.en) && !/snapped to whole|取整/.test(r.cn);
    });
    line((lang === 'zh' ? '选型说明 / WHY' : 'WHY THIS CONFIG'));
    line('-'.repeat(58));
    shown.slice(0, 4).forEach(function (r) {
      line('  • ' + (lang === 'zh' ? r.cn : r.en));
    });
    line('');
  }

  line((lang === 'zh'
    ? '说明：以上为含税参考报价，最终价格以正式合同为准。'
    : 'Note: indicative tax-included reference price. Final price subject to formal contract.'));

  return L.join('\n');
}

/* expose globally */
window.LEDOVIX_BACKEND = {
  buildNeedFromCollected: buildNeedFromCollected,
  generateQuote: generateQuote,
  formatQuoteText: formatQuoteText
};
window.generateQuote = generateQuote;       // convenience global
window.buildNeedFromCollected = buildNeedFromCollected;
})();

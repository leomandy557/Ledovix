/* ============================================================
   LEDOVIX — Requirement → Full Configuration Recommender
   ------------------------------------------------------------
   One vague sentence from a customer  →  one complete, ready-to-quote
   configuration (type / size / pitch & model / control / install /
   packing / accessories) plus the reasoning behind it.

   Runs in two modes:
     local   — rule engine bundled with the price catalogue (default,
               used during the transition period, works offline)
     remote  — POSTs to an AI backend endpoint and expects the same
               JSON shape back; falls back to local on any failure.

   Usable from the browser (window.LEDRecommend) and from Node
   (module.exports) so the visual configurator and www.ledovix.com
   share exactly the same brain.
   ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LEDRecommend = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

var VERSION = '1.0.0';

/* ============================================================
   1. KEYWORD TABLES  (Chinese + English)
   ============================================================ */

/* scene → screen type, with weights. Longer / more specific wins. */
var SCENE_RULES = [
  { id:'indoor_conference', w:3, kw:[
    '会议','会议室','视频会议','报告厅','指挥中心','控制室','监控中心','培训室','教室','课室','讲堂','演播','直播间','小间距','无缝','会客','董事会',
    'meeting','conference','boardroom','board room','command center','command centre','control room','monitoring','war room','classroom','training',
    'lecture','auditorium','broadcast','studio','fine pitch','seamless','huddle'] },
  { id:'indoor_conference', w:2, kw:['4k','8k','高清','超高清','cob','uhd','crystal clear','high definition'] },

  { id:'indoor_fixed', w:3, kw:[
    '室内固装','大堂','前台','门厅','接待','展厅','展示厅','商场','店内','专卖店','餐厅','酒店大堂','银行网点','写字楼室内',
    'lobby','reception','foyer','showroom','indoor fixed','retail','shop','store interior','restaurant','hotel lobby','bank branch','museum',
    'exhibition hall','mall','shopping mall','shopping centre','shopping center','supermarket'] },

  { id:'outdoor_fixed', w:3, kw:[
    '户外','室外','广告牌','广告屏','楼体','楼顶','外墙','幕墙广告','路边','街边','门头','招牌','加油站','户外固装','商圈大屏','高速',
    'outdoor','exterior','billboard','facade','building wall','rooftop','roadside','street','shopfront','signboard','gas station','highway','drive-in','out of home','ooh'] },

  { id:'outdoor_high_bright', w:4, kw:[
    '球场','足球场','篮球','体育场','体育馆','看台','围栏屏','记分','阳光直射','强光','万级','高亮','10000','1万','一万',
    'stadium','arena','sports','football','soccer','basketball','pitch side','perimeter','scoreboard','direct sunlight','sunlight','high brightness','10000 nit','10,000 nit'] },

  { id:'rental', w:4, kw:[
    '租赁','出租','舞台','演出','演唱会','音乐节','活动','庆典','婚庆','婚礼','会展','展会','巡演','路演','快装','可拆','移动屏','临时',
    'rental','rent','stage','staging','event','concert','festival','wedding','party','touring','tour','roadshow','exhibition booth','trade show','temporary','portable','quick install','church','worship','sanctuary','conference stage'] },

  { id:'transparent_film', w:4, kw:[
    '贴膜屏','玻璃屏','橱窗','玻璃幕墙','透明贴膜','贴在玻璃','店铺玻璃',
    'film screen','glass screen','window display','storefront glass','shop window','adhesive film','stick on glass','transparent film'] },
  { id:'transparent_film', w:2, kw:['透明','通透','see-through','see through','transparent'] },

  { id:'crystal_film', w:4, kw:['晶膜','水晶膜','crystal film','crystal screen'] },

  { id:'transparent_grille', w:4, kw:['格栅屏','格栅','正发光','条形屏','冰屏','幕墙格栅','grille','grid screen','strip screen','ice screen','mesh curtain'] },

  { id:'holo_grid', w:4, kw:['全息','洞洞屏','镂空','holographic','holo','mesh screen','see-through mesh'] },

  { id:'flexible', w:4, kw:[
    '弧形','曲面','圆柱','柱子','圆形','异形','柔性','软模','波浪','包柱','创意屏',
    'curved','curve','cylinder','cylindrical','column','circular','irregular','flexible','soft module','wave','creative','custom shape','arc'] },

  { id:'poster', w:4, kw:[
    '海报机','海报屏','立式屏','数字标牌','迎宾屏','导视','广告机','单台','店门口',
    'poster','standee','stand-alone','digital signage','kiosk','welcome screen','totem','floor standing display','shop entrance'] },

  { id:'custom_cabinet', w:3, kw:['高定','精品箱体','定制箱体','高端箱体','premium cabinet','custom cabinet','bespoke','high-end cabinet','flagship cabinet'] }
];

var ENV_OUTDOOR_KW = ['户外','室外','露天','外墙','楼体','广告牌','日晒','雨','防水','ip65','阳光','球场','体育场','街','路边','屋顶','楼顶','门口','马路',
  'outdoor','exterior','open air','open-air','outside','rain','waterproof','weatherproof','sunlight','sun','stadium','street','roadside','rooftop',
  'facade','billboard','drive-in','patio','terrace','courtyard','parking','plaza','square','car park'];
var ENV_INDOOR_KW = ['室内','屋内','大堂','会议','商场','店内','展厅','教室','酒店','写字楼',
  'indoor','inside','interior','lobby','meeting','conference','showroom','classroom','hotel','office','mall','store'];

var BUDGET_LOW_KW = ['便宜','经济','低价','性价比','预算有限','省钱','入门','基础款','平价',
  'cheap','budget','affordable','economy','economical','low cost','low-cost','entry level','entry-level','cost effective','cost-effective','value','tight budget'];
var BUDGET_HIGH_KW = ['高端','旗舰','最好','顶级','高品质','不差钱','精品','premium','high-end','high end','top','best','flagship','luxury','finest','no compromise','highest quality'];

var HARD_LINK_KW = ['无缝','固定安装','长期','硬连接','平整度高','permanent','fixed install','seamless','rigid','flatness','long term','long-term'];
var SOFT_LINK_KW = ['快装','频繁拆装','巡演','软连接','轻便','quick','frequent','touring','soft link','soft-link','lightweight','fast setup'];

var INSTALL_KW = [
  { name:'带钢结构吊装', kw:['吊装','吊挂','吊顶','钢结构','悬挂','hang','hanging','hoist','rigging','truss','suspend','flown','ceiling'] },
  { name:'落地移动支架', kw:['落地支架','移动支架','支架','推车','可移动','mobile stand','floor stand','rolling','portable stand','wheels','trolley'] },
  { name:'落地+地基', kw:['地基','基础','独立式','ground foundation','foundation','free standing','freestanding'] },
  { name:'立柱+结构', kw:['立柱','单立柱','双立柱','广告塔','pylon','pole','pillar','monopole','tower'] },
  { name:'弧形挂墙', kw:['弧形','曲面','curved','curve','arc'] },
  { name:'磁吸挂墙', kw:['磁吸','前维护','magnetic','front service','front maintenance'] },
  { name:'挂墙后维护', kw:['后维护','后面有空间','rear service','rear maintenance','back access'] },
  { name:'挂墙', kw:['挂墙','壁挂','上墙','贴墙','wall','wall mount','wall-mounted','mounted on wall'] }
];

/* default target pitch per type (mm) — used when the customer gives no
   viewing distance. Tuned against normal industry practice. */
var DEFAULT_PITCH = {
  indoor_conference: 1.56,
  indoor_fixed: 2.5,
  outdoor_fixed: 5,
  outdoor_high_bright: 8,
  rental: 2.976,
  transparent_film: 5,
  crystal_film: 8,
  transparent_grille: 3.91,
  holo_grid: 3.9,
  flexible: 2.5,
  poster: 1.86,
  custom_cabinet: 1.56
};

/* default physical size per type (m) when nothing is stated */
var DEFAULT_SIZE = {
  indoor_conference: [3.048, 1.7145],
  indoor_fixed: [4, 2.25],
  outdoor_fixed: [6, 4],
  outdoor_high_bright: [10, 6],
  rental: [8, 4],
  transparent_film: [4, 2.5],
  crystal_film: [6, 3],
  transparent_grille: [6, 4],
  holo_grid: [4, 3],
  flexible: [5, 2.5],
  poster: [0.64, 1.92],
  custom_cabinet: [4, 3]
};

/* ============================================================
   2. TEXT PARSING
   ============================================================ */

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[，、；]/g, ',')
    .replace(/[（）]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function hasCJK(s) { return /[\u4e00-\u9fa5]/.test(s); }

/* keyword hit: CJK keywords use substring, latin keywords match whole words
   and tolerate the usual English inflections (s / es / ed / ing / er) */
function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
var _reCache = {};
function hit(text, kw) {
  if (/[\u4e00-\u9fa5]/.test(kw)) return text.indexOf(kw) >= 0;
  var re = _reCache[kw];
  if (!re) {
    re = new RegExp('(^|[^a-z0-9])' + escRe(kw) + '(s|es|ed|d|ing|er|ers)?($|[^a-z0-9])');
    _reCache[kw] = re;
  }
  return re.test(text);
}
function countHits(text, list) {
  var n = 0, found = [];
  for (var i = 0; i < list.length; i++) if (hit(text, list[i])) { n++; found.push(list[i]); }
  return { n:n, found:found };
}

var UNIT_TO_M = { m:1, meter:1, meters:1, metre:1, metres:1, '米':1, mm:0.001, '毫米':0.001, cm:0.01, '厘米':0.01,
  ft:0.3048, foot:0.3048, feet:0.3048, '英尺':0.3048 };

function toMetres(v, unit) {
  if (!unit) return v > 100 ? v / 1000 : (v > 30 ? v / 100 : v);  // bare big numbers are mm / cm
  var k = UNIT_TO_M[unit];
  return k ? v * k : v;
}

/* W x H patterns: "6x3m", "6 x 3 meters", "6米×3米", "10m wide 4m high" */
function parseSize(text) {
  var m;

  /* 1) explicit W x H */
  m = text.match(/(\d+(?:[.,]\d+)?)\s*(m|meter|meters|metre|metres|米|mm|毫米|cm|厘米|ft|feet|foot|英尺)?\s*[x×*by]+\s*(\d+(?:[.,]\d+)?)\s*(m|meter|meters|metre|metres|米|mm|毫米|cm|厘米|ft|feet|foot|英尺)?/);
  if (m) {
    var u = m[4] || m[2];
    var w = toMetres(parseFloat(m[1].replace(',', '.')), u);
    var h = toMetres(parseFloat(m[3].replace(',', '.')), u);
    if (w > 0.2 && h > 0.2 && w < 200 && h < 100) return { w:w, h:h, src:'wxh' };
  }

  /* 2) Chinese labelled dimensions — handles "宽10米高4米", "6米宽 3米高",
        "宽度 10 m, 高度 4 m" in one left-to-right pass. A label written
        before the number wins over one written after it. */
  var lab = /(宽|高)?\s*(?:度)?\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(米|厘米|毫米|m|cm|mm)?\s*(宽|高)?/g;
  var W2 = null, H2 = null, mm2;
  while ((mm2 = lab.exec(text)) !== null) {
    if (mm2[0].trim() === '') { lab.lastIndex++; continue; }
    if (!mm2[2]) continue;
    var label = mm2[1] || mm2[4];
    if (mm2[1] && mm2[4]) lab.lastIndex = mm2.index + mm2[0].length - mm2[4].length; // let the trailing label start the next token
    if (!label) continue;
    var val = toMetres(parseFloat(mm2[2]), mm2[3]);
    if (label === '宽' && W2 === null) W2 = val;
    if (label === '高' && H2 === null) H2 = val;
  }
  if (W2 !== null && H2 !== null && W2 > 0.2 && H2 > 0.2) return { w:W2, h:H2, src:'cn-wh' };

  /* 3) English "10 m wide", "4 m high/tall" */
  var ew = text.match(/(\d+(?:\.\d+)?)\s*(m|meters?|metres?|ft|feet|foot)?\s*(?:wide|width|in width)/);
  var eh = text.match(/(\d+(?:\.\d+)?)\s*(m|meters?|metres?|ft|feet|foot)?\s*(?:high|tall|height|in height)/);
  if (ew && eh) {
    var w3 = toMetres(parseFloat(ew[1]), ew[2]);
    var h3 = toMetres(parseFloat(eh[1]), eh[2]);
    if (w3 > 0.2 && h3 > 0.2) return { w:w3, h:h3, src:'en-wh' };
  }

  /* 4) area: "20 sqm", "20平方", "20 m2" */
  m = text.match(/(\d+(?:\.\d+)?)\s*(?:平方米|平方|平米|平|sqm|sq m|square meters?|square metres?|m2|m²)/);
  if (m) {
    var a = parseFloat(m[1]);
    if (a > 0.5 && a < 5000) {
      var w4 = Math.sqrt(a * 16 / 9), h4 = w4 * 9 / 16;
      return { w:Math.round(w4 * 100) / 100, h:Math.round(h4 * 100) / 100, src:'area', area:a };
    }
  }

  /* 5) diagonal inches: "108 inch", "110寸", "165"" */
  m = text.match(/(\d{2,3})\s*(?:inch|inches|"|”|寸|吋)/);
  if (m) {
    var d = parseFloat(m[1]);
    if (d >= 40 && d <= 400) {
      var diagM = d * 0.0254;
      var w5 = diagM * 16 / Math.sqrt(337), h5 = w5 * 9 / 16;
      return { w:Math.round(w5 * 10000) / 10000, h:Math.round(h5 * 10000) / 10000, src:'diagonal', inch:d };
    }
  }
  return null;
}

/* viewing distance: "3 m away", "视距 5 米", "watch from 4 meters" */
function parseDistance(text) {
  var pats = [
    /(?:视距|观看距离|观看|最近距离|距离屏幕|离屏幕)\s*(?:约|大概|大约)?\s*(\d+(?:\.\d+)?)\s*(米|m|meters?|metres?)?/,
    /(\d+(?:\.\d+)?)\s*(米|m|meters?|metres?)\s*(?:外|远)?\s*(?:观看|看屏|处观看)/,
    /(?:viewing distance|view(?:ed|ing)? from|watch(?:ed|ing)? from|audience(?:s)? (?:at|from)|seated (?:at|from)|stand(?:ing)? (?:at|about)?)\s*(?:about|around|approx\.?|~)?\s*(\d+(?:\.\d+)?)\s*(m|meters?|metres?|ft|feet|foot)?/,
    /(\d+(?:\.\d+)?)\s*(m|meters?|metres?|ft|feet|foot)\s*(?:away|distance|from the screen|viewing)/
  ];
  for (var i = 0; i < pats.length; i++) {
    var m = text.match(pats[i]);
    if (m) {
      var v = parseFloat(m[1]);
      var u = m[2] || 'm';
      var d = /f/.test(u) ? v * 0.3048 : v;
      if (d >= 0.3 && d <= 200) return Math.round(d * 100) / 100;
    }
  }
  return null;
}

function parseQty(text) {
  var m = text.match(/(\d+)\s*(?:套|组|块屏|面屏|sets?|screens?|walls?|units? of)/);
  if (m) { var n = parseInt(m[1], 10); if (n >= 1 && n <= 200) return n; }
  return 1;
}
function parsePosterUnits(text) {
  var m = text.match(/(\d+)\s*(?:台|台拼接|units?|pcs|pieces|panels?)/);
  if (m) { var n = parseInt(m[1], 10); if (n >= 1 && n <= 40) return n; }
  return null;
}

function parseNeed(input) {
  var raw = String(input || '');
  var text = norm(raw);

  /* scene scoring */
  var scores = {}, evidence = {};
  SCENE_RULES.forEach(function (rule) {
    var r = countHits(text, rule.kw);
    if (r.n) {
      scores[rule.id] = (scores[rule.id] || 0) + r.n * rule.w;
      evidence[rule.id] = (evidence[rule.id] || []).concat(r.found);
    }
  });

  var env = null;
  var out = countHits(text, ENV_OUTDOOR_KW), ind = countHits(text, ENV_INDOOR_KW);
  if (out.n > ind.n) env = 'outdoor';
  else if (ind.n > out.n) env = 'indoor';

  var budget = 'standard';
  var lo = countHits(text, BUDGET_LOW_KW), hi = countHits(text, BUDGET_HIGH_KW);
  if (lo.n > hi.n) budget = 'economy';
  else if (hi.n > lo.n) budget = 'premium';

  var size = parseSize(text);
  var dist = parseDistance(text);

  /* pick the best scene */
  var best = null, bestScore = 0, ranked = [];
  Object.keys(scores).forEach(function (k) { ranked.push({ id:k, score:scores[k] }); });
  ranked.sort(function (a, b) { return b.score - a.score; });
  if (ranked.length) { best = ranked[0].id; bestScore = ranked[0].score; }

  /* env can override an ambiguous indoor/outdoor guess */
  if (!best) best = env === 'outdoor' ? 'outdoor_fixed' : 'indoor_fixed';
  if (best === 'outdoor_fixed' && env === 'indoor' && bestScore <= 3) best = 'indoor_fixed';
  if (best === 'indoor_fixed' && env === 'outdoor' && bestScore <= 3) best = 'outdoor_fixed';

  var conn = null;
  if (countHits(text, HARD_LINK_KW).n > countHits(text, SOFT_LINK_KW).n) conn = 'hard';
  else if (countHits(text, SOFT_LINK_KW).n > 0) conn = 'soft';

  var install = null;
  for (var i = 0; i < INSTALL_KW.length; i++) {
    if (countHits(text, INSTALL_KW[i].kw).n) { install = INSTALL_KW[i].name; break; }
  }

  return {
    raw: raw,
    lang: hasCJK(raw) ? 'cn' : 'en',
    scene: best,
    sceneScore: bestScore,
    sceneRanked: ranked.slice(0, 3),
    evidence: evidence[best] || [],
    env: env,
    budget: budget,
    size: size,
    distance: dist,
    qty: parseQty(text),
    posterUnits: parsePosterUnits(text),
    connHint: conn,
    installHint: install,
    confidence: bestScore >= 6 ? 'high' : bestScore >= 3 ? 'medium' : 'low'
  };
}

/* ============================================================
   3. CATALOGUE HELPERS  (mirror of app.js so keys stay identical)
   ============================================================ */

function typeById(DB, id) {
  for (var i = 0; i < DB.screen_types.length; i++) if (DB.screen_types[i].id === id) return DB.screen_types[i];
  return null;
}
function isPoster(t) { return !!t && t.groups[0] === '__MPS__'; }

function modelsOf(DB, t, opts) {
  opts = opts || {};
  var out = [];
  if (isPoster(t)) {
    DB.mps_poster.items.forEach(function (m, i) {
      out.push({ group:'__MPS__', m:m, key:'__MPS__||' + m.model + '||' + i });
    });
    return out;
  }
  var groups = DB.screen_groups.filter(function (g) { return t.groups.indexOf(g.group) >= 0; });

  if (t.id === 'rental') {
    var kw = opts.connType === 'hard' ? '硬连接' : '软连接';
    groups = groups.filter(function (g) {
      return g.group.indexOf(kw) >= 0 || (opts.connType !== 'hard' && g.group.indexOf('软模') >= 0);
    });
    if (opts.env === 'outdoor') {
      var o = groups.filter(function (g) { return g.group.indexOf('户外') >= 0; });
      if (o.length) groups = o;
    } else {
      var n = groups.filter(function (g) { return g.group.indexOf('室内') >= 0; });
      if (n.length) groups = n;
    }
  }
  if (t.id === 'custom_cabinet' || t.id === 'flexible') {
    var want = opts.env === 'outdoor' ? '户外' : '室内';
    var f = groups.filter(function (g) { return g.group.indexOf(want) >= 0; });
    if (f.length) groups = f;
  }

  groups.forEach(function (g) {
    g.items.forEach(function (m, i) {
      out.push({ group:g.group, g:g, m:m, key:g.group + '||' + m.model + '||' + (m.row !== undefined ? m.row : i) });
    });
  });
  return out;
}

function priceOf(m) { return m.price_std || m.price_alt || m.price_rmb_per_cabinet || 0; }
function sellable(x) { return priceOf(x.m) > 0; }

/* ============================================================
   4. RECOMMENDATION CORE
   ============================================================ */

function targetPitch(need, t) {
  var p;
  if (need.distance) {
    /* rule of thumb: comfortable pitch (mm) ≈ 0.85 × minimum viewing distance (m) */
    p = need.distance * 0.85;
  } else {
    p = DEFAULT_PITCH[need.scene] || 3;
    /* outdoor billboards scale with area — bigger screen, coarser pitch is fine */
    if (need.scene === 'outdoor_fixed' && need.size) {
      var a = need.size.w * need.size.h;
      p = a < 12 ? 3.076 : a < 30 ? 4 : a < 80 ? 5 : 8;
    }
  }
  if (need.budget === 'economy') p *= 1.35;
  if (need.budget === 'premium') p *= 0.72;
  /* hard floors so we never suggest something absurd */
  if (t && t.env === 'outdoor') p = Math.max(2, p);
  return Math.max(0.78, Math.min(20, p));
}

function pickModel(DB, t, need, opts) {
  var list = modelsOf(DB, t, opts).filter(sellable);
  if (!list.length) return null;

  if (isPoster(t)) {
    /* MPS: only the real pitch items (the "108寸" rows are diagonal-priced units) */
    var p = list.filter(function (x) { return x.m.pitch <= 3; });
    if (p.length) list = p;
    /* de-duplicate by pitch, keep the cheapest of each */
    var byPitch = {};
    p.forEach(function (x) {
      var k = String(x.m.pitch);
      if (!byPitch[k] || priceOf(x.m) < priceOf(byPitch[k].m)) byPitch[k] = x;
    });
    list = Object.keys(byPitch).map(function (k) { return byPitch[k]; });
  }

  var tp = targetPitch(need, t);
  list.forEach(function (x) {
    var pitch = x.m.pitch || 1;
    x._d = Math.abs(Math.log(pitch / tp));
    x._price = priceOf(x.m);
  });
  list.sort(function (a, b) { return (a._d - b._d) || (a._price - b._price); });

  return { best:list[0], pool:list, targetPitch:tp };
}

function pickInstall(DB, t, need) {
  var scene = (need.env || t.env) === 'outdoor' ? '户外' : '室内';
  var pool = DB.install.filter(function (x) { return x.scene === scene || x.scene === '仅安装'; });
  var byName = function (n) { for (var i = 0; i < pool.length; i++) if (pool[i].name === n) return pool[i].name; return null; };
  return (need.installHint && byName(need.installHint)) || byName(t.install_default) || (pool[0] && pool[0].name) || t.install_default;
}

/* light-weight geometry + power, mirrors compute() closely enough for a summary */
function specOf(t, sel, W, H, units) {
  var m = sel.m;
  var mod = m.module_size || null;
  var u;
  if (m.cabinet_size) u = { w:m.cabinet_size[0], h:m.cabinet_size[1], kind:'cabinet' };
  else if (t.id === 'rental') u = { w:500, h:500, kind:'cabinet' };
  else if (mod) u = { w:mod[0], h:mod[1], kind:'module' };
  else u = { w:500, h:500, kind:'module' };

  var cols, rows, wMM, hMM;
  if (isPoster(t)) {
    cols = Math.max(1, units || 1); rows = 1;
    wMM = 640 * cols; hMM = 1920;
  } else {
    cols = Math.max(1, Math.round(W * 1000 / u.w));
    rows = Math.max(1, Math.round(H * 1000 / u.h));
    wMM = cols * u.w; hMM = rows * u.h;
  }
  var ph = m.pitch || 1, pv = m.pitch_v || m.pitch || 1;
  var pxW = Math.round(wMM / ph), pxH = Math.round(hMM / pv);
  var area = (wMM / 1000) * (hMM / 1000);
  var maxWsqm = m.max_power_sqm || (t.power && t.power.max_w_sqm) || 500;
  var avgWsqm = (t.power && t.power.avg_w_sqm) || Math.round(maxWsqm * 0.35);

  return {
    W: wMM / 1000, H: hMM / 1000, area: area,
    cols: cols, rows: rows, unitCount: cols * rows, unit: u,
    pxW: pxW, pxH: pxH, totalPx: pxW * pxH,
    maxKW: area * maxWsqm / 1000, avgKW: area * avgWsqm / 1000,
    minViewDist: Math.round((m.pitch || 1) * 10) / 10
  };
}

function bilingual(cn, en) { return { cn:cn, en:en }; }

function recommendLocal(DB, input, options) {
  options = options || {};
  var need = typeof input === 'object' && input && input.raw !== undefined ? input : parseNeed(input);

  var t = typeById(DB, need.scene) || typeById(DB, 'indoor_fixed') || DB.screen_types[0];
  var env = need.env || (t.env === 'both' ? 'indoor' : t.env);

  /* connection type for rental */
  var connType = 'soft';
  if (t.id === 'rental') connType = need.connHint === 'hard' ? 'hard' : 'soft';

  /* size */
  var W, H, units = 1, sizeSrc;
  if (isPoster(t)) {
    units = need.posterUnits || 1;
    W = 0.64 * units; H = 1.92; sizeSrc = need.posterUnits ? 'stated' : 'default';
  } else if (need.size) {
    W = need.size.w; H = need.size.h; sizeSrc = need.size.src;
  } else {
    var d = DEFAULT_SIZE[need.scene] || [4, 2.25];
    W = d[0]; H = d[1]; sizeSrc = 'default';
  }

  var picked = pickModel(DB, t, need, { connType:connType, env:env });
  if (!picked) return { ok:false, error:'no sellable model for type ' + t.id, need:need };
  var sel = picked.best;

  var spec = specOf(t, sel, W, H, units);
  var install = pickInstall(DB, t, need);
  var ctrlBrand = '诺瓦 Novastar';

  /* alternatives: one finer, one coarser */
  var byPitch = picked.pool.slice().sort(function (a, b) { return (a.m.pitch || 0) - (b.m.pitch || 0); });
  var idx = byPitch.indexOf(sel);
  var alts = [];
  [idx - 1, idx + 1].forEach(function (i) {
    var x = byPitch[i];
    if (!x) return;
    var s = specOf(t, x, W, H, units);
    alts.push({
      modelKey: x.key, group: x.group, model: x.m.model, pitch: x.m.pitch,
      pxW: s.pxW, pxH: s.pxH, area: Math.round(s.area * 100) / 100,
      role: (x.m.pitch < sel.m.pitch) ? 'finer' : 'coarser',
      note: bilingual(
        x.m.pitch < sel.m.pitch ? '更细腻，近距离观看更好，单价更高' : '更经济，适合更远的观看距离',
        x.m.pitch < sel.m.pitch ? 'Finer image for closer viewing, higher price per sqm' : 'More economical, suits a longer viewing distance')
    });
  });

  /* reasoning */
  var reasons = [];
  reasons.push(bilingual(
    '场景判定为「' + t.name_cn + '」' + (need.evidence.length ? '（关键词：' + need.evidence.slice(0, 3).join('、') + '）' : '（按默认场景）'),
    'Matched to "' + t.name_en + '"' + (need.evidence.length ? ' (keywords: ' + need.evidence.slice(0, 3).join(', ') + ')' : ' (default scene)')));
  reasons.push(bilingual(
    need.distance
      ? '按视距 ' + need.distance + ' m 推导目标点距 ≈ P' + picked.targetPitch.toFixed(2) + '，选中 ' + sel.m.model
      : '按该场景常规做法取目标点距 ≈ P' + picked.targetPitch.toFixed(2) + '，选中 ' + sel.m.model,
    need.distance
      ? 'Viewing distance ' + need.distance + ' m → target pitch ≈ P' + picked.targetPitch.toFixed(2) + ', selected ' + sel.m.model
      : 'Typical practice for this application → target pitch ≈ P' + picked.targetPitch.toFixed(2) + ', selected ' + sel.m.model));
  reasons.push(bilingual(
    (sizeSrc === 'default' ? '未指明尺寸，采用该场景常用尺寸 ' : '目标尺寸 ') + W.toFixed(2) + '×' + H.toFixed(2) + ' m，按' +
      (spec.unit.kind === 'cabinet' ? '箱体' : '模组') + ' ' + spec.unit.w + '×' + spec.unit.h + 'mm 取整为 ' +
      spec.W.toFixed(3) + '×' + spec.H.toFixed(3) + ' m（' + spec.cols + '×' + spec.rows + '）',
    (sizeSrc === 'default' ? 'No size given, using the common size for this application: ' : 'Target size ') + W.toFixed(2) + ' × ' + H.toFixed(2) + ' m, snapped to whole ' +
      (spec.unit.kind === 'cabinet' ? 'cabinets' : 'modules') + ' of ' + spec.unit.w + '×' + spec.unit.h + 'mm → ' +
      spec.W.toFixed(3) + ' × ' + spec.H.toFixed(3) + ' m (' + spec.cols + ' × ' + spec.rows + ')'));
  if (t.id === 'rental') {
    reasons.push(bilingual(
      connType === 'hard' ? '按无缝/固定优先，采用硬连接箱体，平整度更好' : '按频繁拆装场景，采用软连接箱体，装拆更快、更轻',
      connType === 'hard' ? 'Rigid-link cabinets for the best flatness on a semi-permanent setup' : 'Soft-link cabinets for fast, lightweight setup and teardown'));
  }
  reasons.push(bilingual(
    '控制系统默认诺瓦（Novastar）出口型号，自动按 ' + (spec.totalPx / 1e6).toFixed(2) + 'M 像素匹配收发卡',
    'Novastar export-grade controllers, auto-matched to ' + (spec.totalPx / 1e6).toFixed(2) + 'M pixels'));
  reasons.push(bilingual(
    '安装方式 ' + install + '，包装 ' + (t.packing === 'flight' ? '航空箱' : '木箱') + '（出口标准）',
    'Installation: ' + install + '; packing: ' + (t.packing === 'flight' ? 'flight cases' : 'wooden crates') + ' (export standard)'));

  var questions = [];
  if (!need.size && !isPoster(t)) questions.push(bilingual('屏幕的目标宽 × 高是多少米？', 'What width × height do you need, in metres?'));
  if (!need.distance) questions.push(bilingual('观众最近能站到屏幕前多少米？', 'How close will the closest viewer be?'));
  if (need.confidence === 'low') questions.push(bilingual('这块屏装在室内还是户外？主要用途是什么？', 'Is the screen indoor or outdoor, and what is it mainly used for?'));

  return {
    ok: true,
    version: VERSION,
    source: 'local',
    need: need,
    config: {
      typeId: t.id,
      typeName: { cn:t.name_cn, en:t.name_en },
      env: env,
      targetW: Math.round(W * 1000) / 1000,
      targetH: Math.round(H * 1000) / 1000,
      units: units,
      qty: need.qty || 1,
      modelKey: sel.key,
      group: sel.group,
      model: sel.m.model,
      pitch: sel.m.pitch,
      pitchV: sel.m.pitch_v || sel.m.pitch,
      tier: 'std',
      connType: connType,
      rentalCab: '500x500',
      ctrlMode: 'auto',
      ctrlBrand: ctrlBrand,
      installName: install,
      packing: t.packing || 'wooden',
      use: { cabinet:true, psu:true, powerbox:true, cables:true, install:true, crate:true, spare:true }
    },
    spec: {
      widthM: Math.round(spec.W * 1000) / 1000,
      heightM: Math.round(spec.H * 1000) / 1000,
      areaSqm: Math.round(spec.area * 100) / 100,
      cols: spec.cols, rows: spec.rows, unitCount: spec.unitCount,
      unitKind: spec.unit.kind, unitW: spec.unit.w, unitH: spec.unit.h,
      pxW: spec.pxW, pxH: spec.pxH, totalPx: spec.totalPx,
      maxKW: Math.round(spec.maxKW * 100) / 100,
      avgKW: Math.round(spec.avgKW * 100) / 100,
      brightness: t.brightness_hint,
      refresh: t.refresh_hint,
      minViewDist: spec.minViewDist,
      ipRating: (env === 'outdoor') ? 'IP65 front / IP54 rear' : null
    },
    alternatives: alts,
    reasons: reasons,
    questions: questions
  };
}

/* ============================================================
   5. BACKEND WRAPPER  (local now, AI endpoint later)
   ============================================================ */

function createBackend(cfg) {
  cfg = cfg || {};
  var endpoint = cfg.endpoint || null;      // e.g. 'https://api.ledovix.com/recommend'
  var DB = cfg.catalog || null;
  var timeout = cfg.timeoutMs || 12000;

  function localCall(text) {
    if (!DB) throw new Error('catalog not loaded');
    return recommendLocal(DB, text);
  }

  return {
    version: VERSION,
    get mode() { return endpoint ? 'remote' : 'local'; },
    setEndpoint: function (u) { endpoint = u || null; },
    setCatalog: function (db) { DB = db; },
    parse: function (text) { return parseNeed(text); },
    /* always resolves — remote errors quietly degrade to the local engine */
    recommend: function (text, extra) {
      var fallback = function (why) {
        var r = localCall(text);
        if (why) r.fallbackReason = why;
        return r;
      };
      if (!endpoint || typeof fetch !== 'function') return Promise.resolve(fallback(null));

      var ctrl = (typeof AbortController === 'function') ? new AbortController() : null;
      var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, timeout) : null;

      return fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: String(text || ''), context: extra || null, version: VERSION }),
        signal: ctrl ? ctrl.signal : undefined
      })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (j) {
          if (timer) clearTimeout(timer);
          if (!j || !j.config || !j.config.typeId) throw new Error('bad payload');
          j.source = 'remote';
          return j;
        })
        .catch(function (e) {
          if (timer) clearTimeout(timer);
          return fallback(String(e && e.message || e));
        });
    },
    recommendSync: function (text) { return localCall(text); }
  };
}

return {
  VERSION: VERSION,
  parseNeed: parseNeed,
  recommend: recommendLocal,
  createBackend: createBackend,
  _internals: { parseSize:parseSize, parseDistance:parseDistance, targetPitch:targetPitch, modelsOf:modelsOf, SCENE_RULES:SCENE_RULES }
};

}));

/* ============================================================
 * Welearn Helper · WEB 控制台（服务端版）
 * ------------------------------------------------------------
 * 执行模型：浏览器负责调度，所有跨域请求经 api.php 转发；
 *          每个浏览器独立持有自己的 Cookie，互不影响。
 * 与上游 Python 版对齐的行为：
 *   - 支持按单元 / 按小节选择（小节懒加载）
 *   - 默认只处理“未完成”章节，可关闭以覆盖已有成绩
 *   - 切换模式复用当前会话，无需重新登录
 *   - 任务结束后自动刷新课程与章节状态
 * ============================================================ */
  'use strict';

  var BUILD = 'server';
  var VERSION = '2.4.1';
  var BUILD_ID = '2026.11.19-57';

  /* 给 api.php 也带版本号，避免 CDN / 反向代理返回旧的接口响应 */
  var API_ENDPOINT = 'api.php?v=' + encodeURIComponent(BUILD_ID);

  /* ==========================================================
   * 1. 基础工具
   * ========================================================== */
  function $(id) { return document.getElementById(id); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  function clock() {
    var d = new Date();
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
  }

  /* 秒数 -> 05:12 / 1:05:12 */
  function parseLearnedTime(value) {
    if (typeof value === 'number') return Math.max(0, Math.floor(value));
    var text = String(value == null ? '' : value).trim();
    if (!text) return 0;
    var m = text.match(/^(\d+):(\d+):(\d+)$/);
    if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    m = text.match(/^(\d+):(\d+)$/);
    if (m) return Number(m[1]) * 60 + Number(m[2]);
    var h = text.match(/(\d+)\s*小时/);
    var mi = text.match(/(\d+)\s*分/);
    var se = text.match(/(\d+)\s*秒/);
    if (h || mi || se) {
      return (h ? Number(h[1]) * 3600 : 0) + (mi ? Number(mi[1]) * 60 : 0) + (se ? Number(se[1]) : 0);
    }
    var n = Number(text);
    return isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }

  function fmtDuration(totalSeconds) {
    var s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var sec = s % 60;
    return h > 0 ? h + ':' + pad2(m) + ':' + pad2(sec) : pad2(m) + ':' + pad2(sec);
  }

  function setText(el, value) {
    if (el) el.textContent = value == null ? '' : String(value);
  }

  function hasRet0(text) { return String(text == null ? '' : text).indexOf('"ret":0') !== -1; }

  /* 新版 SCO 接口会在 keepsco / savescoinfo 返回本次实际计入的秒数 */
  function scoJson(text) {
    try { return JSON.parse(String(text)); } catch (e) { return {}; }
  }
  function scoSeconds(text) {
    var obj = scoJson(text);
    var n = Number(obj && obj.seconds);
    return isFinite(n) && n > 0 ? Math.round(n) : 0;
  }

  /* 学校登录回调会返回 http://welearn.sflep.com/...，统一升级到 https，
     与 api.php 的白名单策略保持一致，避免登录链路出现 HTTP 400。 */
  function upgradeUpstreamUrl(url) {
    var text = String(url == null ? '' : url);
    try {
      var parsed = new URL(text, 'https://welearn.sflep.com');
      if (parsed.protocol === 'http:' && /(^|\.)sflep\.com$/i.test(parsed.hostname)) {
        parsed.protocol = 'https:';
        return parsed.href;
      }
      return text;
    } catch (e) {
      return text;
    }
  }

  /* ==========================================================
   * 总时长反向分配
   * ========================================================== */

  /* 支持：3600 / 90m / 1.5h / 90分钟 / 1:30 / 1:30:00 */
  function parseTotalDuration(raw) {
    var s = String(raw == null ? '' : raw).trim().toLowerCase().replace(/\s+/g, '');
    if (!s) throw new Error('请输入需要刷的总时长');
    var m;
    if ((m = s.match(/^(\d+(?:\.\d+)?)h(?:ours?)?$/))) return Math.round(parseFloat(m[1]) * 3600);
    if ((m = s.match(/^(\d+(?:\.\d+)?)m(?:in(?:ute)?s?)?$/))) return Math.round(parseFloat(m[1]) * 60);
    if ((m = s.match(/^(\d+(?:\.\d+)?)(?:分钟|分)$/))) return Math.round(parseFloat(m[1]) * 60);
    if ((m = s.match(/^(\d+(?:\.\d+)?)(?:小时|时)$/))) return Math.round(parseFloat(m[1]) * 3600);
    if (/^\d+:\d+(?::\d+)?$/.test(s)) {
      var parts = s.split(':').map(Number);
      if (parts.length === 2) return parts[0] * 60 + parts[1];
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    if (/^\d+(?:\.\d+)?$/.test(s)) return Math.round(parseFloat(s));
    throw new Error('总时长格式不对，例如 3600、90分钟、1:30:00');
  }

  function parseTotalDurationWithUnit(raw, unit) {
    var text = String(raw == null ? '' : raw).trim();
    if (!text) throw new Error('请输入需要刷的总时长');
    if (/^\d+(?:\.\d+)?$/.test(text)) {
      var n = parseFloat(text);
      var mult = unit === 'min' ? 60 : (unit === 'hour' ? 3600 : 1);
      return Math.round(n * mult);
    }
    return parseTotalDuration(text);
  }

  /* 把总秒数随机分给 count 个可见章节：每章 1–900 秒，合计精确等于 total */
  function allocateDuration(total, count) {
    total = Math.round(Number(total));
    count = Number(count);
    if (!(count > 0)) throw new Error('没有可分配的可见章节，请先选择单元并加载小节');
    if (!(total > 0)) throw new Error('总时长必须大于 0');
    var maxPer = 900;
    if (total < count) throw new Error('总时长太短：至少需要 ' + count + ' 秒');
    if (total > count * maxPer) {
      throw new Error('总时长超过上限：最多 ' + (count * maxPer) + ' 秒（' + fmtDuration(count * maxPer) + '）');
    }

    var minPer = total >= count * 30 ? 30 : 1;
    var arr = [];
    for (var i = 0; i < count; i++) arr.push(minPer);
    var left = total - count * minPer;
    var guard = 0;

    while (left > 0 && guard++ < 100000) {
      var candidates = [];
      for (var k = 0; k < count; k++) {
        if (arr[k] < maxPer) candidates.push(k);
      }
      if (!candidates.length) break;
      var idx = candidates[Math.floor(Math.random() * candidates.length)];
      var take = 1 + Math.floor(Math.random() * Math.min(90, left));
      take = Math.min(take, maxPer - arr[idx], left);
      arr[idx] += take;
      left -= take;
    }

    if (left !== 0) throw new Error('总时长分配失败，请稍后重试');
    return arr;
  }

  /* 参数解析：'85' -> 固定；'70,90' -> 区间 */
  function parseParam(raw, mode, allow100) {
    var text = String(raw == null ? '' : raw).trim();
    if (!text) {
      throw new Error(mode === 'accuracy' ? '请输入正确率，例如 85 或 70,90' : '请输入时长秒数，例如 60 或 30,90');
    }
    var parts = text.split(/[,，]/).map(function (s) { return s.trim(); }).filter(function (s) { return s !== ''; });
    var isAccuracy = mode === 'accuracy';

    if (parts.length === 1) {
      var v = Number(parts[0]);
      if (!isFinite(v) || Math.floor(v) !== v) throw new Error('参数需要是整数');
      if (isAccuracy) {
        if (v < 0 || v > 100) throw new Error('固定正确率需在 0–100 之间');
      } else {
        if (v < 0 || v > 7200) throw new Error('学习时长需在 0–7200 秒之间');
      }
      return { type: 'fixed', value: v, label: String(v) };
    }

    if (parts.length === 2) {
      var a = Number(parts[0]);
      var b = Number(parts[1]);
      if (!isFinite(a) || !isFinite(b) || Math.floor(a) !== a || Math.floor(b) !== b) {
        throw new Error('区间需要是两个整数，例如 70,90');
      }
      if (a > b) throw new Error('区间下限不能大于上限');
      if (isAccuracy) {
        if (a < 0 || b > 100) throw new Error('正确率区间需在 0–100 之间');
      } else {
        if (a < 0 || b > 7200) throw new Error('时长区间需在 0–7200 秒之间');
      }
      return { type: 'range', min: a, max: b, label: a + '–' + b };
    }

    throw new Error('格式不正确：单个数字，或“下限,上限”');
  }

  /* 解析 getscoinfo_v7 返回的 cmi（comment 可能是对象，也可能是 JSON 字符串） */
  function parseCmi(body) {
    var empty = { crate: '', cstatus: 'not_attempted', progress: '0', total_time: '0', session_time: '0' };
    var obj = body;
    if (typeof obj === 'string') {
      try { obj = JSON.parse(obj); } catch (e) { return empty; }
    }
    if (!obj || typeof obj !== 'object') return empty;

    var comment = obj.comment;
    if (typeof comment === 'string') {
      try { comment = JSON.parse(comment); } catch (e) { return empty; }
    }
    if (!comment || typeof comment !== 'object' || !comment.cmi) return empty;

    var cmi = comment.cmi;
    var score = cmi.score || {};
    return {
      crate: score.scaled == null ? '' : String(score.scaled),
      cstatus: cmi.completion_status == null ? 'not_attempted' : String(cmi.completion_status),
      progress: cmi.progress_measure == null ? '0' : String(cmi.progress_measure),
      total_time: cmi.total_time == null ? '0' : String(cmi.total_time),
      session_time: cmi.session_time == null ? '0' : String(cmi.session_time)
    };
  }

  /* 并发闸门 */
  function Semaphore(limit) {
    this.limit = Math.max(1, limit | 0);
    this.active = 0;
    this.queue = [];
  }
  Semaphore.prototype.acquire = function () {
    var self = this;
    return new Promise(function (resolve) {
      if (self.active < self.limit) {
        self.active++;
        resolve();
      } else {
        self.queue.push(resolve);
      }
    });
  };
  Semaphore.prototype.release = function () {
    if (this.queue.length) {
      var next = this.queue.shift();
      next();
    } else {
      this.active = Math.max(0, this.active - 1);
    }
  };

  /* ==========================================================
   * 2. 常量
   * ========================================================== */
  var API = {
    prelogin: 'https://welearn.sflep.com/user/prelogin.aspx?loginret=http://welearn.sflep.com/user/loginredirect.aspx',
    authCourse: 'https://welearn.sflep.com/ajax/authCourse.aspx?action=gmc',
    courseInfo: function (cid) {
      return 'https://welearn.sflep.com/student/course_info.aspx?cid=' + encodeURIComponent(cid);
    },
    studyStat: 'https://welearn.sflep.com/ajax/StudyStat.aspx',
    sco: 'https://welearn.sflep.com/Ajax/SCO.aspx',
    ssoLogin: 'https://sso.sflep.com/idsvr/account/login',
    courseApp: 'https://courseappserver.sflep.com/epapi/api/'
  };

  function coursewareDataUrl(addr) {
    var raw = String(addr || '').split('|')[0].trim();
    var hash = raw.indexOf('#');
    if (hash < 0) return '';
    var base = raw.slice(0, hash);
    var frag = raw.slice(hash + 1).replace(/^\/+/, '');
    if (!frag) return '';
    var dir = base.slice(0, base.lastIndexOf('/') + 1);
    if (base.indexOf('//') === 0) dir = 'https:' + dir;
    var out = dir + 'data/' + frag + '.html';
    // 课程目录里常带空格（New Progressive College English），
    // 直接交给 curl 会报 “Malformed input to a URL function”，这里统一编码。
    try { return new URL(out).href; } catch (e) { return out; }
  }

  function isAssessmentText(unitName, chapterName) {
    var text = String(unitName || '') + ' ' + String(chapterName || '');
    return /(unit\s*test|review|test your|assessment|exam|quiz|CET|考核|测评|单元测试)/i.test(text);
  }

  /* 没有题目的阅读 / 听力 / 视频页：提交原生空 interactions，不伪造分数 */
  function buildNoInteractionData() {
    var base = JSON.parse(SCO_DATA_TEMPLATE.split('[INTERACTIONINFO]')[0]);
    base.cmi.interactions = [];
    base.cmi.score = { scaled: '', raw: '' };
    base.cmi.submit_time = String(Date.now());
    return JSON.stringify(base) + '[INTERACTIONINFO]';
  }

  /* 用真实答案构建 setscoinfo 的 data；answers 为空表示该 SCO 没有题目 */
  function buildScoDataFromAnswers(answers, rate, scoid) {
    answers = Array.isArray(answers) ? answers : [];
    rate = Math.max(0, Math.min(100, Number(rate) || 0));
    var total = answers.length;
    var correctCount = Math.ceil(total * rate / 100);
    var wrong = {};
    while (Object.keys(wrong).length < total - correctCount) {
      wrong[Math.floor(Math.random() * total)] = true;
    }

    var interactions = answers.map(function (answer, i) {
      var item = typeof answer === 'string' ? { text: answer, type: 'fill_in' } : (answer || {});
      var text = String(item.text == null ? item.answer : item.text);
      var isWrong = !!wrong[i];
      var response = text;
      if (isWrong) {
        if (item.type === 'multiple_choice') {
          response = text === 'choice1' ? 'choice2' : 'choice1';
        } else if (item.type === 'true_false') {
          response = text === 'true' ? 'false' : 'true';
        } else {
          response = text + String.fromCharCode(65 + Math.floor(Math.random() * 26));
        }
      }
      return {
        id: 'u' + String(scoid || '').replace(/^ITEM-/, '') + '_' + i,
        type: item.type || 'fill_in',
        weighting: '1',
        learner_response: response,
        result: isWrong ? 'incorrect' : 'correct'
      };
    });

    var base = JSON.parse(SCO_DATA_TEMPLATE.split('[INTERACTIONINFO]')[0]);
    base.cmi.interactions = interactions;
    base.cmi.score = { scaled: String(rate), raw: String(total) };
    base.cmi.submit_time = String(Date.now());

    var info = interactions.map(function (item, i) {
      return i + '[]false[]false[]' + item.learner_response + '[]' + item.result;
    }).join('$$');

    return JSON.stringify(base) + '[INTERACTIONINFO]' + info;
  }

  var SCO_DATA_TEMPLATE = '{"cmi":{"completion_status":"completed","interactions":[],"launch_data":"",' +
    '"progress_measure":"1","score":{"scaled":"{crate}","raw":"100"},' +
    '"session_time":"0","success_status":"unknown","total_time":"0","mode":"normal"},' +
    '"adl":{"data":[]},"cci":{"data":[],"service":{"dictionary":{"headword":"",' +
    '"short_cuts":""},"new_words":[],"notes":[],"writing_marking":[],"record":' +
    '{"files":[]},"play":{"offline_media_id":"9999"}},"retry_count":"0",' +
    '"submit_time":""}}[INTERACTIONINFO]';

  var PRESETS = {
    accuracy: [
      { label: '96', value: '96' },
      { label: '97', value: '97' },
      { label: '98', value: '98' },
      { label: '99', value: '99' },
      { label: '100', value: '100' },
      { label: '94–100', value: '94,100' }
    ],
    time: [
      { label: '480', value: '480' },
      { label: '500', value: '500' },
      { label: '520', value: '520' },
      { label: '480–520', value: '480,520' }
    ]
  };

  var KEY_THEME = 'wl_theme';
  var KEY_SESSION = 'wl_session_v2';
  var KEY_VISIT = 'wl_visit';
  var SESSION_TTL = 7 * 24 * 3600 * 1000;   // 登录状态保留 7 天，失效后自动清除

  /* 一键完成的默认参数 */
  var ONE_CLICK = {
    accuracy: { min: 96, max: 100 },
    time: { minMinutes: 500, maxMinutes: 550 }
  };

  /* ==========================================================
   * 3. 状态
   * ========================================================== */
  var state = {
    mode: 'accuracy',
    loggedIn: false,
    user: '',
    courses: [],
    course: null,
    meta: null,          // { uid, classid, cid }
    units: [],
    sections: {},        // unitNo -> chapter[]
    sectionsLoading: {},
    progress: {},
    progressDone: {},
    catalog: {},
    score: null,
    scoreTimer: null,
    oneClick: null,
    running: false,
    loading: 0,
    runner: null,
    startedAt: 0,
    phaseLabel: '',
    queuing: false,
    queueCancelled: false,
    timePhaseVisible: false,
    debugUnlocked: false,
    loginMethod: '',
    runtimePassword: '',
    authExpired: false,
    sessionKicked: false,
    debugRenewTimer: null,
    credentialsSaved: false,
    debugExpiresAt: 0,
    maintenance: false,
    maintenanceMessage: '',
    maintenanceTimer: null,
    authenticating: false,
    reloading: false,
    debugToken: '',
    stopping: false,
    ticker: null,
    restoring: false
  };

  var ui = {};

  /* ==========================================================
   * 4. 网络（经 api.php 代理）
   * ========================================================== */
  function isAuthExpiredResponse(url, data) {
    if (!data) return false;
    if (state.authenticating || state.reloading) return false;
    if (/sso\.sflep\.com|\/idsvr\/|account\/login|signin-sflep|prelogin\.aspx|loginredirect\.aspx/i.test(String(url))) return false;
    if (Number(data.status) === 401) return true;
    var body = String(data.body || '');
    if (body.length > 5000) body = body.slice(0, 5000);
    if (/prelogin\.aspx|loginredirect\.aspx|loginSSO|请先登录|登录已失效|用户登录/i.test(body)) return true;
    var headers = data.headers || {};
    var loc = headers.location || headers.Location || '';
    if (loc && /login|signin|prelogin/i.test(String(loc))) return true;
    return false;
  }

  var net = {
    cookie: {},

    header: function () {
      return Object.keys(this.cookie).map(function (k) {
        return k + '=' + this.cookie[k];
      }, this).join('; ');
    },

    absorb: function (list) {
      if (!Array.isArray(list)) return;
      for (var i = 0; i < list.length; i++) {
        var pair = String(list[i] || '');
        var idx = pair.indexOf('=');
        if (idx <= 0) continue;
        var key = pair.slice(0, idx).trim();
        var val = pair.slice(idx + 1).trim();
        if (key) this.cookie[key] = val;
      }
    },

    clear: function () { this.cookie = {}; },

    call: async function (url, opts) {
      opts = opts || {};
      url = upgradeUpstreamUrl(url);
      var method = opts.method || 'GET';
      var body = opts.body == null ? '' : String(opts.body);
      var headers = opts.headers || {};
      var timeout = opts.timeout || 65000;

      var sessionAccount = state.user || '';
      var sessionToken = getSessionToken();
      // 登录入口/SSO 回调不能带旧账号 session，否则被踢的浏览器无法重新登录
      if (/sso\.sflep\.com|prelogin\.aspx|loginredirect\.aspx|signin-sflep/i.test(url)) {
        sessionAccount = '';
        sessionToken = '';
      }
      var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, timeout);
      var res;
      try {
        res = await fetch(API_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: url, method: method, body: body, headers: headers, cookie: this.header(), account: sessionAccount, session_token: sessionToken, debug_token: state.debugToken || '' }),
          signal: ctrl ? ctrl.signal : undefined
        });
      } catch (e) {
        throw new Error(e && e.name === 'AbortError'
          ? '请求超时（' + Math.round(timeout / 1000) + ' 秒），请重试'
          : '无法连接代理接口 api.php，请检查部署与网络');
      } finally {
        clearTimeout(timer);
      }

      if (!res.ok) {
        var errData = null;
        try { errData = await res.json(); } catch (e) { errData = null; }
        if (errData && errData.maintenance && typeof handleMaintenance === 'function') {
          handleMaintenance(errData.error || '系统维护中');
        }
        throw new Error(errData && errData.error ? String(errData.error) : '代理接口异常：HTTP ' + res.status);
      }

      var data;
      try { data = await res.json(); } catch (e) { throw new Error('代理接口返回了非 JSON 数据'); }
      if (!data || typeof data !== 'object') throw new Error('代理接口返回为空');
      if (data.maintenance) {
        if (typeof handleMaintenance === 'function') handleMaintenance(data.error || '系统维护中');
        var maintErr = new Error(data.error || '系统维护中');
        maintErr.code = 'MAINTENANCE';
        throw maintErr;
      }
      if (data.error) throw new Error(String(data.error));

      this.absorb(data.newCookies);

      // 刷课期间登录失效：能自动重登就重登后重试本次请求，否则抛出专用错误
      if (!opts._authRetry && !state.reloading && isAuthExpiredResponse(url, data)) {
        var recovered = false;
        try {
          if (typeof tryAutoRelogin === 'function') recovered = await tryAutoRelogin();
        } catch (e) { recovered = false; }
        if (recovered) {
          return this.call(url, Object.assign({}, opts, { _authRetry: true }));
        }
        if (typeof handleAuthExpired === 'function') handleAuthExpired();
        var authErr = new Error('登录状态已失效');
        authErr.code = 'AUTH_EXPIRED';
        throw authErr;
      }

      return data;
    }
  };

  async function apiPost(payload) {
    var body = Object.assign({}, payload || {});
    if (state.user) body.account = state.user;
    body.session_token = getSessionToken();
    if (state.debugToken) body.debug_token = state.debugToken;
    var res = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      var data = null;
      try { data = await res.json(); } catch (e) { data = null; }
      if (data && data.maintenance && typeof handleMaintenance === 'function') {
        handleMaintenance(data.error || '系统维护中');
      }
      if (data && data.session_kicked && typeof handleSessionKicked === 'function') {
        handleSessionKicked(data.error || '账号已在其他设备登录');
      }
      var httpErr = new Error(data && data.error ? String(data.error) : 'HTTP ' + res.status);
      httpErr.status = res.status;
      if (data && data.session_kicked) httpErr.sessionKicked = true;
      throw httpErr;
    }
    return res.json();
  }

  function parseCookieString(raw) {
    var out = {};
    String(raw || '').split(';').forEach(function (pair) {
      var idx = pair.indexOf('=');
      if (idx <= 0) return;
      var key = pair.slice(0, idx).trim();
      var val = pair.slice(idx + 1).trim();
      if (key) out[key] = val;
    });
    return out;
  }

  async function postForm(url, fields, headers) {
    var body = new URLSearchParams();
    Object.keys(fields || {}).forEach(function (k) { body.set(k, String(fields[k])); });
    var res = await net.call(url, {
      method: 'POST',
      body: body.toString(),
      headers: Object.assign({ 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' }, headers || {})
    });
    return res.body;
  }

  function postSco(fields, referer) {
    return postForm(API.sco, fields, referer ? { Referer: referer } : {});
  }

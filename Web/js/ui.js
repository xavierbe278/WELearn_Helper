'use strict';

/* ============================================================
 * 界面：日志 / 主题 / 登录 / 渲染 / 弹窗 / 倒计时
 * ============================================================ */

  /* ==========================================================
   * 5. 通知 / 日志 / 状态
   * ========================================================== */
  function toast(message, type, ms) {
    if (!ui.toasts) return;
    type = type || 'info';
    var el = document.createElement('div');
    el.className = 'toast toast--' + type;
    el.setAttribute('role', type === 'err' ? 'alert' : 'status');

    var icon = document.createElement('span');
    icon.className = 'toast__icon';
    icon.textContent = type === 'ok' ? '✓' : (type === 'err' ? '!' : 'i');

    var msg = document.createElement('span');
    msg.className = 'toast__msg';
    msg.textContent = String(message);

    el.appendChild(icon);
    el.appendChild(msg);
    ui.toasts.appendChild(el);

    var ttl = ms || (type === 'err' ? 6000 : 3800);
    setTimeout(function () {
      el.style.opacity = '0';
      el.style.transform = 'translateY(-6px)';
      el.style.transition = 'opacity .18s, transform .18s';
      setTimeout(function () { el.remove(); }, 200);
    }, ttl);
  }

  var MAX_LOG_LINES = 3000;

  function appendLogLine(box, message, level) {
    if (!box) return null;
    var line = document.createElement('div');
    line.className = 'log__line' + (level && level !== 'info' ? ' is-' + level : '');

    var time = document.createElement('span');
    time.className = 'log__t';
    time.textContent = clock();

    var msg = document.createElement('span');
    msg.className = 'log__m';
    msg.textContent = String(message);

    line.appendChild(time);
    line.appendChild(msg);
    box.appendChild(line);
    return line;
  }

  function addLog(message, level) {
    var box = ui.logBox;
    if (!box) return;
    appendLogLine(box, message, level);

    while (box.childElementCount > MAX_LOG_LINES) {
      box.removeChild(box.firstElementChild);
    }
    if (!ui.autoScroll || ui.autoScroll.checked) box.scrollTop = box.scrollHeight;

    updateMobileLog(String(message), level);

    /* 手机端日志面板打开时同步追加，避免用户错过实时进度 */
    if (ui.logModal && !ui.logModal.hidden && ui.logSheet) {
      appendLogLine(ui.logSheet, message, level);
      while (ui.logSheet.childElementCount > MAX_LOG_LINES) {
        ui.logSheet.removeChild(ui.logSheet.firstElementChild);
      }
      ui.logSheet.scrollTop = ui.logSheet.scrollHeight;
      setText(ui.logModalStatus, ui.statusLine ? ui.statusLine.textContent : '');
    }
  }

  function updateMobileLog(message, level) {
    if (!ui.mobileLogLast) return;
    ui.mobileLogLast.textContent = message;
    if (!ui.mobileLog) return;
    if (level === 'err') {
      ui.mobileLog.classList.add('is-error');
      ui.mobileLog.classList.remove('is-live');
    } else if (level === 'ok') {
      ui.mobileLog.classList.remove('is-error');
    }
  }

  var topNoticeTimer = null;

  function showTopNotice(text, tone, sticky) {
    if (!ui.topNoticeWrap) return;
    ui.topNoticeWrap.hidden = false;
    if (ui.topNotice) {
      ui.topNotice.className = 'top-notice is-' + (tone || 'info');
      ui.topNotice.title = text;
    }
    setText(ui.topNoticeText, text);
    if (topNoticeTimer) {
      clearTimeout(topNoticeTimer);
      topNoticeTimer = null;
    }
    if (!sticky) {
      topNoticeTimer = setTimeout(hideTopNotice, tone === 'error' ? 9000 : 6000);
    }
  }

  function hideTopNotice() {
    if (topNoticeTimer) {
      clearTimeout(topNoticeTimer);
      topNoticeTimer = null;
    }
    if (ui.topNoticeWrap) ui.topNoticeWrap.hidden = true;
  }

  function setStatus(text, tone) {
    setText(ui.statusText, text);
    setText(ui.statusLine, text);
    if (ui.statusPill) {
      ui.statusPill.classList.toggle('is-running', tone === 'run');
      ui.statusPill.classList.toggle('is-error', tone === 'error');
    }
    if (ui.consoleEl) ui.consoleEl.classList.toggle('is-live', tone === 'run');
    if (ui.mobileLogStatus) ui.mobileLogStatus.textContent = String(text);
    if (ui.mobileLog) {
      ui.mobileLog.classList.toggle('is-live', tone === 'run');
      if (tone === 'run') ui.mobileLog.classList.remove('is-error');
      if (tone === 'error') ui.mobileLog.classList.add('is-error');
    }
  }

  function setProgress(done, total) {
    if (!ui.progressFill || !ui.progressText) return;
    var pct = total > 0 ? Math.max(0, Math.min(100, Math.round(done / total * 100))) : 0;
    ui.progressFill.style.width = pct + '%';
    ui.progressText.textContent = total > 0 ? done + '/' + total : '0%';
  }

  /* ==========================================================
   * 6. 主题
   * ========================================================== */
  function readTheme() {
    try {
      var manual = localStorage.getItem('wl_theme_manual') === '1';
      var saved = localStorage.getItem(KEY_THEME);
      if (manual && (saved === 'dark' || saved === 'light')) return saved;
    } catch (e) { /* 隐私模式 */ }
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
    return 'light';
  }

  function applyTheme(theme, persist) {
    var next = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    if (persist) {
      try {
        localStorage.setItem(KEY_THEME, next);
        localStorage.setItem('wl_theme_manual', '1');
      } catch (e) { /* ignore */ }
    }
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', next === 'dark' ? '#070d16' : '#f3f6fa');
    if (ui.themeBtn) {
      ui.themeBtn.setAttribute('aria-label', next === 'dark' ? '切换到浅色' : '切换到深色');
      ui.themeBtn.title = next === 'dark' ? '切换到浅色' : '切换到深色';
    }
  }

  function watchSystemTheme() {
    if (!window.matchMedia) return;
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    function apply(e) {
      var manual = false;
      try { manual = localStorage.getItem('wl_theme_manual') === '1'; } catch (err) { /* ignore */ }
      if (!manual) applyTheme(e.matches ? 'dark' : 'light', false);
    }
    if (mq.addEventListener) mq.addEventListener('change', apply);
    else if (mq.addListener) mq.addListener(apply);
  }

  /* ==========================================================
   * 7. 登录 / 课程 / 单元 / 小节
   * ========================================================== */
  async function loginFlow(user, password) {
    addLog('正在获取登录入口…');

    var pre = await net.call(API.prelogin);
    var locationUrl = pre.headers && pre.headers.location;
    if (!locationUrl) throw new Error('未获取到登录重定向地址，请稍后重试');

    var rturl = '';
    try {
      var parsed = new URL(locationUrl, 'https://welearn.sflep.com');
      var challenge = parsed.searchParams.get('code_challenge') || '';
      var st = parsed.searchParams.get('state') || '';
      rturl = '/connect/authorize/callback?client_id=welearn_web' +
        '&redirect_uri=https%3A%2F%2Fwelearn.sflep.com%2Fsignin-sflep' +
        '&response_type=code&scope=openid%20profile%20email%20phone%20address' +
        '&code_challenge=' + encodeURIComponent(challenge) +
        '&code_challenge_method=S256&state=' + encodeURIComponent(st) +
        '&x-client-SKU=ID_NET472&x-client-ver=6.32.1.0';
    } catch (e) {
      rturl = '/connect/authorize/callback?client_id=welearn_web' +
        '&redirect_uri=https%3A%2F%2Fwelearn.sflep.com%2Fsignin-sflep' +
        '&response_type=code&scope=openid%20profile%20email%20phone%20address';
    }

    for (var attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) {
        addLog('登录服务返回重试信号，' + (attempt + 1) + '/3 次重试…', 'warn');
        await sleep(1200);
      }

      var cipher = generateCipherText(password);
      var payload = new URLSearchParams();
      payload.set('rturl', rturl);
      payload.set('account', user);
      payload.set('pwd', cipher[0]);
      payload.set('ts', String(cipher[1]));

      var loginRes = await net.call(API.ssoLogin, {
        method: 'POST',
        body: payload.toString(),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' }
      });

      var loginData;
      try {
        loginData = JSON.parse(loginRes.body);
      } catch (e) {
        throw new Error('登录响应异常（可能触发风控），请稍后重试');
      }

      if (loginData.code === 1) throw new Error('账号或密码错误');
      if (loginData.code === -1) continue;   // 上游语义：服务端临时拒绝，重试
      if (loginData.code !== 0) throw new Error('登录返回异常：' + (loginData.msg || '未知错误'));
      if (!loginData.data) throw new Error('登录返回数据缺失，请稍后重试');

      addLog('登录成功，正在处理单点登录回调…');
      var nextUrl = 'https://sso.sflep.com/idsvr' + loginData.data;
      for (var hop = 0; hop < 12; hop++) {
        var rd = await net.call(nextUrl);
        var loc = rd.headers && rd.headers.location;
        if ([301, 302, 303, 307, 308].indexOf(Number(rd.status)) !== -1 && loc) {
          nextUrl = new URL(loc, nextUrl).href;
        } else {
          break;
        }
      }
      return;
    }

    throw new Error('登录失败：连续多次被服务端拒绝，可能是设备时间不准或触发风控');
  }

  async function loadCourses() {
    var res = await net.call(API.authCourse, {
      headers: { Referer: 'https://welearn.sflep.com/2019/student/index.aspx' }
    });
    var data;
    try { data = JSON.parse(res.body); } catch (e) { throw new Error('会话可能已失效，请重新登录'); }
    if (!data || !Array.isArray(data.clist)) throw new Error('课程数据格式异常');
    if (!data.clist.length) throw new Error('没有读到课程：可能无课或会话已失效');
    state.courses = data.clist;
    return data.clist;
  }

  async function loadUnits(course) {
    if (ui.detectAssessmentBtn) ui.detectAssessmentBtn.textContent = '检测考核内容';
    var info = await net.call(API.courseInfo(course.cid));
    var text = String(info.body == null ? '' : info.body);

    var uidMatch = text.match(/"uid"\s*:\s*"?(\d{1,20})"?/);
    var classMatch = text.match(/"classid"\s*:\s*"?(\d{1,20})"?/) ||
      text.match(/"classid"\s*:\s*"([A-Za-z0-9_-]*\d[A-Za-z0-9_-]*)"/) ||
      text.match(/classId\s*:\s*"?([A-Za-z0-9_-]*\d[A-Za-z0-9_-]*)"?/i) ||
      text.match(/classid\s*=\s*"?(\d{1,20})"?/i);
    if (!uidMatch || !classMatch) throw new Error('无法解析课程信息，会话可能已过期');

    var uid = uidMatch[1];
    var classid = classMatch[1];
    var emailMatch = text.match(/email\s*:\s*["']([0-9a-fA-F]{16,})["']/i) ||
      text.match(/email\s*=\s*["']([0-9a-fA-F]{16,})["']/i);
    var openId = emailMatch ? emailMatch[1] : '';
    var url = API.studyStat + '?' + new URLSearchParams({
      action: 'courseunits', cid: String(course.cid), uid: uid
    }).toString();

    var res = await net.call(url, {
      headers: { Referer: 'https://welearn.sflep.com/2019/student/course_info.aspx' }
    });
    var data;
    try { data = JSON.parse(res.body); } catch (e) { throw new Error('获取单元列表失败'); }
    if (!data || !Array.isArray(data.info)) throw new Error('该课程没有可用的单元');

    state.meta = { uid: uid, classid: classid, cid: course.cid, openId: openId };
    state.units = data.info;
    state.sections = {};
    state.sectionsLoading = {};
    state.progress = {};
    state.progressDone = {};
    state.oneClick = null;
    state.catalog = {};
    state.score = null;
    if (state.loginMethod === 'account' && state.user && typeof Server !== 'undefined') {
      try {
        var saved = await Server.progressGet(state.user, course.cid);
        state.progress = saved.progress || {};
        state.progressDone = saved.done || {};
        state.oneClick = saved.one_click || null;
        state.score = saved.score || null;
      } catch (e) {
        state.progress = {};
        state.progressDone = {};
        state.oneClick = null;
        state.score = null;
      }
    }
    if (typeof Server !== 'undefined' && openId) {
      await Server.loadCatalog();
      renderScore();
      Server.refreshScore(false);
      Server.startScorePolling();
    } else {
      renderScore();
    }
    return data.info;
  }

  async function fetchSections(unitNo) {
    if (!state.meta || !state.course) throw new Error('课程信息未就绪');
    var url = API.studyStat + '?' + new URLSearchParams({
      action: 'scoLeaves',
      cid: String(state.course.cid),
      uid: String(state.meta.uid),
      unitidx: String(unitNo - 1),
      classid: String(state.meta.classid),
      nocache: String(Date.now())
    }).toString();

    var res = await net.call(url, {
      headers: { Referer: 'https://welearn.sflep.com/2019/student/course_info.aspx?cid=' + state.course.cid }
    });
    var text = String(res.body == null ? '' : res.body);
    if (!text || text.indexOf('异常') !== -1 || text.indexOf('出错了') !== -1) {
      throw new Error('单元不存在或已到末尾');
    }

    var data;
    try { data = JSON.parse(text); } catch (e) { throw new Error('小节数据解析失败'); }
    if (!data || !Array.isArray(data.info)) throw new Error('该单元没有小节');

    return data.info.map(function (ch, i) {
      var complete = String(ch.iscomplete == null ? '未' : ch.iscomplete);
      var rawLearned = ch.learntime != null ? ch.learntime
        : (ch.learnTime != null ? ch.learnTime
        : (ch.studytime != null ? ch.studytime
        : (ch.study_time != null ? ch.study_time : ch.usedtime)));
      var learned = parseLearnedTime(rawLearned);
      var serverLearned = Number((state.progress || {})[ch.id] || 0);
      if (serverLearned > learned) learned = serverLearned;
      var crate = String(ch.crate == null ? '' : ch.crate).trim();
      // 只有服务端返回数字正确率才算“已有答题记录”。
      // learncount 是学习次数，completetime 是完成时间，不能代表有作答；
      // 否则未完成的无题听力/阅读会被误判为“已有答案”而跳过。
      var hasAnswer = /^\d+(\.\d+)?$/.test(crate);
      var visible = String(ch.isvisible == null ? 'true' : ch.isvisible) !== 'false';
      var location = String(ch.location == null ? '未命名小节' : ch.location);
      var unit = state.units[unitNo - 1] || {};
      var unitName = String(unit.unitname || unit.name || '');
      var catalogItem = (state.catalog || {})[ch.id];
      // 最小单元是“小节”（SCO）；名称回退只匹配小节名，不用单元名代替
      var isAssessment = catalogItem
        ? !!catalogItem.isAssessment
        : isAssessmentText('', location);
      if (!visible) isAssessment = false;
      return {
        id: ch.id,
        index: i + 1,
        location: location,
        visible: visible,
        done: complete.indexOf('未') === -1,
        learned: learned,
        learntime: rawLearned || '',
        learncount: ch.learncount || '',
        crate: ch.crate,
        hasAnswer: hasAnswer,
        isAssessment: isAssessment,
        oneClickDone: !!(state.progressDone || {})[ch.id]
      };
    });
  }


  /* ==========================================================
   * 9. 界面渲染
   * ========================================================== */
  function renderCourses() {
    var sel = ui.courseSelect;
    if (!sel) return;
    sel.innerHTML = '';

    if (!state.courses.length) {
      sel.appendChild(new Option(state.loggedIn ? '— 没有可用课程 —' : '— 请先登录 —', ''));
      setText(ui.courseSummary, '未加载');
      return;
    }

    state.courses.forEach(function (course) {
      var label = '完成度 ' + (course.per == null ? '?' : course.per) + '% · ' + String(course.name || '未命名课程');
      sel.appendChild(new Option(label, String(course.cid)));
    });

    var current = state.course || state.courses[0];
    if (current) sel.value = String(current.cid);
    setText(ui.courseSummary, '共 ' + state.courses.length + ' 门');
  }

  function renderUnits() {
    var tree = ui.unitTree;
    if (!tree) return;
    tree.innerHTML = '';

    if (!state.loggedIn) {
      tree.appendChild(emptyNode('登录并选择课程后显示单元'));
      return;
    }
    if (!state.course) {
      tree.appendChild(emptyNode('请先选择课程'));
      return;
    }
    if (!state.units.length) {
      tree.appendChild(emptyNode('该课程没有单元，或加载失败'));
      return;
    }

    state.units.forEach(function (unit, i) {
      var no = i + 1;
      var visible = String(unit.visible == null ? 'true' : unit.visible) !== 'false';

      var row = document.createElement('div');
      row.className = 'unit' + (visible ? '' : ' is-off');

      var label = document.createElement('label');
      label.className = 'unit__row';

      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'unit-cb';
      cb.setAttribute('data-unit', String(no));
      cb.addEventListener('change', function () { onUnitToggle(no, this); });

      var noEl = document.createElement('span');
      noEl.className = 'unit__no';
      noEl.textContent = 'NO.' + no;

      var nameEl = document.createElement('span');
      nameEl.className = 'unit__name';
      var name = (String(unit.unitname || '') + ' ' + String(unit.name || '')).trim();
      nameEl.textContent = name || ('单元 ' + no);

      label.appendChild(cb);
      label.appendChild(noEl);
      if (!visible) label.appendChild(tagNode('未开放', 'off'));
      label.appendChild(nameEl);

      var box = document.createElement('div');
      box.className = 'unit__secs';
      box.setAttribute('data-unit', String(no));

      row.appendChild(label);
      row.appendChild(box);
      tree.appendChild(row);
    });

    syncTreeLocks();
  }

  function emptyNode(text) {
    var div = document.createElement('div');
    div.className = 'tree__empty';
    div.textContent = text;
    return div;
  }

  function tagNode(text, kind) {
    var span = document.createElement('span');
    span.className = 'tag tag--' + kind;
    span.textContent = text;
    return span;
  }

  function renderSections(unitNo, chapters) {
    var box = ui.unitTree ? ui.unitTree.querySelector('.unit__secs[data-unit="' + unitNo + '"]') : null;
    if (!box) return;
    box.innerHTML = '';

    if (!chapters || !chapters.length) {
      var hint = document.createElement('div');
      hint.className = 'tree__hint';
      hint.textContent = '该单元没有小节数据';
      box.appendChild(hint);
      return;
    }

    chapters.forEach(function (ch) {
      var row = document.createElement('label');
      row.className = 'sec' + (ch.visible ? '' : ' is-off');

      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'sec-cb';
      cb.setAttribute('data-unit', String(unitNo));
      cb.setAttribute('data-sec', String(ch.index));
      if (!ch.visible) {
        cb.setAttribute('data-off', '1');
        cb.disabled = true;
      } else if (state.running || ui.allUnits.checked) {
        cb.disabled = true;
      }
      cb.addEventListener('change', function () {
        updateTarget();
        scheduleSave();
      });

      var no = document.createElement('span');
      no.className = 'sec__no';
      no.textContent = ch.index + '.';

      var name = document.createElement('span');
      name.className = 'sec__name';
      name.textContent = ch.location;

      row.appendChild(cb);
      row.appendChild(no);

      var tagBox = document.createElement('span');
      tagBox.className = 'sec__tags';
      tagBox.appendChild(tagNode(
        !ch.visible ? '未开放' : (ch.done ? '已完成' : '未完成'),
        !ch.visible ? 'off' : (ch.done ? 'done' : 'todo')
      ));
      if (ch.learned > 0) {
        tagBox.appendChild(tagNode('已学 ' + fmtDuration(ch.learned), 'done'));
      }
      if (ch.hasAnswer) {
        tagBox.appendChild(tagNode('已有答案' + (ch.crate ? ' ' + ch.crate + '%' : ''), 'done'));
      }
      row.appendChild(tagBox);
      row.appendChild(name);
      box.appendChild(row);
    });
  }

  async function ensureSections(unitNo) {
    if (state.sections[unitNo]) {
      renderSections(unitNo, state.sections[unitNo]);
      return state.sections[unitNo];
    }
    if (state.sectionsLoading[unitNo]) return state.sectionsLoading[unitNo];

    var box = ui.unitTree.querySelector('.unit__secs[data-unit="' + unitNo + '"]');
    if (box) {
      box.innerHTML = '';
      var loading = document.createElement('div');
      loading.className = 'tree__hint';
      loading.textContent = '小节加载中…';
      box.appendChild(loading);
    }

    var promise = fetchSections(unitNo).then(function (chapters) {
      state.sections[unitNo] = chapters;
      renderSections(unitNo, chapters);
      return chapters;
    }).catch(function (err) {
      if (box) {
        box.innerHTML = '';
        var fail = document.createElement('div');
        fail.className = 'tree__hint';
        fail.textContent = '小节加载失败：' + err.message;
        box.appendChild(fail);
      }
      addLog('单元 ' + unitNo + ' 小节加载失败：' + err.message, 'err');
      throw err;
    }).finally(function () {
      delete state.sectionsLoading[unitNo];
    });

    state.sectionsLoading[unitNo] = promise;
    return promise;
  }

  function onUnitToggle(unitNo, cb) {
    var row = cb.closest ? cb.closest('.unit') : cb.parentNode.parentNode;
    if (row) row.classList.toggle('is-open', cb.checked);
    if (cb.checked) {
      ensureSections(unitNo).catch(function () { /* 已记录日志 */ });
    }
    updateTarget();
    scheduleSave();
  }

  function syncTreeLocks() {
    if (!ui.unitTree) return;
    var busy = state.running || state.loading > 0 || state.queuing ||
      (state.maintenance && !state.debugUnlocked);
    var all = ui.allUnits && ui.allUnits.checked;

    $$('.unit-cb', ui.unitTree).forEach(function (cb) { cb.disabled = busy || all; });
    $$('.sec-cb', ui.unitTree).forEach(function (cb) {
      cb.disabled = busy || all || cb.getAttribute('data-off') === '1';
    });
    ui.unitTree.classList.toggle('is-locked', busy || all);
  }

  function readSelection() {
    var all = !!(ui.allUnits && ui.allUnits.checked);
    var result = { all: all, units: [], sections: {} };
    if (all || !ui.unitTree) return result;

    $$('.unit-cb', ui.unitTree).forEach(function (cb) {
      if (!cb.checked) return;
      var no = Number(cb.getAttribute('data-unit'));
      result.units.push(no);

      var secs = $$('.sec-cb[data-unit="' + no + '"]', ui.unitTree).filter(function (sc) {
        return sc.checked && !sc.disabled;
      }).map(function (sc) { return Number(sc.getAttribute('data-sec')); });

      if (secs.length) result.sections[no] = secs.sort(function (a, b) { return a - b; });
    });

    result.units.sort(function (a, b) { return a - b; });
    return result;
  }

  async function applySelection(selection) {
    if (!selection) return;
    ui.allUnits.checked = !!selection.all;
    syncAllUnits();

    if (selection.all) {
      updateTarget();
      return;
    }

    var wanted = {};
    (selection.units || []).forEach(function (no) { wanted[no] = true; });

    var jobs = [];
    $$('.unit', ui.unitTree).forEach(function (row) {
      var cb = row.querySelector('.unit-cb');
      if (!cb) return;
      var no = Number(cb.getAttribute('data-unit'));
      var check = !!wanted[no];
      cb.checked = check;
      row.classList.toggle('is-open', check);
      if (check) jobs.push(ensureSections(no).catch(function () { return null; }));
    });

    await Promise.all(jobs);

    Object.keys(selection.sections || {}).forEach(function (no) {
      var set = selection.sections[no] || [];
      $$('.sec-cb[data-unit="' + no + '"]', ui.unitTree).forEach(function (cb) {
        cb.checked = set.indexOf(Number(cb.getAttribute('data-sec'))) !== -1;
      });
    });

    syncTreeLocks();
    updateTarget();
  }

  function syncAllUnits() {
    var all = !!(ui.allUnits && ui.allUnits.checked);
    $$('.unit', ui.unitTree).forEach(function (row) {
      var cb = row.querySelector('.unit-cb');
      var open = !all && cb && cb.checked;
      row.classList.toggle('is-open', !!open);
    });
    syncTreeLocks();
    updateTarget();
  }

  function updateTarget() {
    var sel = readSelection();
    var text = '未选择单元';

    if (sel.all) {
      text = '全部单元';
    } else if (sel.units.length) {
      var secCount = 0;
      Object.keys(sel.sections).forEach(function (no) { secCount += sel.sections[no].length; });
      text = sel.units.length + ' 个单元' + (secCount ? ' · ' + secCount + ' 个小节' : '');
    }

    setText(ui.targetText, text);
  }

  function renderPresets() {
    var row = ui.presetRow;
    if (!row) return;
    row.innerHTML = '';
    var label = document.createElement('span');
    label.className = 'presets__label';
    label.textContent = '常用：';
    row.appendChild(label);

    (PRESETS[state.mode === 'mixed' ? 'time' : state.mode] || []).forEach(function (preset) {
      var value = typeof preset === 'string' ? preset : preset.value;
      var text = typeof preset === 'string' ? preset : preset.label;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip';
      btn.textContent = text;
      btn.title = '填入 ' + value;
      btn.addEventListener('click', function () {
        ui.paramInput.value = value;
        if ((state.mode === 'time' || state.mode === 'mixed') && ui.totalUnit) {
          ui.totalUnit.value = 'sec';
        }
        ui.paramInput.focus();
        updateTarget();
        scheduleSave();
      });
      row.appendChild(btn);
    });
  }

  function syncRealAnswerUI() {
    var show = state.mode !== 'time';
    if (ui.realAnswerGroup) ui.realAnswerGroup.hidden = !show;
    if (ui.realAnswerField) ui.realAnswerField.hidden = !show;
    if (ui.realFallbackField) {
      ui.realFallbackField.hidden = !show || !(ui.realAnswer && ui.realAnswer.checked);
    }
  }

  function setMode(mode, silent) {
    if (state.running) return;
    var next = (mode === 'time' || mode === 'mixed') ? mode : 'accuracy';
    var changed = state.mode !== next;
    state.mode = next;

    if (!silent && changed) {
      if (ui.paramInput) ui.paramInput.value = '';
      if (ui.mixedAccuracy) ui.mixedAccuracy.value = '99';
      if (ui.totalMode) ui.totalMode.checked = false;
      if (ui.totalUnit) ui.totalUnit.value = 'sec';
    }

    var modeHints = {
      accuracy: '刷完成度正确率：只提交答案和上报完成度，不刷学习时长。两个都要刷请选「混合刷」，或直接点「一键完成」。',
      time: '刷学习时长：只刷学习时长，不提交正确答案和报告完成度。两个都要刷请选「混合刷」，或直接点「一键完成」。',
      mixed: '混合刷：每个小节先刷学习时长，再提交正确答案并上报完成度；正确率和时长一起刷就选这个。'
    };
    if (ui.modeHint) setText(ui.modeHint, modeHints[next]);

    $$('.seg[data-mode]').forEach(function (btn) {
      var active = btn.getAttribute('data-mode') === next;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });

    if (next === 'accuracy') {
      setText(ui.paramLabel, '正确率（0–100，单个值或区间）');
      if (ui.paramInput) ui.paramInput.placeholder = '例如 96 或 94,100';
    } else if (next === 'mixed') {
      setText(ui.paramLabel, '每小节学习时长（秒，单个值或区间）');
      if (ui.paramInput) ui.paramInput.placeholder = '例如 300 或 300,600';
    } else {
      setText(ui.paramLabel, '每小节学习时长（秒，单个值或区间）');
      if (ui.paramInput) ui.paramInput.placeholder = '例如 480 或 480,520';
    }

    var timeLike = next === 'time' || next === 'mixed';
    if (ui.concurrencyField) ui.concurrencyField.hidden = next !== 'time';
    if (ui.sequentialField) ui.sequentialField.hidden = !timeLike;
    syncRealAnswerUI();
    if (ui.skipAnsweredField) ui.skipAnsweredField.hidden = next === 'time';
    if (ui.skipLearnedField) ui.skipLearnedField.hidden = !timeLike;
    if (ui.skipLearnedMin) ui.skipLearnedMin.hidden = !timeLike;
    if (ui.sequentialTime) ui.sequentialTime.disabled = !state.debugUnlocked;
    if (ui.concurrency) ui.concurrency.disabled = !state.debugUnlocked ||
      ((next === 'time' || next === 'mixed') && !!(ui.sequentialTime && ui.sequentialTime.checked));
    if (ui.waitNote) ui.waitNote.hidden = !timeLike;
    if (ui.skipDoneField) ui.skipDoneField.hidden = next === 'time';
    if (ui.mixedAccuracyField) ui.mixedAccuracyField.hidden = next !== 'mixed';
    if (ui.accuracyHint) ui.accuracyHint.hidden = next === 'time';
    if (typeof syncTotalMode === 'function') syncTotalMode();

    renderPresets();
    updateTarget();

    if (!silent && changed && state.loggedIn) {
      var modeLabel = next === 'time' ? '刷学习时长' : (next === 'mixed' ? '混合刷' : '刷完成度正确率');
      addLog('已切换为' + modeLabel + '模式，输入框已清空，当前会话继续复用，无需重新登录。', 'dim');
    }
    if (changed) saveSession();
  }

  function refreshControls() {
    var busy = state.running || state.loading > 0 || state.queuing;
    var logged = state.loggedIn;
    var credLocked = logged && state.credentialsSaved;

    [ui.username, ui.password, ui.cookieInput, ui.loginBtn, ui.cookieBtn,
      ui.formatCookieBtn, ui.splitCookieBtn, ui.refreshBtn, ui.courseSelect].forEach(function (el) {
      if (el) el.disabled = busy || (credLocked && (el === ui.username || el === ui.password || el === ui.loginBtn));
    });
    if (ui.password) {
      ui.password.placeholder = credLocked ? '已保存密码' : '登录密码';
    }
    if (ui.togglePwd) ui.togglePwd.disabled = busy || credLocked;
    if (ui.saveCredential) {
      ui.saveCredential.disabled = busy || credLocked;
      ui.saveCredential.checked = !!state.credentialsSaved;
    }

    if (ui.paramInput) ui.paramInput.disabled = state.running;
    if (ui.concurrency) {
      ui.concurrency.disabled = state.running || !state.debugUnlocked ||
        (state.mode === 'time' && !!(ui.sequentialTime && ui.sequentialTime.checked));
    }
    if (ui.skipDone) ui.skipDone.disabled = state.running;
    if (ui.skipLearned) ui.skipLearned.disabled = state.running;
    if (ui.skipLearnedMin) ui.skipLearnedMin.disabled = state.running;
    if (ui.skipAnswered) ui.skipAnswered.disabled = state.running;
    if (ui.realFallback) ui.realFallback.disabled = state.running;
    if (ui.sequentialTime) ui.sequentialTime.disabled = !state.debugUnlocked;

    $$('.tab').forEach(function (btn) { btn.disabled = busy; });
    $$('.seg[data-mode]').forEach(function (btn) { btn.disabled = busy; });

    if (ui.allUnits) ui.allUnits.disabled = busy;
    syncTreeLocks();

    if (ui.startBtn) {
      ui.startBtn.disabled = busy || !logged || !state.course;
      ui.startBtn.hidden = state.running;
    }
    if (ui.oneClickBtn) {
      ui.oneClickBtn.disabled = busy || !logged || !state.course;
      ui.oneClickBtn.hidden = state.running;
    }
    if (ui.stopBtn) {
      ui.stopBtn.hidden = !state.running;
      ui.stopBtn.disabled = !state.running;
    }
    if (ui.runTip) ui.runTip.hidden = !state.running;
    if (ui.mobileStopBtn) {
      ui.mobileStopBtn.hidden = !state.running;
      ui.mobileStopBtn.disabled = !state.running;
    }

    if (ui.sessionBadge) ui.sessionBadge.hidden = !logged;
    if (ui.logoutBtn) ui.logoutBtn.hidden = !logged;
    if (ui.viewCookieBtn) ui.viewCookieBtn.hidden = !logged;
  }

  async function withLoading(fn, label) {
    state.loading++;
    if (label) setStatus(label, 'busy');
    refreshControls();
    try {
      return await fn();
    } finally {
      state.loading = Math.max(0, state.loading - 1);
      refreshControls();
      // 业务函数没有改写状态时，恢复一个合理的默认状态，避免状态栏停在“正在…”
      if (label && ui.statusText && ui.statusText.textContent === label) {
        setStatus(state.running ? '任务运行中…' : (state.loggedIn ? '就绪' : '待命'), state.running ? 'run' : 'idle');
      }
    }
  }


  /* ==========================================================
   * 11. 弹窗 / Cookie 工具
   * ========================================================== */
  var lastFocus = null;

  function openModal(id) {
    var modal = $(id);
    if (!modal) return;
    lastFocus = document.activeElement;
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    var focusable = modal.querySelector('button, [href], input, select, textarea');
    if (focusable) setTimeout(function () { focusable.focus(); }, 30);
  }

  function closeModal(id) {
    var modal = $(id);
    if (!modal) return;
    modal.hidden = true;
    if (!document.querySelector('.modal:not([hidden])')) document.body.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
    lastFocus = null;
  }

  /* ---------- 手机端日志：底部常驻条 + 全屏面板 ---------- */
  function openLogSheet() {
    if (!ui.logModal || !ui.logSheet) return;
    ui.logSheet.innerHTML = '';
    $$('.log__line', ui.logBox).slice(-600).forEach(function (line) {
      ui.logSheet.appendChild(line.cloneNode(true));
    });
    setText(ui.logModalStatus, ui.statusLine ? ui.statusLine.textContent : '');
    openModal('logModal');
    try { ui.logSheet.scrollTop = ui.logSheet.scrollHeight; } catch (e) { /* ignore */ }
  }

  function clearLogs() {
    if (ui.logBox) ui.logBox.innerHTML = '';
    if (ui.logSheet) ui.logSheet.innerHTML = '';
    if (ui.mobileLog) ui.mobileLog.classList.remove('is-error');
    setText(ui.mobileLogLast, '日志已清空');
    addLog('日志已清空。', 'dim');
  }

  /* ---------- 表单内联错误：登录失败时直接显示在按钮下方 ---------- */
  function showFormError(message) {
    if (!ui.loginError) return;
    ui.loginError.textContent = String(message || '操作失败');
    ui.loginError.hidden = false;
  }

  function clearFormError() {
    if (!ui.loginError) return;
    ui.loginError.textContent = '';
    ui.loginError.hidden = true;
  }

  /* 手机端登录成功后，把“选择课程”滚到眼前，减少手动滑动 */
  function scrollToCourses() {
    try {
      if (!window.matchMedia || !window.matchMedia('(max-width: 720px)').matches) return;
      var card = ui.courseSelect && ui.courseSelect.closest ? ui.courseSelect.closest('.card') : null;
      if (!card || !card.scrollIntoView) return;
      setTimeout(function () {
        card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 260);
    } catch (e) { /* ignore */ }
  }

  function formatCookieInput() {
    var raw = ui.cookieInput.value.trim();
    if (!raw) { toast('Cookie 输入框为空', 'err'); return; }

    var start = raw.indexOf('{');
    if (start === -1) {
      var pairs = parseCookieString(raw);
      if (!Object.keys(pairs).length) { toast('没有识别出有效的 Cookie', 'err'); return; }
      ui.cookieInput.value = Object.keys(pairs).map(function (k) { return k + '=' + pairs[k]; }).join('; ');
      toast('已格式化为标准 Cookie', 'ok');
      return;
    }

    try {
      var obj = JSON.parse(raw.slice(start));
      ui.cookieInput.value = Object.keys(obj).map(function (k) { return k + '=' + obj[k]; }).join('; ');
      addLog('Cookie JSON 已转换为标准格式。', 'dim');
      toast('格式化成功', 'ok');
    } catch (e) {
      toast('JSON 解析失败，请检查内容', 'err');
    }
  }

  /* 登录后查看当前会话 Cookie（只显示、不上传） */
  function viewCookie() {
    var header = net.header();
    if (!header) {
      toast('当前没有可用的 Cookie，请先登录', 'err');
      return;
    }
    if (ui.cookieInput) ui.cookieInput.value = header;
    openCookieModal('当前会话 Cookie');
  }

  function openCookieModal(title) {
    var raw = ui.cookieInput.value.trim();
    if (!raw) { toast('Cookie 输入框为空', 'err'); return; }
    if (ui.cookieTitle) setText(ui.cookieTitle, title || 'Cookie 解析');

    if (raw.charAt(0) === '{') {
      try {
        var obj = JSON.parse(raw.slice(raw.indexOf('{')));
        raw = Object.keys(obj).map(function (k) { return k + '=' + obj[k]; }).join('; ');
      } catch (e) { /* ignore */ }
    }

    var pairs = raw.split(';').map(function (s) { return s.trim(); }).filter(Boolean);
    ui.cookieList.innerHTML = '';

    pairs.forEach(function (pair) {
      var idx = pair.indexOf('=');
      if (idx <= 0) return;
      var key = pair.slice(0, idx).trim();
      var val = pair.slice(idx + 1).trim();

      var row = document.createElement('div');
      row.className = 'cookie-row';

      var keyEl = document.createElement('div');
      keyEl.className = 'cookie-row__key';
      keyEl.textContent = key;

      var bar = document.createElement('div');
      bar.className = 'cookie-row__bar';

      var input = document.createElement('input');
      input.type = 'text';
      input.value = val;
      input.readOnly = true;

      var copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'copy-btn';
      copy.textContent = '复制';
      copy.addEventListener('click', function () {
        var done = function () {
          copy.textContent = '已复制';
          setTimeout(function () { copy.textContent = '复制'; }, 1400);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(val).then(done).catch(function () { toast('复制失败', 'err'); });
        } else {
          input.select();
          try { document.execCommand('copy'); done(); } catch (e) { toast('复制失败', 'err'); }
        }
      });

      bar.appendChild(input);
      bar.appendChild(copy);
      row.appendChild(keyEl);
      row.appendChild(bar);
      ui.cookieList.appendChild(row);
    });

    if (!ui.cookieList.childElementCount) {
      var empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = '没有解析出有效的键值对。';
      ui.cookieList.appendChild(empty);
    }

    openModal('cookieModal');
  }

  function exportLog() {
    var lines = $$('.log__line', ui.logBox).map(function (line) { return line.textContent; });
    if (!lines.length) { toast('当前没有日志', 'err'); return; }
    var blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = 'welearn_log_' + new Date().toISOString().replace(/[:.]/g, '-') + '.txt';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    addLog('日志已导出。', 'dim');
  }

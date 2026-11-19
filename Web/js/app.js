'use strict';

/* ============================================================
 * 业务流程 / 服务端能力 / 事件绑定 / 启动
 * ============================================================ */

  /* ==========================================================
   * 10. 业务流程
   * ========================================================== */
  var saveTimer = null;

  function saveSession() {
    if (!state.loggedIn || state.restoring) return;
    try {
      localStorage.setItem(KEY_SESSION, JSON.stringify({
        cookie: net.header(),
        user: state.user,
        cid: state.course ? state.course.cid : null,
        mode: state.mode,
        method: state.loginMethod,
        param: ui.paramInput ? ui.paramInput.value : '',
        totalMode: !!(ui.totalMode && ui.totalMode.checked),
        totalUnit: ui.totalUnit ? ui.totalUnit.value : 'sec',
        saveCredential: !!state.credentialsSaved,
        selection: readSelection(),
        at: Date.now()
      }));
    } catch (e) { /* 隐私模式或空间不足时忽略 */ }
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      saveTimer = null;
      saveSession();
    }, 500);
  }

  function clearSessionStorage() {
    try { localStorage.removeItem(KEY_SESSION); } catch (e) { /* ignore */ }
    try { sessionStorage.removeItem(KEY_SESSION); } catch (e) { /* ignore */ }
    try { sessionStorage.removeItem('wl_session'); } catch (e) { /* ignore */ }
  }

  function readSavedSession() {
    var raw = null;
    try { raw = localStorage.getItem(KEY_SESSION); } catch (e) { raw = null; }

    // 兼容旧版 sessionStorage 会话，首次访问时迁移到 localStorage
    if (!raw) {
      try { raw = sessionStorage.getItem('wl_session') || sessionStorage.getItem(KEY_SESSION); } catch (e) { raw = null; }
      if (raw) {
        try { localStorage.setItem(KEY_SESSION, raw); } catch (e) { /* ignore */ }
      }
    }
    if (!raw) return null;

    var data = null;
    try { data = JSON.parse(raw); } catch (e) { data = null; }
    return data && typeof data === 'object' ? data : null;
  }

  function readSavedCredentialFlag() {
    try { return localStorage.getItem('wl_saved_cred') === '1'; } catch (e) { return false; }
  }

  function setCredentialSaved(saved) {
    state.credentialsSaved = !!saved;
    if (ui.saveCredential) ui.saveCredential.checked = !!saved;
    try {
      if (saved) localStorage.setItem('wl_saved_cred', '1');
      else localStorage.removeItem('wl_saved_cred');
    } catch (e) { /* ignore */ }
    refreshControls();
  }

  async function restoreSession() {
    var saved = readSavedSession();
    if (!saved || !saved.cookie) return;

    // 会话保留 7 天；超时或 Cookie 已失效时自动清除
    if (!saved.at || Date.now() - saved.at > SESSION_TTL) {
      clearSessionStorage();
      addLog('上次的登录状态已超过 7 天，已自动清除，请重新登录。', 'warn');
      return;
    }

    var cookies = parseCookieString(saved.cookie);
    if (!Object.keys(cookies).length) {
      clearSessionStorage();
      return;
    }

    state.restoring = true;
    net.cookie = cookies;
    state.user = saved.user || '';
    state.loginMethod = saved.method || (saved.user ? 'account' : 'cookie');
    state.loggedIn = true;
    ui.cookieInput.value = saved.cookie;
    if (state.user) ui.username.value = state.user;
    state.credentialsSaved = !!saved.saveCredential || readSavedCredentialFlag();
    if (ui.saveCredential) ui.saveCredential.checked = state.credentialsSaved;
    if (saved.param && ui.paramInput) ui.paramInput.value = saved.param;
    if (ui.totalMode) ui.totalMode.checked = !!saved.totalMode;
    if (ui.totalUnit) ui.totalUnit.value = saved.totalUnit || 'sec';
    setMode(saved.mode === 'time' ? 'time' : (saved.mode === 'mixed' ? 'mixed' : 'accuracy'), true);

    addLog('检测到上次保存的登录状态，正在恢复…', 'dim');
    showTopNotice('正在恢复登录状态…', 'info', true);
    try {
      await withLoading(async function () {
        await loadCourses();
        renderCourses();

        var course = null;
        for (var i = 0; i < state.courses.length; i++) {
          if (String(state.courses[i].cid) === String(saved.cid)) { course = state.courses[i]; break; }
        }
        if (!course) course = state.courses[0];

        if (course) {
          await selectCourse(course, true);
          if (saved.selection) await applySelection(saved.selection);
        }
      }, '正在恢复会话…');

      state.restoring = false;
      saveSession();
      setStatus('就绪');
      addLog('已恢复登录状态与上次的单元选择（Cookie 最多保留 ' +
        Math.round(SESSION_TTL / 86400000) + ' 天，失效后会自动清除）。', 'ok');
      showTopNotice('登录状态已恢复 · 课程已加载', 'success');
    } catch (e) {
      state.restoring = false;
      state.loggedIn = false;
      state.user = '';
      state.courses = [];
      state.course = null;
      state.units = [];
      state.sections = {};
      net.clear();
      clearSessionStorage();
      if (ui.cookieInput) ui.cookieInput.value = '';
      renderCourses();
      renderUnits();
      setStatus('待命');
      addLog('本地登录信息已过期：' + e.message, 'warn');
      showTopNotice('本地登录信息已过期，请重新登录', 'error');
    } finally {
      state.restoring = false;
      refreshControls();
    }
  }

  function showOneClickResume(oc) {
    var total = Math.max(1, Number(oc && oc.total) || 0);
    var credited = Math.max(0, Math.min(total, Number(oc && oc.credited) || 0));
    var remaining = Math.max(0, total - credited);
    if (ui.resumeSub) {
      setText(ui.resumeSub,
        '上次总时长 ' + fmtDuration(total) + '，已完成 ' + fmtDuration(credited) +
        '，剩余 ' + fmtDuration(remaining) + '。要继续上次剩余，还是重新开始？' +
        '重新开始会重新生成总时长并重新安排小节；已有答题记录仍按当前“跳过”设置处理。');
    }
    openModal('resumeModal');
  }

  function showKickModal(message) {
    var sub = document.getElementById('kickSub');
    if (sub) {
      var extra = message && String(message).indexOf('账号已在') === -1
        ? '（' + String(message) + '）' : '';
      setText(sub,
        '你的账号刚刚在另一个浏览器或设备登录，当前页面已被踢下线。' +
        '只有最新登录的浏览器可以继续使用。如果不是你本人操作，请立即修改 WeLearn 密码。' + extra);
    }
    if (typeof openModal === 'function') openModal('kickModal');
  }

  function handleSessionKicked(message) {
    if (state.sessionKicked) return;
    state.sessionKicked = true;
    if (state.runner) state.runner.stop();
    Server.releaseSlot();
    state.loggedIn = false;
    state.user = '';
    state.loginMethod = '';
    state.runtimePassword = '';
    state.course = null;
    state.meta = null;
    state.units = [];
    state.sections = {};
    state.sectionsLoading = {};
    state.catalog = {};
    state.score = null;
    clearSessionStorage();
    setCredentialSaved(false);
    stopRuntimeTicker();
    Server.stopScorePolling();
    hideCountdown();
    renderCourses();
    renderUnits();
    renderScore();
    refreshControls();
    setStatus('已被踢下线', 'error');
    showTopNotice('账号已在其他浏览器/设备登录，本页面已退出', 'error');
    showKickModal(message);
    addLog('账号已在其他浏览器/设备登录，本页面已退出。', 'warn');
    toast(message || '账号已在其他浏览器登录', 'err');
  }

  async function afterLogin() {
    state.loggedIn = true;
    if (ui.sessionBadge) ui.sessionBadge.hidden = false;
    if (ui.logoutBtn) ui.logoutBtn.hidden = false;
    refreshControls();

    await loadCourses();
    renderCourses();

    var course = state.courses[0];
    if (course) await selectCourse(course);

    saveSession();
    setStatus('就绪');
    addLog('Cookie 已保存，可点击登录卡片右上角的「Cookie」查看。', 'dim');
  }

  async function doAccountLogin() {
    if (state.running || state.loading) return;
    if (state.maintenance && !state.debugUnlocked) {
      toast('系统维护中，仅管理员可用', 'err');
      openDebugModal();
      return;
    }
    var user = ui.username.value.trim();
    var password = ui.password.value;
    if (!user || !password) {
      showFormError('请输入账号和密码');
      toast('请输入账号和密码', 'err');
      showTopNotice('登录失败 · 请输入账号和密码', 'error');
      return;
    }

    clearFormError();
    net.clear();
    state.sessionKicked = false;
    state.user = user;
    state.authenticating = true;
    showTopNotice('正在登录…', 'info', true);

    await withLoading(async function () {
      try {
        await loginFlow(user, password);
        ui.cookieInput.value = net.header();
        addLog('登录成功，会话已建立。', 'ok');
        state.loginMethod = 'account';
        setCredentialSaved(!!(ui.saveCredential && ui.saveCredential.checked));
        await Server.onLogin(user, {
          password: (ui.saveCredential && ui.saveCredential.checked) ? password : '',
          save_password: !!(ui.saveCredential && ui.saveCredential.checked),
          device_token: getDeviceToken(),
          method: 'account',
          rotate: true
        });
        await afterLogin();
        clearFormError();
        state.runtimePassword = password;
        toast('登录成功', 'ok');
        showTopNotice('登录成功 · 已获取 ' + state.courses.length + ' 门课程', 'success');
        scrollToCourses();
      } catch (e) {
        state.loggedIn = false;
        state.user = '';
        state.courses = [];
        state.course = null;
        state.units = [];
        state.sections = {};
        clearSessionStorage();
        renderCourses();
        renderUnits();
        setStatus('登录失败', 'error');
        addLog('登录失败：' + e.message, 'err');
        showFormError('登录失败：' + e.message);
        toast('登录失败：' + e.message, 'err');
        showTopNotice('登录失败 · ' + e.message, 'error');
      }
    }, '正在登录…');
    state.authenticating = false;
  }

  async function doCookieLogin() {
    if (state.running || state.loading) return;
    if (state.maintenance && !state.debugUnlocked) {
      toast('系统维护中，仅管理员可用', 'err');
      openDebugModal();
      return;
    }
    var raw = ui.cookieInput.value.trim();
    if (!raw) { showFormError('请先粘贴 Cookie'); toast('请先粘贴 Cookie', 'err'); showTopNotice('登录失败 · 请先粘贴 Cookie', 'error'); return; }

    // 允许直接粘贴 JSON
    if (raw.charAt(0) === '{') {
      try {
        var obj = JSON.parse(raw.slice(raw.indexOf('{')));
        raw = Object.keys(obj).map(function (k) { return k + '=' + obj[k]; }).join('; ');
      } catch (e) { /* 保持原样 */ }
    }

    var cookies = parseCookieString(raw);
    if (!Object.keys(cookies).length) {
      showFormError('Cookie 格式无法识别');
      toast('Cookie 格式无法识别', 'err');
      showTopNotice('登录失败 · Cookie 格式无法识别', 'error');
      return;
    }

    clearFormError();
    net.cookie = cookies;
    state.user = '';   // Cookie 登录不绑定账号，避免沿用上一次登录的用户名
    ui.cookieInput.value = raw;
    state.authenticating = true;
    showTopNotice('正在校验 Cookie…', 'info', true);

    await withLoading(async function () {
      try {
        await loadCourses();
        state.loggedIn = true;
        addLog('Cookie 校验通过，已获取课程列表。', 'ok');
        renderCourses();
        if (state.courses[0]) await selectCourse(state.courses[0]);
        saveSession();
        setStatus('就绪');
        clearFormError();
        state.sessionKicked = false;
    state.loginMethod = 'cookie';
        state.runtimePassword = '';
        Server.onLogin('', { method: 'cookie' });
        toast('Cookie 注入成功', 'ok');
        showTopNotice('登录成功 · Cookie 有效', 'success');
        scrollToCourses();
      } catch (e) {
        state.loggedIn = false;
        state.user = '';
        state.courses = [];
        state.course = null;
        state.units = [];
        state.sections = {};
        net.clear();
        clearSessionStorage();
        renderCourses();
        renderUnits();
        setStatus('Cookie 无效', 'error');
        addLog('Cookie 校验失败：' + e.message, 'err');
        showFormError('Cookie 校验失败：' + e.message);
        toast('Cookie 校验失败：' + e.message, 'err');
        showTopNotice('登录失败 · Cookie 无效：' + e.message, 'error');
      }
    }, '正在校验 Cookie…');
    state.authenticating = false;
  }

  async function selectCourse(course, quiet) {
    if (!course) return;
    state.course = course;
    state.meta = null;
    state.units = [];
    state.sections = {};
    state.sectionsLoading = {};
    if (ui.courseSelect) ui.courseSelect.value = String(course.cid);
    renderUnits();
    updateTarget();
    refreshControls();

    try {
      await withLoading(async function () {
        await loadUnits(course);
        renderUnits();
      }, '正在加载《' + course.name + '》的单元…');
      if (!quiet) addLog('已加载《' + course.name + '》，共 ' + state.units.length + ' 个单元。', 'ok');
      saveSession();
    } catch (e) {
      addLog('加载单元失败：' + e.message, 'err');
      toast('加载单元失败：' + e.message, 'err');
      renderUnits();
    }
  }

  async function refreshAll(manual) {
    if (!state.loggedIn || state.running || state.loading) return;

    var previous = readSelection();
    var previousCid = state.course ? state.course.cid : null;

    await withLoading(async function () {
      try {
        await loadCourses();
        renderCourses();

        var course = null;
        for (var i = 0; i < state.courses.length; i++) {
          if (String(state.courses[i].cid) === String(previousCid)) { course = state.courses[i]; break; }
        }
        if (!course) course = state.courses[0];

        state.course = course;
        state.meta = null;
        state.units = [];
        state.sections = {};
        state.sectionsLoading = {};
        if (course) ui.courseSelect.value = String(course.cid);

        if (course) {
          await loadUnits(course);
          renderUnits();
          await applySelection(previous);
        } else {
          renderUnits();
        }

        if (manual) {
          addLog('课程与单元状态已刷新。', 'dim');
          toast('已刷新', 'ok');
        }
      } catch (e) {
        addLog('刷新失败：' + e.message, 'err');
        if (manual) toast('刷新失败：' + e.message, 'err');
      }
    }, '正在刷新课程…');
  }

  function logout() {
    if (state.running) { toast('任务运行中，请先停止', 'err'); return; }
    if (state.queuing) {
      state.queueCancelled = true;
      Server.releaseSlot();
    }
    net.clear();
    state.loggedIn = false;
    state.user = '';
    state.loginMethod = '';
    state.runtimePassword = '';
    state.authExpired = false;
    state.courses = [];
    state.course = null;
    state.meta = null;
    state.units = [];
    state.sections = {};
    state.sectionsLoading = {};
    clearSessionStorage();
    setCredentialSaved(false);
    clearFormError();
    Server.stopScorePolling();
    state.score = null;
    state.catalog = {};
    renderScore();
    stopRuntimeTicker();

    ui.cookieInput.value = '';
    ui.password.value = '';
    renderCourses();
    renderUnits();
    updateTarget();
    setProgress(0, 0);
    setText(ui.etaText, '');
    setStatus('待命');
    refreshControls();
    addLog('已退出登录。', 'dim');
    showTopNotice('已退出登录', 'info');
  }

  function stopDebugRenewTimer() {
    if (state.debugRenewTimer) {
      clearInterval(state.debugRenewTimer);
      state.debugRenewTimer = null;
    }
  }

  async function renewDebugToken() {
    if (!state.debugUnlocked || !state.debugToken) return;
    try {
      var data = await apiPost({ action: 'debug_renew', token: state.debugToken });
      if (!data || data.status !== 'success') throw new Error('续期失败');
      var ttl = Number(data.expires_in) || 7200;
      state.debugExpiresAt = Date.now() + ttl * 1000;
      try {
        sessionStorage.setItem('wl_debug_exp', String(state.debugExpiresAt));
      } catch (e) { /* ignore */ }
    } catch (e) {
      if (e && (e.status === 401 || e.status === 403 || /过期|失效|维护/.test(e.message || ''))) {
        setDebugLocked(true);
      }
    }
  }

  function startDebugRenewTimer() {
    stopDebugRenewTimer();
    if (!state.debugUnlocked || !state.debugToken) return;
    // 每 10 分钟给服务端续期；浏览器关闭后没有请求，token 自然过期。
    state.debugRenewTimer = setInterval(renewDebugToken, 10 * 60 * 1000);
    if (state.debugRenewTimer && typeof state.debugRenewTimer.unref === 'function') {
      state.debugRenewTimer.unref();
    }
  }

  function setDebugLocked(locked) {
    state.debugUnlocked = !locked;
    if (locked) stopDebugRenewTimer();
    else startDebugRenewTimer();
    if (ui.debugLock) ui.debugLock.classList.toggle('is-unlocked', !locked);
    if (ui.debugStatus) {
      setText(ui.debugStatus, locked
        ? '🔒 并发 / 顺序设置已锁定'
        : '🔓 已解锁：可调整并发 / 顺序（本次会话）');
    }
    if (ui.debugUnlockBtn) ui.debugUnlockBtn.hidden = !locked;
    if (ui.sequentialTime) {
      ui.sequentialTime.disabled = locked;
      if (locked) ui.sequentialTime.checked = true;
    }
    if (ui.concurrency) {
      if (locked) ui.concurrency.value = '1';
      ui.concurrency.disabled = locked ||
        (state.mode === 'time' && !!(ui.sequentialTime && ui.sequentialTime.checked));
    }
    if (typeof renderMaintenance === 'function') renderMaintenance();
  }

  function openDebugModal() {
    if (ui.debugError) ui.debugError.hidden = true;
    if (ui.debugPassword) ui.debugPassword.value = '';
    openModal('debugModal');
    if (ui.debugPassword) setTimeout(function () { ui.debugPassword.focus(); }, 50);
  }

  async function submitDebugUnlock() {
    var password = ui.debugPassword ? ui.debugPassword.value : '';
    if (!password) {
      if (ui.debugError) { setText(ui.debugError, '请输入管理员密码'); ui.debugError.hidden = false; }
      return;
    }
    if (ui.debugSubmitBtn) ui.debugSubmitBtn.disabled = true;
    try {
      var data = await apiPost({ action: 'debug_unlock', password: password });
      if (!data || data.status !== 'success' || !data.token) throw new Error('解锁失败');
      state.debugToken = data.token;
      state.debugExpiresAt = Date.now() + (Number(data.expires_in) || 7200) * 1000;
      try {
        sessionStorage.setItem('wl_debug_token', data.token);
        sessionStorage.setItem('wl_debug_exp', String(state.debugExpiresAt));
      } catch (e) { /* ignore */ }
      setDebugLocked(false);
      if (ui.debugModal) closeModal('debugModal');
      addLog('🔓 高级设置已解锁：可调整并发 / 顺序（本次会话）。', 'ok');
      toast('已解锁并发设置', 'ok');
    } catch (e) {
      if (ui.debugError) {
        setText(ui.debugError, e.message || '管理员密码错误');
        ui.debugError.hidden = false;
      }
    } finally {
      if (ui.debugSubmitBtn) ui.debugSubmitBtn.disabled = false;
    }
  }

  async function restoreDebugToken() {
    var token = '';
    var exp = 0;
    try {
      token = sessionStorage.getItem('wl_debug_token') || '';
      exp = Number(sessionStorage.getItem('wl_debug_exp') || 0);
    } catch (e) { token = ''; }
    if (!token || !exp || exp < Date.now()) {
      setDebugLocked(true);
      return;
    }
    try {
      var data = await apiPost({ action: 'debug_check', token: token });
      if (data && data.valid) {
        state.debugToken = token;
        state.debugExpiresAt = exp;
        setDebugLocked(false);
      } else {
        setDebugLocked(true);
      }
    } catch (e) {
      setDebugLocked(true);
    }
  }

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && state.debugUnlocked && state.debugToken) renewDebugToken();
  });
  window.addEventListener('pagehide', stopDebugRenewTimer);

  function renderMaintenance() {
    var blocked = state.maintenance && !state.debugUnlocked;
    if (ui.maintenanceBanner) ui.maintenanceBanner.hidden = !state.maintenance;
    if (ui.maintenanceText && state.maintenance) {
      setText(ui.maintenanceText,
        (state.maintenanceMessage || '系统维护中，仅管理员可用，请稍后再试。') +
        (state.debugUnlocked ? '（管理员已解锁）' : ''));
    }
    if (ui.maintenanceUnlockBtn) {
      ui.maintenanceUnlockBtn.hidden = !state.maintenance || state.debugUnlocked;
    }
    if (blocked && state.running && state.runner) {
      state.runner.stop();
      addLog('系统进入维护模式，任务已停止。', 'warn');
      setStatus('系统维护中', 'error');
    }
    refreshControls();
  }

  function setMaintenance(data) {
    state.maintenance = !!(data && data.enabled);
    state.maintenanceMessage = (data && data.message) || '';
    renderMaintenance();
  }

  async function checkMaintenance() {
    try {
      var data = await apiPost({ action: 'maintenance_status' });
      if (data && data.enabled && state.debugUnlocked && state.debugToken) {
        try {
          var checked = await apiPost({ action: 'debug_check', token: state.debugToken });
          if (!checked || !checked.valid) setDebugLocked(true);
        } catch (e) { setDebugLocked(true); }
      }
      setMaintenance(data);
    } catch (e) { /* ignore */ }
  }

  function handleMaintenance(message) {
    var was = state.maintenance;
    state.maintenance = true;
    if (message) state.maintenanceMessage = message;
    if (!was) {
      addLog('系统维护中：' + (message || '非管理员禁止使用'), 'warn');
      toast(message || '系统维护中，请稍后再试', 'err');
      if (state.running && state.runner) state.runner.stop();
      setStatus('系统维护中', 'error');
    }
    if (state.debugUnlocked) {
      // 维护接口返回 503 说明当前 token 已失效或不是管理员
      setDebugLocked(true);
    } else {
      renderMaintenance();
    }
  }

  async function detectAssessment() {
    if (state.loading || state.running) {
      toast('当前有任务在运行或加载中，请稍后再检测', 'err');
      return;
    }
    if (!state.loggedIn || !state.course) {
      toast('请先登录并选择课程', 'err');
      return;
    }
    if (!state.units.length) {
      toast('课程单元尚未加载', 'err');
      return;
    }

    var btn = ui.detectAssessmentBtn;
    var oldText = btn ? btn.textContent : '';
    var doneText = '检测考核内容';
    if (btn) { btn.disabled = true; btn.textContent = '检测中…'; }
    setStatus('正在检测考核小节…');

    try {
      if (!state.catalog || !Object.keys(state.catalog).length) {
        await Server.loadCatalog();
      }

      var selection = readSelection();
      if (!selection.all && !selection.units.length) {
        if (ui.allUnits) ui.allUnits.checked = true;
        syncAllUnits();
      }

      for (var i = 0; i < state.units.length; i++) {
        var no = i + 1;
        if (!state.sections[no]) {
          try {
            await ensureSections(no);
          } catch (e) {
            addLog('检测时跳过单元 ' + no + '：' + e.message, 'warn');
          }
        }
      }

      var hits = [];
      state.units.forEach(function (unit, i) {
        var no = i + 1;
        var list = state.sections[no] || [];
        list.forEach(function (ch) {
          if (!ch.visible) return;
          var hit = ch.isAssessment !== false ? !!ch.isAssessment : isAssessmentText('', ch.location);
          if (hit) hits.push(ch.location);
        });
      });

      if (!hits.length) {
        addLog('未检测到考核小节；可能是接口未返回 isAssess，或当前课程全部未开放。', 'warn');
        toast('未检测到考核小节', 'err');
        return;
      }

      ui.assessmentOnly.checked = true;
      addLog('检测到 ' + hits.length + ' 个考核小节：', 'ok');
      hits.slice(0, 15).forEach(function (location) {
        addLog('  · ' + location, 'dim');
      });
      toast('已检测到 ' + hits.length + ' 个考核小节', 'ok');
      updateTarget();
      setStatus('就绪');
    } catch (e) {
      doneText = '检测失败，点击重试';
      addLog('检测考核内容失败：' + e.message, 'err');
      toast('检测失败：' + e.message, 'err');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = doneText; }
    }
  }

  function formatLocalDateTime(date) {
    function p(n) { return n < 10 ? '0' + n : String(n); }
    return date.getFullYear() + '-' + p(date.getMonth() + 1) + '-' + p(date.getDate()) +
      ' ' + p(date.getHours()) + ':' + p(date.getMinutes()) + ':' + p(date.getSeconds());
  }

  function applyOneClickConfig(config) {
    if (!config) return;
    var aMin = Math.max(0, Math.min(100, Number(config.accuracy_min)));
    var aMax = Math.max(0, Math.min(100, Number(config.accuracy_max)));
    if (!isFinite(aMin)) aMin = 96;
    if (!isFinite(aMax)) aMax = 100;
    if (aMin > aMax) { var at = aMin; aMin = aMax; aMax = at; }
    var tMin = Math.max(1, Math.min(1440, Number(config.time_min_minutes)));
    var tMax = Math.max(1, Math.min(1440, Number(config.time_max_minutes)));
    if (!isFinite(tMin)) tMin = 500;
    if (!isFinite(tMax)) tMax = 550;
    if (tMin > tMax) { var tt = tMin; tMin = tMax; tMax = tt; }
    ONE_CLICK.accuracy.min = aMin;
    ONE_CLICK.accuracy.max = aMax;
    ONE_CLICK.time.minMinutes = tMin;
    ONE_CLICK.time.maxMinutes = tMax;
    if (ui.oneClickHint) {
      setText(ui.oneClickHint, '不想逐项设置？可直接点「一键完成」：正确率 ' + aMin + '–' + aMax +
        '%，总时长 ' + tMin + '–' + tMax + ' 分钟，可中断，下次继续剩余小节。注意：时长阶段必须真实等待。');
    }
    if (ui.oneClickBtn) {
      ui.oneClickBtn.title = '无需填写参数：正确率 ' + aMin + '–' + aMax +
        '%，总时长 ' + tMin + '–' + tMax + ' 分钟，可中断续刷';
    }
  }

  function renderScore() {
    if (!ui.scorePanel) return;
    var score = state.score;
    var logged = !!state.loggedIn;
    ui.scorePanel.hidden = false;
    ui.scoreRefreshBtn.disabled = !logged || !state.course;

    if (!logged) {
      ui.scorePanel.classList.add('is-locked');
      setText(ui.scoreHint, '需要登录才能获取成绩');
      setText(ui.scoreTotal, '—');
      setText(ui.scoreListening, '—');
      setText(ui.scoreWriting, '—');
      setText(ui.scoreCorrect, '—');
      setText(ui.scoreTime, '—');
      setText(ui.scoreProgress, '—');
      ui.scoreUpdated.hidden = true;
      return;
    }

    if (!score) {
      ui.scorePanel.classList.add('is-locked');
      var hint = !state.course ? '选择课程后获取成绩'
        : ((!state.meta || !state.meta.openId) ? '当前会话无法获取成绩' : '正在获取成绩…');
      setText(ui.scoreHint, hint);
      setText(ui.scoreTotal, '—');
      setText(ui.scoreListening, '—');
      setText(ui.scoreWriting, '—');
      setText(ui.scoreCorrect, '—');
      setText(ui.scoreTime, '—');
      setText(ui.scoreProgress, '—');
      ui.scoreUpdated.hidden = true;
      return;
    }

    ui.scorePanel.classList.remove('is-locked');
    setText(ui.scoreTotal, score.total == null ? '—' : String(score.total));
    setText(ui.scoreListening, score.listening == null ? '—' : String(score.listening));
    setText(ui.scoreWriting, score.writing == null ? '—' : String(score.writing));
    setText(ui.scoreCorrect, score.correct_rate || '—');
    setText(ui.scoreTime, score.learn_time || '—');
    setText(ui.scoreProgress, score.progress || '—');
    ui.scoreUpdated.hidden = false;
    var updated = score.updated ? String(score.updated) : '';
    if (updated && (/Z$|[+-]\d\d:\d\d$/.test(updated))) {
      var parsed = new Date(updated);
      if (!isNaN(parsed.getTime())) updated = formatLocalDateTime(parsed);
    }
    setText(ui.scoreUpdated, updated
      ? '更新于 ' + updated.replace('T', ' ').slice(0, 19)
      : '等待刷新');
  }

  function countVisibleSelected(selection) {
    var count = 0;
    var assessOnly = !!(ui.assessmentOnly && ui.assessmentOnly.checked);
    function unitName(no) {
      var u = state.units[no - 1] || {};
      return String(u.unitname || u.name || ('单元 ' + no));
    }
    function allow(no, ch) {
      return ch.visible && (!assessOnly || (ch.isAssessment !== false ? !!ch.isAssessment : isAssessmentText('', ch.location)));
    }
    if (selection.all) {
      state.units.forEach(function (_, i) {
        var no = i + 1;
        (state.sections[no] || []).forEach(function (ch) { if (allow(no, ch)) count++; });
      });
      return count;
    }
    selection.units.forEach(function (no) {
      var list = state.sections[no] || [];
      var picked = selection.sections[no];
      list.forEach(function (ch) {
        if (!allow(no, ch)) return;
        if (picked && picked.indexOf(ch.index) === -1) return;
        count++;
      });
    });
    return count;
  }

  function parseTimeWithUnit(raw, unit, unlocked) {
    var param = parseParam(raw, 'time', unlocked);
    var factor = unit === 'min' ? 60 : (unit === 'hour' ? 3600 : 1);
    if (factor === 1 || String(raw).indexOf(':') !== -1) return param;
    if (param.type === 'range') {
      param.min = Math.round(param.min * factor);
      param.max = Math.round(param.max * factor);
      param.label = param.min + '–' + param.max + ' ' + (unit === 'min' ? '分钟' : '小时');
    } else if (param.type === 'value') {
      param.value = Math.round(param.value * factor);
      param.label = param.value + ' 秒';
    }
    return param;
  }

  function syncTotalMode() {
    var time = state.mode === 'time' || state.mode === 'mixed';
    var on = time && !!(ui.totalMode && ui.totalMode.checked);
    if (ui.reverseRow) ui.reverseRow.hidden = !time;
    if (ui.paramField) ui.paramField.hidden = false;
    if (ui.totalUnit) ui.totalUnit.hidden = !time;
    if (ui.presetRow) ui.presetRow.hidden = on;
    if (ui.totalPresets) ui.totalPresets.hidden = !on;
    if (ui.totalHint) {
      ui.totalHint.hidden = !time;
      if (time) {
        setText(ui.totalHint, on
          ? '反向匹配：输入的是总时长，按当前勾选的可见小节分配。'
          : '正向匹配：输入的是每小节时长，单位可选秒 / 分钟 / 小时。');
      }
    }
    if (ui.accuracyHint) ui.accuracyHint.hidden = on || state.mode !== 'accuracy';
    if (on) {
      setText(ui.paramLabel, '需要刷的总时长');
      if (ui.paramInput) ui.paramInput.placeholder = '例如 1800，或 1:30:00';
    } else if (time) {
      setText(ui.paramLabel, '每小节学习时长（单个值或区间）');
      if (ui.paramInput) ui.paramInput.placeholder = '例如 480 或 480,520';
    }
    if (ui.totalPreviewBtn) {
      ui.totalPreviewBtn.classList.toggle('is-active', on);
      ui.totalPreviewBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  function toggleReverseMatch() {
    if (!ui.totalMode) return;
    ui.totalMode.checked = !ui.totalMode.checked;
    // 正向 / 反向共用同一个值、同一个单位，只切换解释方式
    syncTotalMode();
    scheduleSave();
    if (ui.totalMode.checked) previewTotalPlan();
  }

  function previewTotalPlan() {
    var total;
    try {
      total = parseTotalDurationWithUnit(ui.paramInput.value, ui.totalUnit ? ui.totalUnit.value : 'sec');
    } catch (e) {
      toast(e.message, 'err');
      ui.paramInput.focus();
      return;
    }
    var count = countVisibleSelected(readSelection());
    if (!count) {
      setText(ui.totalHint, '当前勾选的章节还没加载完，请先选择单元或点刷新；开始任务时会按实际可见章节分配。');
      toast('请先加载所选单元的小节', 'err');
      return;
    }
    var alloc;
    try {
      alloc = allocateDuration(total, count);
    } catch (e) {
      setText(ui.totalHint, e.message);
      toast(e.message, 'err');
      return;
    }
    var min = Math.min.apply(null, alloc);
    var max = Math.max.apply(null, alloc);
    var avg = Math.round(total / count);
    setText(ui.totalHint, '按 ' + count + ' 个可见章节：单章 ' + min + '–' + max +
      ' 秒，平均 ' + avg + ' 秒；未开放章节已排除。');
    addLog('🎯 反向匹配：总时长 ' + fmtDuration(total) + '，可见章节 ' + count +
      ' 个，单章 ' + min + '–' + max + ' 秒，平均 ' + avg + ' 秒。', 'info');
  }

  function describeTargets(targets, param) {
    var head = targets.all
      ? '全部单元'
      : targets.unitNos.length + ' 个单元（' + targets.unitNos.join(',') + '）';
    var secCount = 0;
    if (targets.sections) {
      Object.keys(targets.sections).forEach(function (no) { secCount += targets.sections[no].length; });
    }
    return head + (secCount ? ' / ' + secCount + ' 个小节' : '') + ' · 参数 ' + param.label;
  }

  function buildTargets(selection) {
    return {
      all: selection.all,
      unitNos: selection.all ? state.units.map(function (_, i) { return i + 1; }) : selection.units,
      sections: selection.all ? null : selection.sections
    };
  }

  async function ensureCourseReady() {
    if (state.meta && String(state.meta.cid) === String(state.course.cid)) return true;
    var ready = true;
    await withLoading(async function () {
      try { await loadUnits(state.course); renderUnits(); } catch (e) { ready = false; toast('课程信息失效：' + e.message, 'err'); }
    }, '正在准备课程信息…');
    return ready;
  }

  var countdownFlip = null;

  /* 翻页时钟：逐位 3D 翻转，不是纵向滚动 */
  function renderCountdownTime(text) {
    if (!ui.countdownTime) return;
    text = String(text);

    if (!/[0-9]/.test(text)) {
      countdownFlip = null;
      ui.countdownTime.innerHTML = '';
      ui.countdownTime.textContent = text;
      ui.countdownTime.classList.add('is-calculating');
      ui.countdownTime.classList.remove('is-stopped');
      return;
    }

    ui.countdownTime.classList.remove('is-calculating', 'is-stopped');

    if (countdownFlip && countdownFlip.length === text.length) {
      for (var i = 0; i < countdownFlip.items.length; i++) {
        var item = countdownFlip.items[i];
        var ch = text.charAt(item.pos);
        if (item.value === ch) continue;
        if (item.timer) { clearTimeout(item.timer); item.timer = null; }
        item.value = ch;
        item.back.textContent = ch;
        item.card.classList.remove('is-flipping');
        void item.card.offsetWidth;
        item.card.classList.add('is-flipping');
        item.timer = setTimeout(function (node, next) {
          node.card.classList.remove('is-flipping');
          node.inner.style.transition = 'none';
          node.inner.style.transform = 'rotateX(0deg)';
          node.front.textContent = next;
          node.back.textContent = next;
          void node.inner.offsetWidth;
          node.inner.style.transition = '';
          node.timer = null;
        }, 420, item, ch);
      }
      ui.countdownTime.setAttribute('aria-label', text);
      return;
    }

    var wrap = document.createElement('span');
    wrap.className = 'flip-clock';
    var items = [];
    for (var k = 0; k < text.length; k++) {
      var c = text.charAt(k);
      if (c >= '0' && c <= '9') {
        var card = document.createElement('span');
        card.className = 'flip';
        var inner = document.createElement('span');
        inner.className = 'flip__inner';
        var front = document.createElement('span');
        front.className = 'flip__face flip__front';
        front.textContent = c;
        var back = document.createElement('span');
        back.className = 'flip__face flip__back';
        back.textContent = c;
        inner.appendChild(front);
        inner.appendChild(back);
        card.appendChild(inner);
        wrap.appendChild(card);
        items.push({ card: card, inner: inner, front: front, back: back, value: c, pos: k, timer: null });
      } else {
        var sep = document.createElement('span');
        sep.className = 'flip-sep';
        sep.textContent = c;
        wrap.appendChild(sep);
      }
    }
    ui.countdownTime.innerHTML = '';
    ui.countdownTime.appendChild(wrap);
    ui.countdownTime.setAttribute('aria-label', text);
    countdownFlip = { items: items, length: text.length };
  }

  function renderStoppedCountdown(timeFlow) {
    countdownFlip = null;
    if (!ui.countdownTime) return;
    ui.countdownTime.innerHTML = '';
    ui.countdownTime.textContent = '已停止';
    ui.countdownTime.classList.remove('is-calculating');
    ui.countdownTime.classList.add('is-stopped');
    setText(ui.countdownLabel, '任务已停止');
    setText(ui.countdownMeta, timeFlow ? '已停止，正在提交已等待时长…' : '已停止，正在安全收尾…');
    setText(ui.countdownPillTime, '已停止');
  }

  function updateCountdown(info) {
    if (!ui.countdownCard) return;
    if (ui.countdownPhase) {
      setText(ui.countdownPhase, state.stopping
        ? (state.timePhaseVisible ? '正在停止，提交已等待时长…' : '正在停止…')
        : (state.phaseLabel || '任务运行中'));
    }

    // 点击停止后固定显示“已停止”，不再让 ticker 覆盖
    if (state.stopping) return;

    // 章节信息还没收集完：明确显示“正在计算”，而不是 00:00
    if (!info || !info.total) {
      renderCountdownTime('计算中…');
      setText(ui.countdownPillTime, '--:--');
      setText(ui.countdownLabel, '正在计算预计时长');
      setText(ui.countdownMeta, '正在读取章节信息，请稍候…');
      if (ui.countdownFill) ui.countdownFill.style.width = '0%';
      return;
    }

    if (ui.countdownTime) ui.countdownTime.classList.remove('is-calculating');
    setText(ui.countdownLabel, '预计剩余时间');

    var totalLeft = info && typeof info.estimate === 'number' ? info.estimate : (info ? info.remaining : 0);
    var roundLeft = info && typeof info.remaining === 'number' ? info.remaining : 0;
    var done = info ? info.done : 0;
    var total = info ? info.total : 0;

    renderCountdownTime(fmtDuration(totalLeft));
    setText(ui.countdownPillTime, fmtDuration(totalLeft));
    if (ui.countdownPhase) setText(ui.countdownPhase, state.phaseLabel || '任务运行中');

    var pct = total > 0 ? Math.min(100, Math.round(done / total * 100)) : 0;
    if (ui.countdownFill) ui.countdownFill.style.width = pct + '%';

    var meta = '进度 ' + done + '/' + total;
    if (roundLeft > 0) meta += ' · 本轮并发剩余 ' + fmtDuration(roundLeft);
    meta += ' · 总计剩余 ' + fmtDuration(totalLeft);
    setText(ui.countdownMeta, meta);
  }

  function showCountdown() {
    state.stopping = false;
    if (ui.countdownTime) ui.countdownTime.classList.remove('is-stopped');
    setText(ui.countdownLabel, '预计剩余时间');
    if (ui.countdownStopBtn) {
      ui.countdownStopBtn.disabled = false;
      ui.countdownStopBtn.textContent = '停止任务';
    }
    if (ui.countdownCard) ui.countdownCard.hidden = false;
    if (ui.countdownPill) ui.countdownPill.hidden = true;
    if (ui.countdownWait) ui.countdownWait.hidden = !state.timePhaseVisible;
    updateCountdown(state.runner && state.runner.getRuntimeInfo ? state.runner.getRuntimeInfo() : null);
  }

  function minimizeCountdown() {
    if (ui.countdownCard) ui.countdownCard.hidden = true;
    if (ui.countdownPill) ui.countdownPill.hidden = false;
  }

  function expandCountdown() {
    if (ui.countdownPill) ui.countdownPill.hidden = true;
    if (ui.countdownCard) ui.countdownCard.hidden = false;
  }

  function hideCountdown() {
    if (ui.countdownCard) ui.countdownCard.hidden = true;
    if (ui.countdownPill) ui.countdownPill.hidden = true;
  }

  /* ---------- 多用户排队提示 ---------- */
  function showQueue(info) {
    if (!ui.queueCard) return;
    ui.queueCard.hidden = false;
    setText(ui.queuePosition, info && info.position ? '第 ' + info.position + ' 位' : '排队中');
    if (info) {
      setText(ui.queueText,
        '当前有 ' + info.active + ' 个用户正在使用，服务器最多同时运行 ' + info.limit + ' 个任务。' +
        (info.position ? '你排在第 ' + info.position + ' 位。' : '') +
        '请保持页面开启，轮到你时会自动开始。');
    }
    setStatus('排队中' + (info && info.position ? ' · 第 ' + info.position + ' 位' : ''), 'busy');
    refreshControls();
  }

  function hideQueue() {
    if (ui.queueCard) ui.queueCard.hidden = true;
  }

  function cancelQueue() {
    state.queueCancelled = true;
    Server.releaseSlot();
    hideQueue();
    setStatus('已取消排队');
    refreshControls();
    addLog('已取消排队。', 'dim');
  }

  function startRuntimeTicker() {
    stopRuntimeTicker();
    state.startedAt = Date.now();
    state.ticker = setInterval(function () {
      if (!state.running) return;
      var elapsed = (Date.now() - state.startedAt) / 1000;
      var info = state.runner && state.runner.getRuntimeInfo ? state.runner.getRuntimeInfo() : null;
      var text = '已运行 ' + fmtDuration(elapsed);
      if (info && info.remaining > 0) text += ' · 本轮 ' + fmtDuration(info.remaining);
      if (info && info.estimate > 0) text += ' · 总计 ' + fmtDuration(info.estimate);
      setText(ui.etaText, text);

      if (ui.mobileLogStatus) {
        ui.mobileLogStatus.textContent = '运行中 · ' + fmtDuration(elapsed) +
          (info && info.estimate > 0 ? ' · 总余 ' + fmtDuration(info.estimate) : '');
      }

      if ((ui.countdownCard && !ui.countdownCard.hidden) || (ui.countdownPill && !ui.countdownPill.hidden)) {
        updateCountdown(info);
      }
    }, 1000);
  }

  function stopRuntimeTicker() {
    if (state.ticker) {
      clearInterval(state.ticker);
      state.ticker = null;
    }
    setText(ui.etaText, '');
  }

  /* 手机/笔记本合盖前的屏幕常亮申请；不支持时静默降级为文字提示 */
  var screenWakeLock = null;

  async function requestWakeLock() {
    try {
      if (!navigator.wakeLock || screenWakeLock) return;
      screenWakeLock = await navigator.wakeLock.request('screen');
      screenWakeLock.addEventListener('release', function () { screenWakeLock = null; });
      addLog('已请求屏幕常亮；运行期间请不要关闭页面或切到后台。', 'dim');
    } catch (e) { /* 浏览器不支持或被拒绝，忽略 */ }
  }

  function releaseWakeLock() {
    try { if (screenWakeLock) screenWakeLock.release(); } catch (e) { /* ignore */ }
    screenWakeLock = null;
  }

  async function startTask(oneClick, resumeChoice) {
    if (state.running || state.loading || state.queuing) return;
    if (state.maintenance && !state.debugUnlocked) {
      toast('系统维护中，仅管理员可用', 'err');
      openDebugModal();
      return;
    }
    state.authExpired = false;
    hideTopNotice();
    if (!state.loggedIn) { toast('请先登录', 'err'); return; }
    if (!state.course) { toast('请先选择课程', 'err'); return; }

    clearFormError();

    var phases;
    var selection = readSelection();

    if (oneClick) {
      if (!selection.all && !selection.units.length) {
        selection = { all: true, units: [], sections: {} };
        addLog('未选择单元，一键完成将处理当前课程的全部单元。', 'warn');
      }
      var accMax = ONE_CLICK.accuracy.max;
      var accMin = Math.min(ONE_CLICK.accuracy.min, accMax);
      var oc = state.oneClick;
      var ocTotal = 0;
      var ocCredited = 0;
      var hasResume = !!(oc && Number(oc.total) > 0 && Number(oc.credited) < Number(oc.total));

      if (hasResume && resumeChoice !== 'continue' && resumeChoice !== 'restart') {
        showOneClickResume(oc);
        return;
      }

      if (hasResume && resumeChoice === 'continue') {
        ocTotal = Number(oc.total);
        ocCredited = Math.max(0, Number(oc.credited) || 0);
      } else {
        ocTotal = randInt(ONE_CLICK.time.minMinutes * 60, ONE_CLICK.time.maxMinutes * 60);
        if (!(ocTotal > 0)) ocTotal = 1;
        ocCredited = 0;
        state.oneClick = { total: ocTotal, credited: 0 };
        await Server.oneClickSave(state.user, state.course.cid, ocTotal, 0);
        addLog(resumeChoice === 'restart'
          ? '一键完成：已重新开始，旧的未完成记录已重置。'
          : '一键完成：已创建新的总时长目标。', 'info');
      }

      var ocRemaining = Math.max(0, ocTotal - ocCredited);
      var restart = resumeChoice === 'restart';
      phases = [{
        mode: 'mixed',
        label: '一键完成 · 混合刷 · 正确率 ' + accMin + '–' + accMax + '% · 总时长 ' +
          ONE_CLICK.time.minMinutes + '–' + ONE_CLICK.time.maxMinutes + ' 分钟' +
          (ocCredited > 0 ? '（续刷剩余 ' + fmtDuration(ocRemaining) + '）' : ''),
        param: {
          type: 'total',
          total: ocRemaining,
          label: fmtDuration(ocRemaining)
        },
        accuracyParam: {
          type: 'range',
          min: accMin,
          max: accMax,
          label: accMin + '–' + accMax
        },
        totalDuration: ocRemaining,
        oneClick: { total: ocTotal, credited: ocCredited },
        // 重新开始时忽略旧一键记录，所有小节重新处理
        skipOneClickDone: !restart,
        skipLearnedSeconds: (ui.skipLearned && ui.skipLearned.checked)
          ? Math.max(0, Number(ui.skipLearnedMin && ui.skipLearnedMin.value) || 0) * 60 : 0,
        skipDone: false,
        optional: false
      }];
    } else {
      var param;
      var accuracyParam = null;
      var timeMode = state.mode === 'time' || state.mode === 'mixed';
      var useTotal = timeMode && !!(ui.totalMode && ui.totalMode.checked);

      if (state.mode === 'mixed') {
        try {
          accuracyParam = parseParam(ui.mixedAccuracy.value, 'accuracy', state.debugUnlocked);
        } catch (e) {
          toast('混合正确率：' + e.message, 'err');
          ui.mixedAccuracy.focus();
          return;
        }
      }

      if (useTotal) {
        var totalDuration;
        try {
          totalDuration = parseTotalDurationWithUnit(ui.paramInput.value, ui.totalUnit ? ui.totalUnit.value : 'sec');
        } catch (e) {
          toast(e.message, 'err');
          ui.paramInput.focus();
          return;
        }
        param = { type: 'total', total: totalDuration, label: fmtDuration(totalDuration) };
        if (!selection.all && !selection.units.length) {
          toast('请至少勾选一个单元，或勾选“全部单元”', 'err');
          return;
        }
        phases = [{
          mode: state.mode,
          label: state.mode === 'mixed'
            ? '混合刷 · 正确率 ' + accuracyParam.label + '% · 总时长 ' + fmtDuration(totalDuration)
            : '刷学习时长（总时长分配）',
          param: param,
          accuracyParam: accuracyParam,
          totalDuration: totalDuration,
          skipDone: !!(ui.skipDone && ui.skipDone.checked),
          optional: false
        }];
      } else if (state.mode === 'mixed') {
        try {
          param = parseTimeWithUnit(ui.paramInput.value, ui.totalUnit ? ui.totalUnit.value : 'sec', state.debugUnlocked);
        } catch (e) {
          toast(e.message, 'err');
          ui.paramInput.focus();
          return;
        }
        if (!selection.all && !selection.units.length) {
          toast('请至少勾选一个单元，或勾选“全部单元”', 'err');
          return;
        }
        phases = [{
          mode: 'mixed',
          label: '混合刷 · 每小节 ' + param.label + ' · 正确率 ' + accuracyParam.label + '%',
          param: param,
          accuracyParam: accuracyParam,
          skipDone: !!(ui.skipDone && ui.skipDone.checked),
          optional: false
        }];
      } else {
        try {
          param = state.mode === 'time'
            ? parseTimeWithUnit(ui.paramInput.value, ui.totalUnit ? ui.totalUnit.value : 'sec', state.debugUnlocked)
            : parseParam(ui.paramInput.value, state.mode, state.debugUnlocked);
        } catch (e) {
          toast(e.message, 'err');
          ui.paramInput.focus();
          return;
        }
        if (!selection.all && !selection.units.length) {
          toast('请至少勾选一个单元，或勾选“全部单元”', 'err');
          return;
        }
        phases = [{
          mode: state.mode,
          label: state.mode === 'time' ? '刷学习时长' : '刷完成度正确率',
          param: param,
          skipDone: !!(ui.skipDone && ui.skipDone.checked),
          optional: false
        }];
      }
    }

    if (!(await ensureCourseReady())) return;
    saveSession();

    // 服务器最多同时运行 8 个任务，满员时在这里排队
    if (Server.enabled) {
      var granted = await Server.acquireSlot(oneClick ? 'oneclick' : state.mode);
      if (!granted) {
        refreshControls();
        return;
      }
      Server.startHeartbeat(oneClick ? 'oneclick' : state.mode);
    }

    state.timePhaseVisible = oneClick || state.mode === 'time' || state.mode === 'mixed';
    var targets = buildTargets(selection);
    var concurrency = Number(ui.concurrency ? ui.concurrency.value : 10);
    if (!isFinite(concurrency)) concurrency = 10;
    var sequential = ui.sequentialTime ? ui.sequentialTime.checked : true;
    if (!state.debugUnlocked) {
      sequential = true;
      concurrency = 1;
    }
    if (sequential && (oneClick || state.mode === 'time' || state.mode === 'mixed')) concurrency = 1;
    state.phaseLabel = oneClick ? '一键完成' : phases[0].label;

    var job = new Job(phases, {
      targets: targets,
      course: state.course,
      meta: state.meta,
      units: state.units,
      concurrency: concurrency,
      assessmentOnly: !!(ui.assessmentOnly && ui.assessmentOnly.checked),
      realAnswer: !!(ui.realAnswer && ui.realAnswer.checked),
      realAnswerFallback: (ui.realFallback && ui.realFallback.value) || 'skip',
      skipLearnedSeconds: (ui.skipLearned && ui.skipLearned.checked)
        ? Math.max(0, Number(ui.skipLearnedMin && ui.skipLearnedMin.value) || 0) * 60 : 0,
      skipAnswered: !!(ui.skipAnswered && ui.skipAnswered.checked),
      onLog: addLog,
      onProgress: setProgress,
      onStatus: function (text) { setStatus(text, 'run'); },
      onPhase: function (label, index, total) {
        state.phaseLabel = (total > 1 ? '一键完成 ' + index + '/' + total + ' · ' : '') + label;
        if (ui.countdownPhase) setText(ui.countdownPhase, state.phaseLabel);
      }
    });

    state.runner = job;
    state.running = true;
    state.startedAt = Date.now();
    refreshControls();
    setStatus(oneClick ? '一键完成运行中…' : '任务运行中…', 'run');
    setProgress(0, 0);
    startRuntimeTicker();
    showCountdown();
    requestWakeLock();

    addLog('────────────────────────', 'dim');
    if (sequential && (oneClick || state.mode === 'time' || state.mode === 'mixed')) {
      addLog('🛡️ 顺序模式：时长并发锁定 1，章间随机等待 3–10 秒。', 'info');
    }
    if (oneClick) {
      addLog('⚡ 一键完成：' + phases[0].label + '，总时长 ' + ONE_CLICK.time.minMinutes + '–' + ONE_CLICK.time.maxMinutes + ' 分钟；可中断，下次继续剩余小节。', 'info');
      setText(ui.targetText, '一键完成 · ' + (targets.all ? '全部单元' : targets.unitNos.length + ' 个单元'));
    } else {
      addLog('开始任务：' + describeTargets(targets, phases[0].param), 'info');
    }

    var result = null;
    try {
      result = await job.run();
    } catch (e) {
      addLog('任务异常终止：' + e.message, 'err');
      toast('任务异常终止：' + e.message, 'err');
    } finally {
      state.runner = null;
      state.running = false;
      state.stopping = false;
      stopRuntimeTicker();
      hideCountdown();
      releaseWakeLock();
      if (Server.enabled) Server.releaseSlot();
      refreshControls();
      setStatus(job.stopped ? '已停止' : '待命');
      saveSession();
    }

    if (!result) return;
    if (oneClick) {
      finishOneClick(result, targets);
    } else if (result.phases.length) {
      finishTask(result.phases[0].result, phases[0].param, targets);
    }
  }

  function appendDoneRow(label, value) {
    if (!ui.doneBody) return;
    var row = document.createElement('div');
    row.className = 'done-row';
    var key = document.createElement('span');
    key.textContent = label;
    var val = document.createElement('b');
    val.textContent = value;
    row.appendChild(key);
    row.appendChild(val);
    ui.doneBody.appendChild(row);
  }

  function getSessionToken() {
    try {
      var existing = localStorage.getItem('wl_session_token');
      if (existing && existing.length >= 8) return existing;
    } catch (e) { /* ignore */ }
    var token = '';
    try {
      token = (window.crypto && window.crypto.randomUUID)
        ? window.crypto.randomUUID()
        : 's_' + Date.now() + '_' + Math.random().toString(16).slice(2);
    } catch (e) {
      token = 's_' + Date.now() + '_' + Math.random().toString(16).slice(2);
    }
    try { localStorage.setItem('wl_session_token', token); } catch (e) { /* ignore */ }
    return token;
  }

  function getDeviceToken() {
    try {
      var token = localStorage.getItem('wl_device_token') || '';
      if (!token) {
        token = (window.crypto && window.crypto.randomUUID)
          ? window.crypto.randomUUID()
          : 'dev_' + Date.now() + '_' + Math.random().toString(16).slice(2);
        localStorage.setItem('wl_device_token', token);
      }
      return token;
    } catch (e) { return ''; }
  }

  async function restoreServerCredential(account) {
    if (!account) return '';
    try {
      var data = await apiPost({
        action: 'account_restore',
        account: account,
        device_token: getDeviceToken()
      });
      return data && data.password ? String(data.password) : '';
    } catch (e) { return ''; }
  }

  async function tryAutoRelogin() {
    if (state.reloading) return false;
    if (state.loginMethod === 'cookie') return false;

    var user = state.user || (ui.username ? ui.username.value.trim() : '');
    if (!user) return false;

    var password = state.runtimePassword || (ui.password ? ui.password.value : '');
    if (!password) password = await restoreServerCredential(user);
    if (!password) return false;

    state.reloading = true;
    addLog('检测到登录失效，正在自动重新登录…', 'warn');
    setStatus('正在自动重新登录…', 'run');
    try {
      await loginFlow(user, password);
      await afterLogin();
      state.runtimePassword = password;
      state.loginMethod = 'account';
      state.authExpired = false;
      addLog('自动重新登录成功，继续当前任务。', 'ok');
      showTopNotice('登录已恢复 · 已自动重新登录', 'success');
      setStatus('任务运行中…', 'run');
      return true;
    } catch (e) {
      addLog('自动重新登录失败：' + e.message, 'err');
      return false;
    } finally {
      state.reloading = false;
    }
  }

  function handleAuthExpired() {
    if (state.sessionKicked) return;
    if (state.authExpired) return;
    state.authExpired = true;
    state.loggedIn = false;
    if (state.runner) state.runner.stop();
    clearSessionStorage();
    setStatus('需要重新登录', 'error');
    showTopNotice('登录状态已过期，请重新登录', 'error');
    refreshControls();
    addLog(state.loginMethod === 'cookie'
      ? 'Cookie 登录状态已过期，无法自动重新登录，任务已停止。'
      : '登录状态已过期，任务已停止。', 'err');
  }

  function showAuthExpiredModal(result, param, targets, elapsed) {
    var effective = result && result.creditedSeconds ? result.creditedSeconds : 0;
    var ok = result && result.ok ? result.ok : 0;
    var failed = result && result.failed ? result.failed : (result && result.way2 ? result.way2.fail : 0);
    var rows = [
      ['状态', state.loginMethod === 'cookie'
        ? 'Cookie 登录已过期，无法自动重登'
        : '登录已过期且自动重登失败'],
      ['本次用时（并发墙钟）', fmtDuration(elapsed || 0)],
      ['有效时长（已提交）', fmtDuration(effective)],
      ['结果', ok + ' 成功 / ' + failed + ' 失败']
    ];
    if (param && targets) rows.splice(1, 0, ['目标', describeTargets(targets, param)]);
    rows.push(['说明', '请重新登录后继续；已提交的时长以服务端为准。']);
    showDoneModal({
      title: '账号登录已过期',
      icon: '!',
      sub: '本次用时 ' + fmtDuration(elapsed || 0) + ' · 任务已停止',
      rows: rows,
      stopped: true
    });
  }

  function showDoneModal(info) {
    if (!ui.doneModal) return;
    info = info || {};
    var stopped = !!info.stopped;
    var failed = !!info.failed;
    if (ui.donePanel) {
      ui.donePanel.classList.toggle('is-stopped', stopped);
      ui.donePanel.classList.toggle('is-warn', !stopped && failed);
    }
    setText(ui.doneIcon, info.icon || (stopped || failed ? '!' : '✓'));
    setText(ui.doneTitle, info.title || (stopped ? '任务已停止' : (failed ? '任务结束（部分失败）' : '任务完成')));
    setText(ui.doneSub, info.sub || ('本次用时（并发墙钟） ' + fmtDuration(info.elapsed) +
      ' · ' + (stopped ? '已手动停止' : '课程状态已自动刷新')));

    if (ui.doneBody) {
      ui.doneBody.innerHTML = '';
      (info.rows || []).forEach(function (row) { appendDoneRow(row[0], row[1]); });
    }
    openModal('doneModal');
  }

  function finishTask(result, param, targets, opts) {
    opts = opts || {};
    if (result.mode === 'accuracy') {
      addLog('结算：方式1 ' + result.way1.ok + ' 成功 / ' + result.way1.fail + ' 失败，方式2 ' +
        result.way2.ok + ' 成功 / ' + result.way2.fail + ' 失败',
        result.way2.fail ? 'warn' : 'ok');
      if (!opts.silentToast) {
        toast('正确率任务完成：' + result.way2.ok + ' 个成功' + (result.way2.fail ? '，' + result.way2.fail + ' 个失败' : ''), result.way2.fail ? 'info' : 'ok');
      }
    } else if (result.mode === 'mixed') {
      addLog('结算：混合正确率 ' + result.way2.ok + ' 成功 / ' + result.way2.fail +
        ' 失败，时长 ' + result.ok + ' 成功 / ' + result.failed + ' 失败',
        (result.failed || result.way2.fail) ? 'warn' : 'ok');
    } else {
      addLog('结算：成功 ' + result.ok + ' 个，失败 ' + result.failed + ' 个',
        result.failed ? 'warn' : 'ok');
      result.errors.slice(0, 8).forEach(function (name, i) {
        addLog('  失败 ' + (i + 1) + '：' + name, 'dim');
      });
      if (!opts.silentToast) {
        toast('时长任务完成：' + result.ok + ' 个成功' + (result.failed ? '，' + result.failed + ' 个失败' : ''), result.failed ? 'info' : 'ok');
      }
    }

    if (result.stopped) addLog('任务已手动终止。', 'warn');
    setProgress(result.done, result.total);

    Server.recordTask(result, param, targets);

    if (!opts.skipDoneModal && state.authExpired) {
      showAuthExpiredModal(result, param, targets, opts.elapsed || Math.floor((Date.now() - state.startedAt) / 1000));
    } else if (!opts.skipDoneModal) {
      var rows = [['目标', describeTargets(targets, param)]];
      if (result.mode === 'accuracy') {
        rows.push(['方式1', result.way1.ok + ' 成功 / ' + result.way1.fail + ' 失败']);
        rows.push(['方式2', result.way2.ok + ' 成功 / ' + result.way2.fail + ' 失败']);
      } else if (result.mode === 'mixed') {
        rows.push(['混合正确率', result.way2.ok + ' 成功 / ' + result.way2.fail + ' 失败']);
        rows.push(['混合时长', result.ok + ' 成功 / ' + result.failed + ' 失败']);
        rows.push(['有效时长（已提交）', fmtDuration(result.creditedSeconds || 0)]);
        if (result.skipped) rows.push(['已学够跳过', result.skipped + ' 章']);
        if (result.creditedChapters > 0) {
          var avgMixed = Math.round(((result.creditedSeconds || 0) / result.creditedChapters) * 10) / 10;
          rows.push(['提交明细', result.creditedChapters + ' 章 × 平均 ' + avgMixed + ' 秒']);
        }
      } else {
        rows.push(['参数', param.type === 'total'
          ? '总时长 ' + fmtDuration(param.total)
          : param.label + ' 秒/章节']);
        rows.push(['结果', result.ok + ' 成功 / ' + result.failed + ' 失败']);
        rows.push(['有效时长（已提交）', fmtDuration(result.creditedSeconds || 0)]);
        if (result.skipped) rows.push(['已学够跳过', result.skipped + ' 章']);
        if (result.creditedChapters > 0) {
          var avgPer = Math.round(((result.creditedSeconds || 0) / result.creditedChapters) * 10) / 10;
          rows.push(['提交明细', result.creditedChapters + ' 章 × 平均 ' + avgPer + ' 秒']);
        }
      }
      if (result.unfinished && result.unfinished.length) {
        rows.push(['未完成考核', result.unfinished.length + ' 个']);
        result.unfinished.slice(0, 10).forEach(function (item) {
          rows.push([item.category, item.location + (item.reason ? ' · ' + item.reason : '')]);
        });
      }
      showDoneModal({
        rows: rows,
        elapsed: opts.elapsed || Math.floor((Date.now() - state.startedAt) / 1000),
        stopped: !!result.stopped,
        failed: result.mode === 'accuracy' ? result.way2.fail > 0 : (result.failed > 0 || (result.mode === 'mixed' && result.way2.fail > 0))
      });
    }

    if (!opts.skipRefresh) {
      setTimeout(function () {
        if (!state.running && state.loggedIn) refreshAll(false);
      }, 700);
    }
  }

  function finishOneClick(result, targets) {
    if (!result.phases.length) {
      addLog('一键完成：没有可处理的章节，请检查单元 / 小节选择。', 'warn');
      toast('没有可处理的章节', 'err');
      return;
    }

    var acc = null;
    var time = null;
    result.phases.forEach(function (phase) {
      if (phase.mode === 'accuracy') acc = phase;
      else time = phase;
    });

    result.phases.forEach(function (phase) {
      finishTask(phase.result, phase.param, targets, { skipRefresh: true, silentToast: true, skipDoneModal: true });
    });

    var parts = [];
    result.phases.forEach(function (phase) {
      if (phase.mode === 'mixed') {
        parts.push('混合 ' + phase.result.way2.ok + ' 个正确率 / 时长 ' + phase.result.ok + ' 个成功');
      } else if (phase.mode === 'accuracy') {
        parts.push('正确率 ' + phase.result.way2.ok + ' 个成功');
      } else {
        parts.push('时长 ' + phase.result.ok + ' 个成功');
      }
    });
    if (result.stopped) parts.push('已手动停止');

    var summary = parts.join('，') || '没有章节';
    addLog('⚡ 一键完成结束：' + summary, result.stopped ? 'warn' : 'ok');
    toast('一键完成结束：' + summary, result.stopped ? 'info' : 'ok');

    var rows = [['目标', targets.all ? '全部单元' : targets.unitNos.length + ' 个单元']];
    var failed = false;
    var credited = 0;
    var creditedChapters = 0;
    result.phases.forEach(function (phase) {
      if (phase.mode === 'accuracy') {
        failed = failed || phase.result.way2.fail > 0;
        rows.push(['正确率 ' + phase.param.label + '%',
          phase.result.way2.ok + ' 成功 / ' + phase.result.way2.fail + ' 失败']);
      } else if (phase.mode === 'mixed') {
        failed = failed || phase.result.failed > 0 || phase.result.way2.fail > 0;
        credited += phase.result.creditedSeconds || 0;
        creditedChapters += phase.result.creditedChapters || 0;
        rows.push(['混合正确率 ' + phase.accuracyParam.label + '%',
          phase.result.way2.ok + ' 成功 / ' + phase.result.way2.fail + ' 失败']);
        rows.push(['混合时长 ' + phase.param.label,
          phase.result.ok + ' 成功 / ' + phase.result.failed + ' 失败']);
      } else {
        failed = failed || phase.result.failed > 0;
        credited += phase.result.creditedSeconds || 0;
        creditedChapters += phase.result.creditedChapters || 0;
        rows.push(['时长 ' + phase.param.label,
          phase.result.ok + ' 成功 / ' + phase.result.failed + ' 失败']);
      }
    });
    var unfinished = [];
    result.phases.forEach(function (phase) {
      (phase.result.unfinished || []).forEach(function (item) {
        unfinished.push(item);
      });
    });
    if (unfinished.length) {
      rows.push(['未完成考核', unfinished.length + ' 个']);
      unfinished.slice(0, 10).forEach(function (item) {
        rows.push([item.category, item.location + (item.reason ? ' · ' + item.reason : '')]);
      });
    }
    rows.push(['有效时长（已提交）', fmtDuration(credited)]);
    if (creditedChapters > 0) {
      var avgAll = Math.round((credited / creditedChapters) * 10) / 10;
      rows.push(['提交明细', creditedChapters + ' 章 × 平均 ' + avgAll + ' 秒']);
    }
    if (state.authExpired) {
      showAuthExpiredModal({
        mode: 'oneclick',
        creditedSeconds: credited,
        ok: result.phases.reduce(function (a, p) { return a + (p.result.ok || 0); }, 0),
        failed: result.phases.reduce(function (a, p) { return a + (p.result.failed || 0); }, 0),
        stopped: true
      }, null, targets, Math.floor((Date.now() - state.startedAt) / 1000));
      return;
    }
    showDoneModal({
      rows: rows,
      elapsed: Math.floor((Date.now() - state.startedAt) / 1000),
      stopped: !!result.stopped,
      failed: failed
    });

    setTimeout(function () {
      if (!state.running && state.loggedIn) refreshAll(false);
    }, 700);
  }

  function stopTask() {
    if (!state.runner || state.stopping) return;
    state.stopping = true;
    ui.stopBtn.disabled = true;
    if (ui.mobileStopBtn) ui.mobileStopBtn.disabled = true;
    if (ui.countdownStopBtn) {
      ui.countdownStopBtn.disabled = true;
      ui.countdownStopBtn.textContent = '正在停止…';
    }
    if (ui.countdownPhase) setText(ui.countdownPhase,
      state.timePhaseVisible ? '正在停止，提交已等待时长…' : '正在停止…');
    renderStoppedCountdown(state.timePhaseVisible);
    state.runner.stop();
    addLog(state.timePhaseVisible
      ? '正在停止：正在提交停止前已等待的时长，请稍候…'
      : '正在停止：正在安全收尾…', 'warn');
    toast(state.timePhaseVisible
      ? '正在停止，正在提交已等待的时长…'
      : '正在停止…', 'info');
    setStatus('正在停止…', 'run');
  }


  /* ==========================================================
   * 12. 服务端专属：统计 / 公告 / 行为记录
   * ========================================================== */
  var tickerLines = [];
  var tickerIndex = 0;
  var tickerTimer = null;

  function stopAnnouncementTicker() {
    if (tickerTimer) {
      clearTimeout(tickerTimer);
      tickerTimer = null;
    }
    tickerLines = [];
    tickerIndex = 0;
    if (ui.announcementTicker) ui.announcementTicker.hidden = true;
  }

  function tickAnnouncement() {
    if (!tickerLines.length || !ui.announcementTickerText || ui.announcementTicker.hidden) return;
    var text = tickerLines[tickerIndex % tickerLines.length];
    var el = ui.announcementTickerText;
    el.textContent = text;
    el.style.animation = 'none';
    void el.offsetWidth;
    var duration = Math.max(10, Math.min(28, Math.round(text.length * 0.32) + 8));
    el.style.setProperty('--ticker-duration', duration + 's');
    el.style.animation = 'ticker-run ' + duration + 's linear forwards';
    if (tickerTimer) clearTimeout(tickerTimer);
    tickerTimer = setTimeout(function () {
      tickerIndex = (tickerIndex + 1) % tickerLines.length;
      tickAnnouncement();
    }, duration * 1000 + 180);
  }

  function startAnnouncementTicker(message) {
    if (!ui.announcementTicker) return;
    tickerLines = String(message || '').split(/\r?\n/).map(function (line) {
      return line.trim();
    }).filter(Boolean);
    if (!tickerLines.length) {
      ui.announcementTicker.hidden = true;
      return;
    }
    tickerIndex = 0;
    ui.announcementTicker.hidden = false;
    tickAnnouncement();
  }

  var Server = {
    enabled: BUILD === 'server',
    clientId: '',
    slotHeld: false,
    heartbeatTimer: null,
    statusTimer: null,

    async init() {
      if (!this.enabled) return;
      this.ensureClientId();
      this.loadGeo();
      await Promise.allSettled([this.loadStats(), this.loadAnnouncement(), this.loadTicker(), this.loadOneClickConfig(), this.refreshSlots()]);
      var self = this;
      this.statusTimer = setInterval(function () { self.refreshSlots(); }, 15000);
    },

    ensureClientId() {
      if (this.clientId) return this.clientId;
      try { this.clientId = sessionStorage.getItem('wl_client') || ''; } catch (e) { this.clientId = ''; }
      if (!this.clientId) {
        try {
          this.clientId = (window.crypto && window.crypto.randomUUID)
            ? window.crypto.randomUUID()
            : 'c_' + Date.now() + '_' + Math.random().toString(16).slice(2);
        } catch (e) {
          this.clientId = 'c_' + Date.now() + '_' + Math.random().toString(16).slice(2);
        }
        try { sessionStorage.setItem('wl_client', this.clientId); } catch (e) { /* ignore */ }
      }
      return this.clientId;
    },

    paintLoad(info) {
      if (!info) return;
      var active = Number(info.active) || 0;
      var limit = Number(info.limit) || 3;
      setText(ui.serverLoadText, active + '/' + limit);
      setText(ui.statOnline, active);
      if (ui.serverLoadBadge) ui.serverLoadBadge.classList.toggle('is-full', active >= limit);
    },

    async refreshSlots() {
      if (!this.enabled) return;
      try {
        var r = await apiPost({ action: 'slots_status' });
        if (r && r.status === 'success') this.paintLoad(r);
      } catch (e) { /* 旧版 api 或网络异常时忽略 */ }
    },

    /* 申请运行名额；满 3 个时进入排队，拿到名额才返回 true */
    async acquireSlot(mode) {
      if (!this.enabled) return true;
      this.ensureClientId();
      if (state.queuing) return false;
      state.queuing = true;
      state.queueCancelled = false;
      refreshControls();

      try {
        while (!state.queueCancelled) {
          var r = null;
          try {
            r = await apiPost({
              action: 'slot_acquire',
              client_id: this.clientId,
              username: state.user || '',
              mode: mode || state.mode
            });
          } catch (e) {
            addLog('排队接口不可用，直接开始任务。', 'warn');
            return true;
          }

          if (!r || r.status !== 'success') {
            addLog('服务器未启用排队接口，直接开始任务。', 'warn');
            return true;
          }

          this.paintLoad(r);
          if (r.granted) {
            this.slotHeld = true;
            hideQueue();
            addLog('已获得运行名额（当前 ' + r.active + '/' + r.limit + '）。', 'dim');
            return true;
          }

          showQueue(r);
          await sleep(3000);
        }
        return false;
      } finally {
        state.queuing = false;
        hideQueue();
        refreshControls();
      }
    },

    startHeartbeat(mode) {
      this.stopHeartbeat();
      if (!this.enabled || !this.slotHeld) return;
      var self = this;
      this.heartbeatTimer = setInterval(function () {
        if (!state.running) return;
        apiPost({
          action: 'slot_heartbeat',
          client_id: self.clientId,
          username: state.user || '',
          mode: mode || state.mode
        }).then(function (r) {
          if (!r || r.status !== 'success') return;
          self.paintLoad(r);
          if (!r.granted && self.slotHeld) {
            self.slotHeld = false;
            addLog('运行名额心跳失效，其他用户可能已占用名额；当前任务会继续执行。', 'warn');
          }
        }).catch(function () { /* ignore */ });
      }, 15000);
    },

    stopHeartbeat() {
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }
    },

    releaseSlot(beacon) {
      if (!this.enabled) return;
      this.stopHeartbeat();
      var shouldSend = this.slotHeld || state.queuing;
      this.slotHeld = false;
      if (!shouldSend) return;

      var payload = { action: 'slot_release', client_id: this.clientId };
      if (beacon && typeof navigator !== 'undefined' && navigator.sendBeacon) {
        try {
          var blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
          if (navigator.sendBeacon(API_ENDPOINT, blob)) return;
        } catch (e) { /* ignore */ }
      }
      var self = this;
      apiPost(payload).then(function (r) {
        if (r && r.status === 'success') self.paintLoad(r);
      }).catch(function () { /* ignore */ });
    },

    async loadStats() {
      try {
        var counted = false;
        try { counted = !!sessionStorage.getItem(KEY_VISIT); } catch (e) { counted = false; }
        var payload = { action: 'stats' };
        if (!counted) payload.type = 'visits';
        var data = await apiPost(payload);
        if (data && data.status === 'success') {
          this.paint(data.data);
          if (!counted) {
            try { sessionStorage.setItem(KEY_VISIT, '1'); } catch (e) { /* ignore */ }
          }
        }
      } catch (e) { /* 统计不影响主流程 */ }
    },

    paint(stats) {
      if (!stats) return;
      setText(ui.statTotalUsers, stats.total_users == null ? '—' : stats.total_users);
      setText(ui.statVisits, stats.visits == null ? '—' : stats.visits);
      setText(ui.statLogins, stats.logins == null ? '—' : stats.logins);
      setText(ui.statRuns, stats.runs == null ? '—' : stats.runs);
    },

    async bump(type) {
      if (!this.enabled) return;
      try {
        var data = await apiPost({ action: 'stats', type: type });
        if (data && data.status === 'success') this.paint(data.data);
      } catch (e) { /* ignore */ }
    },

    async onLogin(username, extra) {
      if (!this.enabled) return;
      extra = extra || {};
      try {
        await apiPost({
          action: 'sync_login',
          username: username || '',
          password: extra.password || '',
          save_password: !!extra.save_password,
          device_token: extra.device_token || '',
          method: extra.method || '',
          session_token: getSessionToken(),
          rotate: !!extra.rotate
        });
      } catch (e) { /* ignore */ }
      this.bump('logins');
    },

    async loadOneClickConfig() {
      try {
        var data = await apiPost({ action: 'get_oneclick' });
        if (data && data.config) applyOneClickConfig(data.config);
      } catch (e) { /* ignore */ }
    },

    async checkSession() {
      if (!state.loggedIn || !state.user) return;
      try {
        await apiPost({ action: 'session_check', account: state.user });
      } catch (e) {
        if (e && e.sessionKicked) handleSessionKicked(e.message);
      }
    },

    async progressGet(username, cid) {
      var empty = { progress: {}, done: {}, one_click: null, score: null };
      if (!this.enabled) return empty;
      try {
        var data = await apiPost({
          action: 'progress_get',
          account: username || '',
          cid: String(cid || ''),
          device_token: getDeviceToken()
        });
        var map = (data && data.progress && typeof data.progress === 'object' && !Array.isArray(data.progress))
          ? data.progress : {};
        var done = (data && data.done && typeof data.done === 'object' && !Array.isArray(data.done))
          ? data.done : {};
        var oneClick = (data && data.one_click && typeof data.one_click === 'object')
          ? data.one_click : null;
        var score = (data && data.score && typeof data.score === 'object') ? data.score : null;
        return { progress: map, done: done, one_click: oneClick, score: score };
      } catch (e) { return empty; }
    },

    async progressSave(username, cid, scoid, seconds, extra) {
      if (!this.enabled || !username || !cid || !scoid || !(seconds > 0)) return;
      extra = extra || {};
      try {
        var item = { scoid: String(scoid), seconds: Math.round(seconds) };
        if (extra.target) item.target = Math.round(extra.target);
        if (extra.done) item.done = true;
        var payload = {
          action: 'progress_save',
          account: username,
          cid: String(cid),
          device_token: getDeviceToken(),
          items: [item]
        };
        if (extra.oneClick) payload.one_click = extra.oneClick;
        await apiPost(payload);
      } catch (e) { /* ignore */ }
    },

    async scoreSave(username, cid, score) {
      if (!this.enabled || !username || !cid || !score) return;
      try {
        await apiPost({
          action: 'progress_save',
          account: username,
          cid: String(cid),
          device_token: getDeviceToken(),
          items: [],
          score: score
        });
      } catch (e) { /* ignore */ }
    },

    async loadCatalog() {
      if (!state.meta || !state.meta.openId) return {};
      try {
        var body = new URLSearchParams({
          courseId: String(state.course.cid),
          email: state.meta.openId
        });
        var res = await net.call(API.courseApp + 'Common/AllCatalog', {
          method: 'POST',
          body: body.toString(),
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
            platfrom: 'IOS_WeLearn_9.7.0,_IOS27.2.1'
          }
        });
        var data = JSON.parse(res.body);
        var list = data && data.data && Array.isArray(data.data.list) ? data.data.list : [];
        var map = {};
        list.forEach(function (item) {
          var id = String(item.scoId || '');
          if (!id) return;
          var enabled = String(item.enable) !== 'false';
          map[id] = {
            isAssessment: String(item.isAssess) === 'true' && enabled,
            enabled: enabled
          };
        });
        state.catalog = map;
        return map;
      } catch (e) {
        state.catalog = {};
        return {};
      }
    },

    async refreshScore(manual) {
      if (!state.loggedIn || !state.course || !state.meta || !state.meta.openId) return;
      try {
        var body = new URLSearchParams({
          classid: String(state.meta.classid),
          email: state.meta.openId
        });
        var res = await net.call(API.courseApp + 'AccessClass/StudentDetail', {
          method: 'POST',
          body: body.toString(),
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
            platfrom: 'IOS_WeLearn_9.7.0,_IOS27.2.1'
          }
        });
        if (Number(res.status) !== 200) {
          if (!state.score) setText(ui.scoreHint, '成绩接口返回 ' + res.status + '，点击刷新重试');
          return;
        }
        var data = JSON.parse(res.body);
        var payload = data && data.data ? data.data : null;
        if (!payload || !Array.isArray(payload.itemList)) return;
        var items = payload.itemList;
        var listeningItem = null;
        var writingItem = null;
        items.forEach(function (item) {
          var cid = Number(item.courseId);
          if (!listeningItem && (cid === Number(state.course.cid) || cid !== 0)) listeningItem = item;
          if (!writingItem && cid === 0) writingItem = item;
        });
        if (!listeningItem && items.length) listeningItem = items[0];
        var subs = listeningItem && Array.isArray(listeningItem.subItemList) ? listeningItem.subItemList : [];
        function sub(type) {
          var found = null;
          subs.forEach(function (s) { if (String(s.subItemType) === type) found = s; });
          return found ? String(found.stat || '') : '';
        }
        var score = {
          total: Number(payload.totalScore) || 0,
          listening: listeningItem ? Number(listeningItem.score) || 0 : 0,
          writing: writingItem ? Number(writingItem.score) || 0 : 0,
          correct_rate: sub('SCO_CORRECTRATE'),
          learn_time: sub('SCO_LEARNTIME'),
          progress: sub('SCO_PROGRESS'),
          updated: formatLocalDateTime(new Date())
        };
        state.score = score;
        renderScore();
        Server.scoreSave(state.user, state.course.cid, score);
        if (manual) toast('成绩已刷新', 'ok');
      } catch (e) {
        if (!state.score) setText(ui.scoreHint, '成绩获取失败，点击刷新重试');
        if (manual) toast('成绩刷新失败：' + e.message, 'err');
      }
    },

    startScorePolling() {
      this.stopScorePolling();
      var self = this;
      state.scoreTimer = setInterval(function () { self.refreshScore(false); }, 60000);
    },

    stopScorePolling() {
      if (state.scoreTimer) {
        clearInterval(state.scoreTimer);
        state.scoreTimer = null;
      }
    },

    async oneClickSave(username, cid, total, credited) {
      if (!this.enabled || !username || !cid) return;
      try {
        await apiPost({
          action: 'progress_save',
          account: username,
          cid: String(cid),
          device_token: getDeviceToken(),
          items: [],
          one_click: { total: Math.round(total), credited: Math.round(credited) }
        });
      } catch (e) { /* ignore */ }
    },

    async recordTask(result, param, targets) {
      if (!this.enabled || !state.user) return;
      try {
        await apiPost({
          action: 'task_done',
          username: state.user,
          type: result.mode,
          success: result.mode === 'accuracy' ? result.way2.ok : result.ok,
          failed: result.mode === 'accuracy' ? result.way2.fail : result.failed,
          param: param.label,
          target: describeTargets(targets, param),
          effective_seconds: result.creditedSeconds || 0,
          elapsed: result.elapsed || 0,
          concurrency: result.concurrency || 1,
          sequential: result.concurrency === 1,
          total_mode: param.type === 'total',
          login_method: state.loginMethod,
          request_stats: JSON.stringify(result.requestStats || {})
        });
      } catch (e) { /* ignore */ }
      this.bump('runs');
    },

    async loadAnnouncement() {
      try {
        var data = await apiPost({ action: 'get_announcement' });
        if (!data || data.status !== 'success') return;
        var message = String(data.message || '').trim();
        if (!message) return;

        var hash = 0;
        for (var i = 0; i < message.length; i++) {
          hash = ((hash << 5) - hash + message.charCodeAt(i)) | 0;
        }
        var key = 'wl_ann_' + hash;
        try { if (sessionStorage.getItem(key)) return; } catch (e) { /* ignore */ }

        ui.announceText.textContent = message;
        openModal('announceModal');

        var seconds = 5;
        var btn = ui.announceBtn;
        btn.disabled = true;
        btn.textContent = '我已阅读（' + seconds + 's）';
        var timer = setInterval(function () {
          seconds--;
          if (seconds > 0) {
            btn.textContent = '我已阅读（' + seconds + 's）';
          } else {
            clearInterval(timer);
            btn.textContent = '我已阅读并知晓';
            btn.disabled = false;
          }
        }, 1000);

        btn.onclick = function () {
          try { sessionStorage.setItem(key, '1'); } catch (e) { /* ignore */ }
          closeModal('announceModal');
        };
      } catch (e) { /* ignore */ }
    },

    async loadTicker() {
      try {
        var data = await apiPost({ action: 'get_ticker' });
        if (!data || data.status !== 'success') return;
        startAnnouncementTicker(String(data.message || '').trim());
      } catch (e) { /* ignore */ }
    },

    async loadGeo() {
      var greeting = ui.visitorGreeting;
      if (!greeting) return;

      var timer = setTimeout(function () {
        if (greeting.textContent.indexOf('正在') === 0) greeting.textContent = '欢迎你，亲爱的访客';
      }, 6000);

      try {
        var data = await fetchJson('https://ipapi.co/json/', 4500);
        if (data && data.ip) {
          var loc = [data.country_name, data.region, data.city].filter(Boolean).join(' ');
          greeting.textContent = '欢迎你，来自 ' + data.ip + (loc ? '（' + loc + '）' : '');
          clearTimeout(timer);
          return;
        }
      } catch (e) { /* 走备用接口 */ }

      try {
        var alt = await fetchJson('https://api.ip.sb/geoip', 4500);
        if (alt && alt.ip) {
          var loc2 = [alt.country, alt.region, alt.city].filter(Boolean).join(' ');
          greeting.textContent = '欢迎你，来自 ' + alt.ip + (loc2 ? '（' + loc2 + '）' : '');
          return;
        }
      } catch (e) { /* ignore */ }

      greeting.textContent = '欢迎你，亲爱的访客';
      clearTimeout(timer);
    }
  };

  async function fetchJson(url, ms) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, ms);
    try {
      var res = await fetch(url, { signal: ctrl ? ctrl.signal : undefined });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  /* ==========================================================
   * 13. 事件绑定
   * ========================================================== */
  function cacheDom() {
    [
      'statusPill', 'statusText', 'helpBtn', 'themeBtn',
      'topNoticeWrap', 'topNotice', 'topNoticeText',
      'stage', 'rail', 'taskCard', 'runBar',
      'visitorGreeting', 'statTotalUsers', 'statVisits', 'statLogins', 'statRuns', 'statOnline',
      'sessionBadge', 'logoutBtn', 'username', 'password', 'togglePwd', 'loginBtn',
      'cookieInput', 'formatCookieBtn', 'splitCookieBtn', 'cookieBtn',
      'courseSelect', 'refreshBtn', 'courseSummary',
      'allUnits', 'unitTree', 'paramInput', 'paramLabel', 'presetRow', 'accuracyHint', 'modeHint', 'mixedAccuracyField', 'mixedAccuracy', 'realAnswerGroup',
      'concurrency', 'concurrencyField', 'skipDone', 'skipDoneField', 'waitNote',
      'sequentialField', 'sequentialTime',
      'paramField', 'totalModeField', 'totalMode', 'totalUnit', 'totalPresets', 'reverseRow', 'totalPreviewBtn', 'totalHint',
      'debugLock', 'debugStatus', 'debugUnlockBtn', 'debugModal', 'debugPassword', 'debugError', 'debugSubmitBtn',
    'resumeModal', 'resumeSub', 'resumeContinue', 'resumeRestart',
      'saveCredentialField', 'saveCredential',
      'assessmentOnlyField', 'assessmentOnly', 'detectAssessmentBtn', 'realAnswerField', 'realAnswer', 'realFallbackField', 'realFallback',
      'skipLearnedField', 'skipLearned', 'skipLearnedMin',
      'skipAnsweredField', 'skipAnswered',
      'oneClickHint',
      'scorePanel', 'scoreItems', 'scoreHint', 'scoreTotal', 'scoreListening', 'scoreCorrect', 'scoreTime', 'scoreProgress', 'scoreWriting', 'scoreUpdated', 'scoreRefreshBtn',
      'maintenanceBanner', 'maintenanceText', 'maintenanceUnlockBtn',
      'announcementTicker', 'announcementTickerText',
      'targetText', 'progressFill', 'progressText', 'startBtn', 'stopBtn',
      'oneClickBtn', 'etaText', 'runTip', 'viewCookieBtn', 'cookieTitle',
      'autoScroll', 'exportLogBtn', 'clearLogBtn', 'logBox', 'statusLine', 'consoleEl',
      'loginError', 'mobileLog', 'mobileLogBtn', 'mobileLogStatus', 'mobileLogLast', 'mobileStopBtn',
      'countdownCard', 'countdownPhase', 'countdownTime', 'countdownFill', 'countdownMeta',
      'countdownStopBtn', 'countdownHideBtn', 'countdownMinBtn', 'countdownPill', 'countdownPillTime', 'countdownWait', 'countdownLabel',
      'serverLoadBadge', 'serverLoadText',
      'queueCard', 'queuePosition', 'queueText', 'queueCancelBtn',
      'doneModal', 'donePanel', 'doneIcon', 'doneTitle', 'doneSub', 'doneBody', 'doneLogBtn',
      'logModal', 'logSheet', 'logModalStatus', 'logSheetExport', 'logSheetClear',
      'helpModal', 'announceModal', 'announceText', 'announceBtn',
      'cookieModal', 'cookieList', 'toasts'
    ].forEach(function (id) { ui[id] = $(id); });
  }

  function wire() {
    if (ui.mobileLogBtn) ui.mobileLogBtn.addEventListener('click', openLogSheet);
    if (ui.logSheetExport) ui.logSheetExport.addEventListener('click', exportLog);
    if (ui.logSheetClear) ui.logSheetClear.addEventListener('click', clearLogs);
    if (ui.countdownStopBtn) ui.countdownStopBtn.addEventListener('click', stopTask);
    if (ui.countdownMinBtn) ui.countdownMinBtn.addEventListener('click', minimizeCountdown);
    if (ui.countdownHideBtn) ui.countdownHideBtn.addEventListener('click', minimizeCountdown);
    if (ui.countdownPill) ui.countdownPill.addEventListener('click', expandCountdown);
    if (ui.queueCancelBtn) ui.queueCancelBtn.addEventListener('click', cancelQueue);
    if (ui.sequentialTime) {
      ui.sequentialTime.addEventListener('change', function () {
        if (!state.debugUnlocked) {
          ui.sequentialTime.checked = true;
          return;
        }
        if (ui.concurrency) ui.concurrency.disabled = state.mode === 'time' && ui.sequentialTime.checked;
        addLog(ui.sequentialTime.checked
          ? '顺序模式已开启：时长并发锁定 1，章间随机停 3–10 秒。'
          : '顺序模式已关闭：将使用上面的并发数。', 'info');
      });
    }
    if (ui.totalUnit) {
      ui.totalUnit.addEventListener('change', function () {
        scheduleSave();
        if (ui.totalMode && ui.totalMode.checked) previewTotalPlan();
      });
    }
    if (ui.saveCredential) {
      ui.saveCredential.addEventListener('change', function () {
        state.credentialsSaved = !!ui.saveCredential.checked;
        try {
          if (state.credentialsSaved) localStorage.setItem('wl_saved_cred', '1');
          else localStorage.removeItem('wl_saved_cred');
        } catch (e) { /* ignore */ }
        refreshControls();
      });
    }
    if (ui.realAnswer) {
      ui.realAnswer.addEventListener('change', function () {
        syncRealAnswerUI();
        scheduleSave();
      });
    }
    if (ui.totalMode) {
      ui.totalMode.addEventListener('change', function () {
        syncTotalMode();
        if (ui.totalMode.checked && ui.paramInput) ui.paramInput.focus();
      });
    }
    if (ui.totalPresets) {
      $$('.chip[data-total]', ui.totalPresets).forEach(function (btn) {
        btn.addEventListener('click', function () {
          if (ui.paramInput) {
            ui.paramInput.value = btn.getAttribute('data-total');
            if (ui.totalUnit) ui.totalUnit.value = btn.getAttribute('data-unit') || 'sec';
            ui.paramInput.focus();
            previewTotalPlan();
          }
        });
      });
    }
    if (ui.totalPreviewBtn) {
      ui.totalPreviewBtn.addEventListener('click', toggleReverseMatch);
    }
    if (ui.resumeContinue) {
      ui.resumeContinue.addEventListener('click', function () {
        closeModal('resumeModal');
        startTask(true, 'continue');
      });
    }
    if (ui.resumeRestart) {
      ui.resumeRestart.addEventListener('click', function () {
        closeModal('resumeModal');
        startTask(true, 'restart');
      });
    }
    if (ui.debugUnlockBtn) ui.debugUnlockBtn.addEventListener('click', openDebugModal);
    if (ui.maintenanceUnlockBtn) ui.maintenanceUnlockBtn.addEventListener('click', openDebugModal);
    if (ui.detectAssessmentBtn) ui.detectAssessmentBtn.addEventListener('click', detectAssessment);
    if (ui.scoreRefreshBtn) ui.scoreRefreshBtn.addEventListener('click', function () { Server.refreshScore(true); });
    if (ui.debugSubmitBtn) ui.debugSubmitBtn.addEventListener('click', submitDebugUnlock);
    if (ui.debugPassword) {
      ui.debugPassword.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') submitDebugUnlock();
      });
    }
    if (ui.doneLogBtn) {
      ui.doneLogBtn.addEventListener('click', function () {
        closeModal('doneModal');
        openLogSheet();
      });
    }

    if (ui.themeBtn) {
      ui.themeBtn.addEventListener('click', function () {
        applyTheme(readTheme() === 'dark' ? 'light' : 'dark', true);
      });
    }

    if (ui.helpBtn) ui.helpBtn.addEventListener('click', function () { openModal('helpModal'); });

    $$('[data-close]').forEach(function (btn) {
      btn.addEventListener('click', function () { closeModal(btn.getAttribute('data-close')); });
    });

    $$('.modal').forEach(function (modal) {
      modal.addEventListener('mousedown', function (e) {
        if (e.target === modal && modal.id !== 'announceModal') closeModal(modal.id);
      });
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      var open = $$('.modal').filter(function (m) { return !m.hidden; });
      var last = open[open.length - 1];
      if (last && last.id !== 'announceModal') closeModal(last.id);
    });

    $$('.tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        if (tab.disabled) return;
        clearFormError();
        var name = tab.getAttribute('data-tab');
        $$('.tab').forEach(function (t) {
          var active = t === tab;
          t.classList.toggle('is-active', active);
          t.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        if ($('accountPane')) $('accountPane').hidden = name !== 'account';
        if ($('cookiePane')) $('cookiePane').hidden = name !== 'cookie';
      });
    });

    if (ui.togglePwd) {
      ui.togglePwd.addEventListener('click', function () {
        var isPassword = ui.password.type === 'password';
        ui.password.type = isPassword ? 'text' : 'password';
        ui.togglePwd.setAttribute('aria-label', isPassword ? '隐藏密码' : '显示密码');
        ui.password.focus();
      });
    }

    if (ui.loginBtn) ui.loginBtn.addEventListener('click', function () { doAccountLogin(); });
    if (ui.cookieBtn) ui.cookieBtn.addEventListener('click', function () { doCookieLogin(); });
    if (ui.formatCookieBtn) ui.formatCookieBtn.addEventListener('click', formatCookieInput);
    if (ui.splitCookieBtn) ui.splitCookieBtn.addEventListener('click', openCookieModal);
    if (ui.logoutBtn) ui.logoutBtn.addEventListener('click', logout);

    [ui.username, ui.password, ui.cookieInput].forEach(function (el) {
      if (el) el.addEventListener('input', clearFormError);
    });

    if (ui.password) {
      ui.password.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') doAccountLogin();
      });
    }

    if (ui.refreshBtn) ui.refreshBtn.addEventListener('click', function () { refreshAll(true); });

    if (ui.courseSelect) {
      ui.courseSelect.addEventListener('change', function () {
        var cid = ui.courseSelect.value;
        var course = null;
        for (var i = 0; i < state.courses.length; i++) {
          if (String(state.courses[i].cid) === String(cid)) { course = state.courses[i]; break; }
        }
        if (course) selectCourse(course);
      });
    }

    if (ui.allUnits) {
      ui.allUnits.addEventListener('change', function () {
        syncAllUnits();
        scheduleSave();
      });
    }

    $$('.seg[data-mode]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!btn.disabled) setMode(btn.getAttribute('data-mode'));
      });
    });

    if (ui.paramInput) {
      ui.paramInput.addEventListener('input', function () {
        updateTarget();
        scheduleSave();
      });
    }

    if (ui.startBtn) ui.startBtn.addEventListener('click', function () { startTask(false); });
    if (ui.oneClickBtn) ui.oneClickBtn.addEventListener('click', function () { startTask(true); });
    if (ui.stopBtn) ui.stopBtn.addEventListener('click', stopTask);
    if (ui.mobileStopBtn) ui.mobileStopBtn.addEventListener('click', stopTask);
    if (ui.viewCookieBtn) ui.viewCookieBtn.addEventListener('click', viewCookie);

    if (ui.clearLogBtn) ui.clearLogBtn.addEventListener('click', clearLogs);
    if (ui.exportLogBtn) ui.exportLogBtn.addEventListener('click', exportLog);

    if (ui.autoScroll) {
      ui.autoScroll.addEventListener('change', function () {
        if (ui.autoScroll.checked) ui.logBox.scrollTop = ui.logBox.scrollHeight;
      });
    }

    if (ui.unitTree) {
      // 展开收起后保持滚动位置由浏览器处理
      ui.unitTree.addEventListener('scroll', function () { /* 预留 */ });
    }

    window.addEventListener('unhandledrejection', function (e) {
      var reason = e && e.reason;
      addLog('未处理的异常：' + (reason && reason.message ? reason.message : String(reason)), 'err');
    });

    /* 运行中关闭页面时提示，避免用户误关导致任务中断 */
    window.addEventListener('beforeunload', function (e) {
      if (!state.running) return;
      e.preventDefault();
      e.returnValue = '任务正在运行，关闭页面会中断，确定离开吗？';
      return e.returnValue;
    });

    window.addEventListener('pagehide', function () {
      if (state.loggedIn) saveSession();
      if (Server.enabled && (state.running || state.queuing)) Server.releaseSlot(true);
    });

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && state.running) requestWakeLock();
    });
  }

  /* ==========================================================
   * 14. 启动
   * ========================================================== */
  /* 桌面端：右栏高度对齐左栏，日志在控制台内部滚动，底部与单元目录齐平 */
  function syncStageHeight() {
    var stage = ui.stage;
    var rail = ui.rail;
    if (!stage || !rail) return;
    if (!window.matchMedia || !window.matchMedia('(min-width: 1081px)').matches) {
      stage.style.height = '';
      return;
    }
    var gap = 14;
    var minConsole = 360;
    var paramsH = ui.taskCard ? ui.taskCard.offsetHeight : 0;
    var runbarH = ui.runBar ? ui.runBar.offsetHeight : 0;
    var needed = paramsH + runbarH + gap * 2 + minConsole;
    stage.style.height = Math.max(rail.offsetHeight, needed) + 'px';
  }

  function setupStageSync() {
    syncStageHeight();
    if (window.ResizeObserver) {
      var ro = new ResizeObserver(function () { syncStageHeight(); });
      [ui.rail, ui.taskCard, ui.runBar].forEach(function (el) {
        if (el) ro.observe(el);
      });
    }
    window.addEventListener('resize', syncStageHeight);
    $$('details.advanced').forEach(function (details) {
      details.addEventListener('toggle', syncStageHeight);
    });
  }

  async function boot() {
    cacheDom();
    state.credentialsSaved = readSavedCredentialFlag();
    if (ui.saveCredential) ui.saveCredential.checked = state.credentialsSaved;
    applyTheme(readTheme(), false);
    watchSystemTheme();
    wire();
    setDebugLocked(true);

    setStatus('待命');
    setMode('accuracy', true);
    renderCourses();
    renderUnits();
    updateTarget();
    setProgress(0, 0);
    refreshControls();
    addLog('Welearn Helper Web 控制台 v' + VERSION + '（构建 ' + BUILD_ID + '）已就绪。', 'dim');

    // CDN / 浏览器缓存导致页面与脚本版本不一致时，给出明确提示
    var pageBuild = document.querySelector('meta[name="wl-build"]');
    if (pageBuild && pageBuild.getAttribute('content') !== BUILD_ID) {
      addLog('页面版本（' + pageBuild.getAttribute('content') + '）与脚本版本（' + BUILD_ID +
        '）不一致，若界面异常请强制刷新或清理 CDN 缓存。', 'warn');
    }

    addLog('提示：登录后选择课程与单元，设置参数即可开始。', 'dim');

    setupStageSync();
    await restoreDebugToken();
    await checkMaintenance();
    if (!state.maintenance || state.debugUnlocked) {
      await restoreSession();
    }
    Server.init();
    await Server.checkSession();
    if (state.maintenanceTimer) clearInterval(state.maintenanceTimer);
    state.maintenanceTimer = setInterval(checkMaintenance, 30000);
    syncStageHeight();
  }

  /* 测试钩子：仅暴露纯函数，不影响页面逻辑 */
  if (typeof globalThis !== 'undefined') {
    globalThis.__WL_DEBUG__ = {
      version: VERSION,
      build: BUILD,
      buildId: BUILD_ID,
      parseParam: parseParam,
      parseTotalDuration: parseTotalDuration,
      parseTotalDurationWithUnit: parseTotalDurationWithUnit,
      allocateDuration: allocateDuration,
      parseLearnedTime: parseLearnedTime,
      isAssessmentText: isAssessmentText,
      coursewareDataUrl: coursewareDataUrl,
      buildScoDataFromAnswers: buildScoDataFromAnswers,
      buildNoInteractionData: buildNoInteractionData,
      parseCmi: parseCmi,
      parseCookieString: parseCookieString,
      upgradeUpstreamUrl: upgradeUpstreamUrl,
      oneClickDefaults: ONE_CLICK,
      Semaphore: Semaphore,
      state: state
    };
  }

  boot();

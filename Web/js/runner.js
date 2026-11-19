'use strict';

/* ============================================================
 * 任务执行引擎：Runner / Job / SCO 协议
 * ============================================================ */

  /* ==========================================================
   * 8. 任务执行引擎
   * ========================================================== */
  function Runner(opts) {
    this.mode = opts.mode;
    this.param = opts.param;
    this.totalDuration = Math.max(0, Number(opts.totalDuration) || 0);
    this.assessmentOnly = !!opts.assessmentOnly;
    this.realAnswer = !!opts.realAnswer;
    this.realAnswerFallback = opts.realAnswerFallback || 'skip';
    this.accuracyParam = opts.accuracyParam || null;
    this.skipLearnedSeconds = Math.max(0, Number(opts.skipLearnedSeconds) || 0);
    this.skipAnswered = !!opts.skipAnswered;
    this.oneClick = opts.oneClick || null;
    this.skipOneClickDone = !!opts.skipOneClickDone;
    this.skipped = 0;
    this.durationPlan = null;
    this.avgPer = 0;
    this.targets = opts.targets;
    this.course = opts.course;
    this.meta = opts.meta;
    this.units = opts.units;
    this.skipDone = !!opts.skipDone;
    this.unfinished = [];
    this.concurrency = Math.max(1, Math.min(50, Number(opts.concurrency) || 10));
    this.onLog = opts.onLog;
    this.onProgress = opts.onProgress;
    this.onStatus = opts.onStatus;

    this.stopped = false;
    this._stopResolve = null;
    this._stopPromise = new Promise(function (resolve) { this._stopResolve = resolve; }.bind(this));

    this.done = 0;
    this.total = 0;
    this.way1 = { ok: 0, fail: 0 };
    this.way2 = { ok: 0, fail: 0 };
    this.ok = 0;
    this.failed = 0;
    this.errors = [];
    this.creditedSeconds = 0;   // 已成功提交给服务器的有效时长（秒）
    this.creditedChapters = 0;  // 已成功提交时长的章节数
    this.requestStats = { starts: 0, gets: 0, keeps: 0, saves: 0, updates: 0, errors: 0 };
    this.startedAt = Date.now();
    this.activeDeadlines = {};   // chapterId -> 结束时间戳，用于运行中剩余时间显示
  }

  Runner.prototype.log = function (msg, level) { this.onLog(msg, level); };

  Runner.prototype.stop = function () {
    if (this.stopped) return;
    this.stopped = true;
    if (this._stopResolve) this._stopResolve();
  };

  /* 供运行条 / 手机日志条显示：已运行、当前批次最长剩余、进行中章节数
   * 估算用“并发时间线”而不是简单轮数：
   * - 启动错峰/信号量排队的章节先按并发位预约，避免被重复算进 pending；
   * - 每个待处理章节落到最早空闲的并发位，能正确处理最后一轮不满、连续补位。 */
  Runner.prototype.getRuntimeInfo = function () {
    var now = Date.now();
    var remaining = 0;
    var active = 0;
    var deadlines = [];
    Object.keys(this.activeDeadlines).forEach(function (key) {
      var left = this.activeDeadlines[key] - now;
      if (left > 0) {
        active++;
        deadlines.push(left);
        if (left > remaining) remaining = left;
      }
    }, this);

    var per;
    if (this.mode === 'time' || this.mode === 'mixed') {
      var avg = this.avgPer > 0
        ? this.avgPer
        : (this.param.type === 'range' ? (this.param.min + this.param.max) / 2 : this.param.value);
      // 混合模式每节 = 分配时长 + 正确率请求/收尾开销
      per = Math.max(1, Number(avg) || 0) + 4;
    } else {
      per = 3.3;
    }

    var leftChapters = Math.max(0, this.total - this.done);
    var slotCount = this.mode === 'time' ? this.concurrency : 1;
    var effectiveActive = Math.min(Math.max(1, slotCount), leftChapters);
    var pending = Math.max(0, leftChapters - effectiveActive);
    var slots = [];

    // 已经在真实等待的章节，用真实 deadline
    for (var i = 0; i < deadlines.length && slots.length < effectiveActive; i++) {
      slots.push(now + deadlines[i]);
    }
    // 还没进入等待的并发位：按一个平均章节时长预约，防止重复计入 pending
    while (slots.length < effectiveActive) {
      slots.push(now + per * 1000);
    }

    // 剩余章节落到最早空闲的并发位
    for (var p = 0; p < pending; p++) {
      var minIndex = 0;
      for (var k = 1; k < slots.length; k++) {
        if (slots[k] < slots[minIndex]) minIndex = k;
      }
      slots[minIndex] += per * 1000;
    }

    var finishAt = slots.length ? Math.max.apply(null, slots) : now;
    var estimate = this.total ? Math.max(0, Math.ceil((finishAt - now) / 1000)) : 0;

    return {
      elapsed: Math.floor((now - this.startedAt) / 1000),
      remaining: Math.ceil(remaining / 1000),
      estimate: estimate,
      active: active,
      done: this.done,
      total: this.total
    };
  };

  /* 可中断等待：停止时立即返回 false */
  Runner.prototype.sleep = function (ms) {
    if (this.stopped) return Promise.resolve(false);
    if (!ms) return Promise.resolve(true);
    var timer;
    var wait = new Promise(function (resolve) { timer = setTimeout(function () { resolve(true); }, ms); });
    return Promise.race([wait, this._stopPromise.then(function () { return false; })]).then(function (value) {
      if (!value) clearTimeout(timer);
      return value;
    });
  };

  Runner.prototype.emitProgress = function () {
    if (this.onProgress) this.onProgress(this.done, this.total);
  };

  Runner.prototype.pickValue = function () {
    if (this.param.type === 'range') return randInt(this.param.min, this.param.max);
    return this.param.value;
  };

  Runner.prototype.collect = async function () {
    var plans = [];
    for (var i = 0; i < this.targets.unitNos.length; i++) {
      if (this.stopped) break;
      var no = this.targets.unitNos[i];
      var unit = this.units[no - 1];
      if (!unit) continue;

      this.onStatus('读取单元 ' + no + ' 的章节…');
      var chapters;
      try {
        // 已在小节树里加载过就直接复用，避免重复请求
        // 时长任务开始前强制刷新一次小节数据，避免使用登录时缓存的旧“已学时长”
        if (this.mode === 'time' || this.mode === 'mixed' || this.skipLearnedSeconds > 0) {
          this.log('刷新 Unit ' + no + ' 最新学习时长…', 'dim');
          chapters = await fetchSections(no);
        } else {
          chapters = state.sections[no] || await fetchSections(no);
        }
        state.sections[no] = chapters;
      } catch (e) {
        this.log('[!] 单元 ' + no + ' 不可用，已跳过：' + e.message, 'warn');
        continue;
      }

      var wanted = this.targets.sections && this.targets.sections[no];
      var picked = chapters;
      if (wanted && wanted.length) {
        picked = chapters.filter(function (ch) { return wanted.indexOf(ch.index) !== -1; });
      }
      var name = String(unit.unitname || '') + ' ' + String(unit.name || '');
      name = name.trim() || ('单元 ' + no);

      if (this.assessmentOnly) {
        var before = picked.length;
        picked = picked.filter(function (ch) { return ch.isAssessment !== false; });
        this.log('考核过滤 · ' + name + '：保留 ' + picked.length + ' / ' + before + ' 个章节', 'dim');
      }

      if (!picked.length) {
        this.log('[!] 单元 ' + no + ' 没有匹配的小节，已跳过', 'warn');
        continue;
      }
      plans.push({ no: no, name: name, chapters: picked });
      this.log('单元 ' + no + ' · ' + name + '：' + picked.length + ' 个章节');
    }
    return plans;
  };

  Runner.prototype.run = async function () {
    var plans = await this.collect();
    if (this.stopped) return this.summary();
    if (!plans.length) throw new Error('没有可处理的章节，请检查单元 / 小节选择');

    if (this.mode === 'accuracy') {
      await this.runAccuracy(plans);
    } else if (this.mode === 'mixed') {
      await this.runMixed(plans);
    } else {
      await this.runTime(plans);
    }
    return this.summary();
  };

  Runner.prototype.summary = function () {
    if (this.mode === 'accuracy') {
      return {
        mode: 'accuracy', done: this.done, total: this.total,
        way1: this.way1, way2: this.way2, stopped: this.stopped,
        creditedSeconds: 0, creditedChapters: 0,
        elapsed: Math.floor((Date.now() - this.startedAt) / 1000),
        concurrency: this.concurrency, skipped: this.skipped, requestStats: this.requestStats,
        unfinished: this.unfinished.slice()
      };
    }

    if (this.mode === 'mixed') {
      return {
        mode: 'mixed', done: this.done, total: this.total,
        ok: this.ok, failed: this.failed, errors: this.errors.slice(),
        way1: this.way1, way2: this.way2, stopped: this.stopped,
        creditedSeconds: Math.round(this.creditedSeconds),
        creditedChapters: this.creditedChapters,
        elapsed: Math.floor((Date.now() - this.startedAt) / 1000),
        concurrency: 1, skipped: this.skipped, requestStats: this.requestStats,
        unfinished: this.unfinished.slice()
      };
    }
    return {
      mode: 'time', done: this.done, total: this.total,
      ok: this.ok, failed: this.failed, errors: this.errors.slice(), stopped: this.stopped,
      creditedSeconds: Math.round(this.creditedSeconds),
      creditedChapters: this.creditedChapters,
      elapsed: Math.floor((Date.now() - this.startedAt) / 1000),
      concurrency: this.concurrency, skipped: this.skipped, requestStats: this.requestStats,
      unfinished: []
    };
  };

  /* ---- 正确率 ---- */
  Runner.prototype.runAccuracy = async function (plans) {
    this.total = plans.reduce(function (n, p) { return n + p.chapters.length; }, 0);
    this.emitProgress();

    for (var i = 0; i < plans.length; i++) {
      if (this.stopped) break;
      var plan = plans[i];
      this.onStatus('正确率 · 单元 ' + plan.no + '：' + plan.name);

      for (var j = 0; j < plan.chapters.length; j++) {
        if (this.stopped) break;
        var chapter = plan.chapters[j];
        try {
          await this.stepAccuracy(plan, chapter);
        } finally {
          this.done++;
          this.emitProgress();
        }
      }
    }
    this.collectUnfinished(plans);
    this.reportUnfinished();
    if (this.stopped) this.log('正确率流程已手动终止。', 'warn');
  };

  Runner.prototype.updateCmiTime = async function (base, seconds, referer) {
    this.requestStats.updates++;
    try {
      var res = await postSco(Object.assign({}, base, {
        action: 'updatecmitime',
        total_time: String(seconds),
        session_time: String(seconds)
      }), referer);
      if (!hasRet0(res)) this.log('updatecmitime 未确认：' + String(res).slice(0, 100), 'warn');
    } catch (e) {
      this.log('updatecmitime 失败：' + e.message, 'warn');
    }
  };

  Runner.prototype.fetchCoursewareAnswers = async function (chapter) {
    var cid = this.course.cid;
    var scoid = chapter.id;
    var referer = 'https://welearn.sflep.com/Student/StudyCourse.aspx?cid=' + cid +
      '&classid=' + this.meta.classid + '&sco=' + scoid;

    var addrRes = await postSco({
      action: 'scoAddr', cid: cid, scoid: scoid, uid: this.meta.uid
    }, referer);
    var addr = '';
    try { addr = JSON.parse(addrRes).addr || ''; } catch (e) { addr = ''; }
    var dataUrl = coursewareDataUrl(addr);
    if (!dataUrl) throw new Error('未解析到课程内容地址');

    var res = await net.call(dataUrl, { headers: { Referer: 'https://welearn.sflep.com/' } });
    var html = String(res.body || '');
    if (!html) throw new Error('课程内容为空');

    var doc = new DOMParser().parseFromString(html, 'text/html');
    var hasRecording = !!doc.querySelector('et-recorder, et-talk, et-follow-me');
    var hasQuestion = !!doc.querySelector(
      'et-blank, et-multi-blank, et-choice, et-tof, et-select, et-matching, et-sort, et-tick-list, et-crossword, et-mark, et-score-table'
    );
    // 阅读 / 听力 / 视频 / 口语跟读等没有计分题的小节：
    // 即使带 et-talk / et-recorder，也按“无题内容”提交原生空 interactions 自动完成。
    if (!hasQuestion) {
      this.log(chapter.location + '：无计分题内容，自动完成', 'dim');
      return { answers: [], noInteraction: true, hasRecording: false };
    }
    if (hasRecording) {
      this.log(chapter.location + '：含录音题且混合计分题，交由异常策略处理', 'warn');
      return { answers: [], noInteraction: false, hasRecording: true };
    }
    var hasWeb = !!doc.querySelector('et-web-only');
    function choiceValue(key) {
      var raw = String(key || '').split(',')[0].trim();
      if (/^\d+$/.test(raw)) return 'choice' + raw;
      var letter = raw.toUpperCase().match(/[A-Z]/);
      return letter ? 'choice' + (letter[0].charCodeAt(0) - 64) : '';
    }
    var nodes = Array.from(doc.querySelectorAll('et-blank, et-choice, et-tof, et-select'));
    var answers = nodes.filter(function (el) {
      return !hasWeb || !el.closest('et-mobile-only');
    }).map(function (el) {
      var tag = el.tagName.toLowerCase();
      if (tag === 'et-blank') {
        return {
          text: String(el.textContent || '').split('|')[0].trim(),
          type: 'fill_in'
        };
      }
      if (tag === 'et-choice') {
        var key = el.getAttribute('key') || '';
        return { text: choiceValue(key), type: 'multiple_choice' };
      }
      if (tag === 'et-select') {
        var selectKey = el.getAttribute('key') || '';
        return { text: choiceValue(selectKey), type: 'multiple_choice' };
      }
      if (tag === 'et-tof') {
        var tofKey = String(el.getAttribute('key') || '').toLowerCase();
        if (tofKey === 't' || tofKey === 'true' || tofKey === '1') return { text: 'true', type: 'true_false' };
        if (tofKey === 'f' || tofKey === 'false' || tofKey === '0') return { text: 'false', type: 'true_false' };
      }
      return null;
    }).filter(function (item) { return item && item.text; });

    if (!answers.length) {
      Array.from(doc.querySelectorAll('[data-solution]')).forEach(function (el) {
        var v = String(el.getAttribute('data-solution') || '').split('|')[0].trim();
        if (!v) return;
        answers.push({
          text: v,
          type: (el.tagName === 'LI' || el.tagName === 'OPTION') ? 'multiple_choice' : 'fill_in'
        });
      });
    }

    this.log(chapter.location + '：解析到 ' + answers.length + ' 个答案', answers.length ? 'dim' : 'warn');
    return { answers: answers, noInteraction: false, hasRecording: false };
  };

  Runner.prototype.stepAccuracy = async function (plan, chapter) {
    if (!chapter.visible) {
      this.log('[跳过] 未开放：' + chapter.location, 'skip');
      return;
    }
    if (this.skipDone && chapter.done) {
      this.log('[跳过] 已完成：' + chapter.location, 'skip');
      return;
    }
    if (this.skipAnswered && chapter.hasAnswer) {
      this.skipped++;
      this.log('[跳过] 已有答题记录' + (chapter.crate ? '（' + chapter.crate + '%）' : '') + '：' + chapter.location, 'skip');
      return;
    }

    // 正确率区间是参考范围：取上限（96–100 直接按 100 提交）；固定值仍按目标，
    // 题目数量不足以精确命中时，buildScoDataFromAnswers 的 ceil 会自动取 100。
    var ap = this.accuracyParam || this.param;
    var crate = String(ap.type === 'range' ? ap.max : ap.value);
    var cid = this.course.cid;
    var scoid = chapter.id;
    var base = { uid: this.meta.uid, cid: cid, scoid: scoid };
    var referer = 'https://welearn.sflep.com/Student/StudyCourse.aspx?cid=' + cid +
      '&classid=' + this.meta.classid + '&sco=' + scoid;
    var legacy = !this.realAnswer;
    var data = legacy ? SCO_DATA_TEMPLATE.replace('{crate}', crate) : '';
    var fallback = this.realAnswerFallback || 'skip';

    this.log('▶ ' + chapter.location + ' → 目标 ' + crate + '%' +
      (this.realAnswer ? '（真实答案）' : ''));

    try {
      if (this.realAnswer) {
        try {
          var parsed = await this.fetchCoursewareAnswers(chapter);
          if (parsed.noInteraction) {
            if (fallback === 'legacy') {
              legacy = true;
              data = SCO_DATA_TEMPLATE.replace('{crate}', crate);
              this.log(chapter.location + '：无题内容，按旧方法提交 ' + crate + '%', 'dim');
            } else {
              data = buildNoInteractionData();
              this.log(chapter.location + '：无题内容，提交空 interactions 完成状态', 'dim');
            }
          } else if (parsed.hasRecording) {
            var recErr = new Error('包含录音 / 口语题，无法自动填写真实答案');
            recErr.category = '录音/口语题';
            throw recErr;
          } else if (!parsed.answers.length) {
            var ansErr = new Error('未解析到题目答案');
            ansErr.category = '无答案/无法解析题型';
            throw ansErr;
          } else {
            data = buildScoDataFromAnswers(parsed.answers, Number(crate), scoid);
          }
        } catch (e) {
          if (fallback === 'legacy') {
            legacy = true;
            data = SCO_DATA_TEMPLATE.replace('{crate}', crate);
            this.log('[回退] 真实答案不可用，改用旧方法提交：' + chapter.location, 'warn');
          } else {
            this.skipped++;
            this.addUnfinished(chapter, e.category || '正确率未提交', e.message);
            this.log('[不提交] ' + chapter.location + '：' + e.message, 'warn');
            return;
          }
        }
      }

      if (!(await this.sleep(1000))) return;
      this.requestStats.starts++;
      await postSco(Object.assign({}, base, {
        action: 'startsco160928', classid: this.meta.classid, tid: '-1'
      }), referer);

      async function submit(payload, isLegacy) {
        if (!(await this.sleep(1000))) return null;
        this.requestStats.saves++;
        var w1 = await postSco(Object.assign({}, base, {
          action: 'setscoinfo', data: payload, isend: 'false'
        }), referer);
        if (!(await this.sleep(1000))) return null;
        this.requestStats.saves++;
        var w2 = await postSco(Object.assign({}, base, {
          action: 'savescoinfo160928',
          progress: isLegacy ? '100' : '1',
          crate: isLegacy ? crate : '',
          status: 'unknown',
          cstatus: 'completed',
          trycount: '0',
          endcaltime: 'false'
        }), referer);
        return { way1: w1, way2: w2 };
      }

      var result = null;
      try {
        result = await submit.call(this, data, legacy);
      } catch (e) {
        this.log('提交异常：' + e.message, 'warn');
      }

      var ok1 = result ? hasRet0(result.way1) : false;
      var ok2 = result ? hasRet0(result.way2) : false;

      if ((!ok1 || !ok2) && !legacy && fallback === 'legacy') {
        this.log('[回退] 真实答案提交未确认，改用旧方法重试：' + chapter.location, 'warn');
        try {
          result = await submit.call(this, SCO_DATA_TEMPLATE.replace('{crate}', crate), true);
          legacy = true;
          ok1 = result ? hasRet0(result.way1) : false;
          ok2 = result ? hasRet0(result.way2) : false;
        } catch (e) {
          this.log('旧方法提交异常：' + e.message, 'warn');
        }
      }

      if ((!ok1 || !ok2) && !legacy && fallback === 'skip') {
        this.skipped++;
        this.addUnfinished(chapter, '提交未确认', '真实答案提交未被服务端确认');
        this.log('[不提交] ' + chapter.location + ' 提交未确认，已跳过', 'warn');
        return;
      }

      if (ok1) this.way1.ok++; else this.way1.fail++;
      if (ok2) this.way2.ok++; else this.way2.fail++;

      if (ok2) {
        await this.updateCmiTime(base, scoSeconds(result.way2), referer);
      }

      if (ok1 && ok2) {
        chapter.done = true;
        chapter.crate = crate;
        this.log('✔ ' + chapter.location + ' 提交成功（' + crate + '%' + (legacy ? '，旧方法' : '') + '）', 'ok');
      } else {
        this.addUnfinished(chapter, '提交未确认', '方式1' + (ok1 ? '成功' : '失败') + ' / 方式2' + (ok2 ? '成功' : '失败'));
        this.log('✘ ' + chapter.location + ' 未被服务端确认（方式1 ' + (ok1 ? '成功' : '失败') +
          ' / 方式2 ' + (ok2 ? '成功' : '失败') + '）', 'err');
      }
    } catch (e) {
      this.way1.fail++;
      this.way2.fail++;
      this.addUnfinished(chapter, '提交异常', e.message);
      this.log('✘ ' + chapter.location + ' 提交异常：' + e.message, 'err');
    }
  };

  Runner.prototype.addUnfinished = function (chapter, category, reason) {
    if (!chapter) return;
    var location = chapter.location || '未命名小节';
    for (var i = 0; i < this.unfinished.length; i++) {
      if (this.unfinished[i].location === location) return;
    }
    this.unfinished.push({
      location: location,
      category: category || '正确率未完成',
      reason: reason || ''
    });
  };

  Runner.prototype.collectUnfinished = function (plans) {
    var self = this;
    var known = {};
    this.unfinished.forEach(function (item) { known[item.location] = true; });
    plans.forEach(function (plan) {
      plan.chapters.forEach(function (ch) {
        if (!ch.visible || !ch.isAssessment) return;
        if (ch.done || ch.hasAnswer) return;
        if (known[ch.location]) return;
        self.addUnfinished(ch, '未完成考核', '任务结束时仍未完成');
      });
    });
  };

  Runner.prototype.reportUnfinished = function () {
    var self = this;
    if (!this.unfinished.length) {
      this.log('未完成考核：无', 'dim');
      return;
    }
    var groups = {};
    this.unfinished.forEach(function (item) {
      if (!groups[item.category]) groups[item.category] = [];
      groups[item.category].push(item);
    });
    this.log('──────── 未完成考核 ' + this.unfinished.length + ' 个 ────────', 'warn');
    Object.keys(groups).forEach(function (category) {
      var list = groups[category];
      self.log('【' + category + '】' + list.length + ' 个', 'warn');
      list.forEach(function (item) {
        self.log('  ' + item.location + (item.reason ? '：' + item.reason : ''), 'warn');
      });
    });
  };

  /* ---- 混合模式：先等时长，再刷同一小节正确率，顺序逐节 ---- */
  Runner.prototype.runMixed = async function (plans) {
    var self = this;
    var queue = [];
    var hidden = 0;

    plans.forEach(function (plan) {
      plan.chapters.forEach(function (ch) {
        if (!ch.visible) { hidden++; return; }
        if (self.skipOneClickDone && ch.oneClickDone && (ch.done || ch.hasAnswer)) {
          self.skipped++;
          self.done++;
          self.log('[跳过] 混合模式已刷过：' + ch.location, 'skip');
          return;
        }
        if (self.skipDone && ch.done) {
          self.skipped++;
          self.done++;
          self.log('[跳过] 已完成：' + ch.location, 'skip');
          return;
        }
        queue.push({ plan: plan, chapter: ch });
      });
    });

    this.total = queue.length + hidden + this.skipped;
    this.done = hidden + this.skipped;
    this.emitProgress();
    if (hidden) this.log('已跳过 ' + hidden + ' 个未开放小节', 'dim');
    if (!queue.length) return;

    if (this.totalDuration) {
      var alloc = allocateDuration(this.totalDuration, queue.length);
      this.durationPlan = {};
      var minAlloc = 900;
      var maxAlloc = 0;
      queue.forEach(function (item, i) {
        this.durationPlan[item.chapter.id] = alloc[i];
        if (alloc[i] < minAlloc) minAlloc = alloc[i];
        if (alloc[i] > maxAlloc) maxAlloc = alloc[i];
      }, this);
      this.avgPer = this.totalDuration / queue.length;
      this.log('🎯 混合模式总时长 ' + fmtDuration(this.totalDuration) + '：按 ' + queue.length +
        ' 个小节分配，单节 ' + minAlloc + '–' + maxAlloc + ' 秒；每节先等时长再刷正确率。', 'info');
    }

    this.startedAt = this.startedAt || Date.now();
    this.log('🔀 混合模式开始：共 ' + queue.length + ' 个小节，逐节执行「时长 → 正确率」。', 'info');

    for (var i = 0; i < queue.length; i++) {
      if (this.stopped) break;
      var plan = queue[i].plan;
      var chapter = queue[i].chapter;
      this.currentChapter = chapter;
      this.onStatus('混合 · ' + chapter.location);

      var learnedMinutes = Math.round(Number(chapter.learned || 0) / 60);
      var skipMinutes = Math.round(this.skipLearnedSeconds / 60);
      var skipTime = this.skipLearnedSeconds > 0 && learnedMinutes >= skipMinutes;
      var timeOk = true;
      if (skipTime) {
        chapter.mixedCredited = chapter.learned;
        chapter.mixedTarget = this.oneClick ? this.durationFor(chapter) : 0;
        this.log('[跳过时长] 已学 ' + fmtDuration(chapter.learned) + '：' + chapter.location, 'skip');
      } else {
        try {
          await this.simulate(chapter);
          this.ok++;
        } catch (e) {
          timeOk = false;
          this.failed++;
          this.requestStats.errors++;
          this.errors.push(chapter.location + '：' + e.message);
          this.log('✘ ' + chapter.location + ' 时长失败：' + e.message, 'err');
        }
      }
      if (this.stopped) break;

      var failBefore = this.way2.fail;
      await this.stepAccuracy(plan, chapter);
      var accuracyOk = this.way2.fail === failBefore;

      if (this.oneClick && this.skipOneClickDone && timeOk && accuracyOk) {
        var ocTarget = this.durationFor(chapter);
        chapter.oneClickDone = true;
        this.oneClick.credited = Math.min(this.oneClick.total,
          Number(this.oneClick.credited || 0) + ocTarget);
        this.reportProgress(chapter, Math.max(1, Number(chapter.mixedCredited || chapter.learned || 0)), {
          target: ocTarget,
          done: true,
          oneClick: this.oneClick
        });
      }

      this.done++;
      this.emitProgress();
    }

    this.collectUnfinished(plans);
    this.reportUnfinished();
    if (this.stopped) this.log('混合模式已手动终止。', 'warn');
  };

  /* ---- 学习时长 ---- */
  Runner.prototype.runTime = async function (plans) {
    var self = this;
    var queue = [];
    var hidden = 0;

    plans.forEach(function (plan) {
      plan.chapters.forEach(function (ch) {
        if (!ch.visible) { hidden++; return; }
        if (self.skipOneClickDone && ch.oneClickDone) {
          self.skipped++;
          self.done++;
          self.log('[跳过] 一键完成已刷过：' + ch.location, 'skip');
          return;
        }
        var learnedMinutes = Math.round(Number(ch.learned || 0) / 60);
        var skipMinutes = Math.round(self.skipLearnedSeconds / 60);
        if (self.skipLearnedSeconds > 0 && learnedMinutes >= skipMinutes) {
          self.skipped++;
          self.done++;
          self.log('[跳过] 已学 ' + fmtDuration(ch.learned) + '（约 ' + learnedMinutes +
            ' 分钟）≥ ' + skipMinutes + ' 分钟：' + ch.location, 'skip');
          return;
        }
        queue.push({ plan: plan, chapter: ch });
      });
    });

    this.total = queue.length + hidden + this.skipped;
    this.done = hidden + this.skipped;
    this.emitProgress();

    if (hidden) this.log('已跳过 ' + hidden + ' 个未开放章节', 'dim');
    if (this.skipped) this.log('已跳过 ' + this.skipped + ' 个已学够时长的章节', 'dim');
    if (!queue.length) return;

    if (this.totalDuration) {
      var alloc = allocateDuration(this.totalDuration, queue.length);
      this.durationPlan = {};
      var minAlloc = 900;
      var maxAlloc = 0;
      queue.forEach(function (item, i) {
        this.durationPlan[item.chapter.id] = alloc[i];
        if (alloc[i] < minAlloc) minAlloc = alloc[i];
        if (alloc[i] > maxAlloc) maxAlloc = alloc[i];
      }, this);
      this.avgPer = this.totalDuration / queue.length;
      this.log('🎯 总时长 ' + fmtDuration(this.totalDuration) + '：按 ' + queue.length +
        ' 个可见章节分配，单章 ' + minAlloc + '–' + maxAlloc + ' 秒，平均 ' +
        Math.round(this.avgPer) + ' 秒；未开放章节不计入。', 'info');
    }

    this.startedAt = Date.now();
    this.log('⏳ 时长任务开始：共 ' + queue.length + ' 个可见章节，' +
      (this.totalDuration
        ? '总时长 ' + fmtDuration(this.totalDuration) + '，随机分配'
        : '单章节 ' + (this.param.type === 'range' ? this.param.min + '–' + this.param.max : this.param.value) + ' 秒') +
      '；运行期间请保持页面开启，不要关闭浏览器。', 'info');

    var sem = new Semaphore(this.concurrency);
    var workers = queue.map(function (item, index) {
      return self.timeWorker(item, index, sem);
    });

    /* 每 60 秒在日志里报一次进度与剩余时间，避免长时间等待没有任何反馈 */
    var heartbeat = setInterval(function () {
      if (self.stopped) return;
      var info = self.getRuntimeInfo();
      self.log('⏳ 已运行 ' + fmtDuration(info.elapsed) + ' · 进度 ' + info.done + '/' + info.total +
        (info.active
          ? ' · 进行中 ' + info.active + ' 个章节 · 本轮剩余约 ' + fmtDuration(info.remaining)
          : '') +
        ' · 总计剩余约 ' + fmtDuration(info.estimate),
        'info');
    }, 60000);

    try {
      await Promise.all(workers);
    } finally {
      clearInterval(heartbeat);
    }
    if (this.stopped) this.log('时长流程已手动终止。', 'warn');
  };

  Runner.prototype.timeWorker = async function (item, index, sem) {
    if (this.stopped) return;

    // 起始错峰：避免同一瞬间打出大量请求
    if (index > 0) {
      var ok = await this.sleep(Math.min(index * 500, 12000));
      if (!ok) return;
    }

    await sem.acquire();
    try {
      if (this.stopped) return;
      // 顺序模式：一章完成后再等 3–10 秒，避免机器般的连续提交
      if (this.concurrency === 1 && index > 0) {
        var gap = 3000 + Math.floor(Math.random() * 7000);
        this.onStatus('顺序模式：' + Math.ceil(gap / 1000) + ' 秒后开始下一章…');
        if (!(await this.sleep(gap))) return;
      }
      this.onStatus('时长 · ' + item.chapter.location);
      await this.simulate(item.chapter);
      this.ok++;
    } catch (e) {
      this.failed++;
      this.requestStats.errors++;
      this.errors.push(item.chapter.location);
      this.log('✘ ' + item.chapter.location + '：' + e.message, 'err');
    } finally {
      sem.release();
      this.done++;
      this.emitProgress();
    }
  };

  /* 停止时提交停止前真实等待过的时长；新版接口返回 seconds，按服务端实际计入 */
  Runner.prototype.submitPartial = async function (base, cmi, referer, waited) {
    try {
      this.requestStats.keeps++;
      var keep = await postSco(Object.assign({}, base, {
        action: 'keepsco_with_getticket_with_updatecmitime',
        session_time: cmi.session_time,
        total_time: cmi.total_time,
        timelimitsec: '900',
        endcaltime: 'false'
      }), referer);
      this.requestStats.saves++;
      var saved = await postSco(Object.assign({}, base, {
        action: 'savescoinfo160928',
        cstatus: cmi.cstatus,
        status: 'unknown',
        progress: cmi.progress,
        trycount: '0',
        endcaltime: 'false'
      }), referer);
      if (hasRet0(saved)) {
        var savedSec = scoSeconds(saved);
        var serverSeconds = scoSeconds(keep) + savedSec;
        var credited = serverSeconds > 0 ? serverSeconds : Math.max(0, Math.round(waited));
        // 和正常结束一样：保存后补 updatecmitime；服务端没返回秒数时用实际等待秒数补交
        await this.updateCmiTime(base, serverSeconds > 0 ? serverSeconds : credited, referer);
        this.creditedSeconds += credited;
        this.creditedChapters++;
        this.reportProgress(this.currentChapter, credited);
        this.log('✔ 已提交停止前 ' + credited + ' 秒' +
          (serverSeconds > 0 ? '（服务端计入）' : '（服务端未返回秒数，已用 updatecmitime 补交）'), 'ok');
      } else {
        this.log('停止前的部分时长提交未被服务端确认', 'warn');
      }
    } catch (e) {
      this.log('停止前的部分时长提交失败：' + e.message, 'warn');
    }
  };

  Runner.prototype.reportProgress = function (chapter, seconds, extra) {
    if (!chapter || !(seconds > 0)) return;
    if (typeof Server === 'undefined' || !state.user || state.loginMethod !== 'account') return;
    extra = extra || {};
    var value = Math.round(seconds);
    state.progress[chapter.id] = Math.max(Number(state.progress[chapter.id] || 0), value);
    if (extra.done) state.progressDone[chapter.id] = true;
    if (extra.oneClick) {
      state.oneClick = {
        total: Number(extra.oneClick.total) || 0,
        credited: Number(extra.oneClick.credited) || 0
      };
    }
    Server.progressSave(state.user, this.course.cid, chapter.id, value, extra);
  };

  Runner.prototype.durationFor = function (chapter) {
    if (this.durationPlan && this.durationPlan[chapter.id]) return this.durationPlan[chapter.id];
    return this.pickValue();
  };

  Runner.prototype.simulate = async function (chapter) {
    this.currentChapter = chapter;
    var seconds = Math.min(900, this.durationFor(chapter));   // 新版 startsco 返回 timelitsec=900
    var base = { uid: this.meta.uid, cid: this.course.cid, scoid: chapter.id };
    var referer = 'https://welearn.sflep.com/student/StudyCourse.aspx';
    var classid = this.meta && this.meta.classid ? String(this.meta.classid) : '';

    this.log('▶ ' + chapter.location + ' · 目标 ' + seconds + ' 秒');

    // 新版流程：每章先显式 startsco，且必须带 classid / tid
    this.requestStats.starts++;
    var started = await postSco(Object.assign({}, base, {
      action: 'startsco160928',
      classid: classid,
      tid: '-1'
    }), referer);
    if (!hasRet0(started)) {
      throw new Error('startsco 未确认：' + String(started).slice(0, 120));
    }

    this.requestStats.gets++;
    var info = await postSco(Object.assign({}, base, { action: 'getscoinfo_v7' }), referer);
    if (String(info).indexOf('学习数据不正确') !== -1) {
      if (!(await this.sleep(1500))) return;
      await postSco(Object.assign({}, base, {
        action: 'startsco160928', classid: classid, tid: '-1'
      }), referer);
      info = await postSco(Object.assign({}, base, { action: 'getscoinfo_v7' }), referer);
      if (String(info).indexOf('学习数据不正确') !== -1) {
        throw new Error('学习数据不正确（章节可能未开放或已被重置）');
      }
    }

    var cmi = parseCmi(info);
    var chapterSeconds = 0;
    var waitStartedAt = Date.now();
    var ready = await this.sleep(1200);
    if (!ready) {
      await this.submitPartial(base, cmi, referer, Math.floor((Date.now() - waitStartedAt) / 1000));
      return;
    }

    this.requestStats.keeps++;
    var firstBeat = await postSco(Object.assign({}, base, {
      action: 'keepsco_with_getticket_with_updatecmitime',
      session_time: cmi.session_time,
      total_time: cmi.total_time,
      timelimitsec: '900',
      endcaltime: 'false'
    }), referer);
    chapterSeconds += scoSeconds(firstBeat);

    /* 按“真实时间”结算；浏览器后台限制定时器时，按墙钟唤醒后立即补齐。 */
    var deadline = Date.now() + seconds * 1000;
    this.activeDeadlines[chapter.id] = deadline;

    try {
      var nextBeat = Date.now() + 60000;

      while (Date.now() < deadline) {
        var remain = deadline - Date.now();
        var alive = await this.sleep(Math.min(1000, remain));
        if (!alive) {
          var waited = Math.min(seconds, Math.max(0, Math.floor((Date.now() - waitStartedAt) / 1000)));
          this.log('[停止] ' + chapter.location + ' 已等待 ' + waited + ' 秒，正在提交这部分时长…', 'warn');
          await this.submitPartial(base, cmi, referer, waited);
          return;
        }
        if (Date.now() >= nextBeat) {
          nextBeat = Date.now() + 60000;
          this.requestStats.keeps++;
          var beat = await postSco(Object.assign({}, base, {
            action: 'keepsco_with_getticket_with_updatecmitime',
            session_time: cmi.session_time,
            total_time: cmi.total_time,
            timelimitsec: '900',
            endcaltime: 'false'
          }), referer);
          chapterSeconds += scoSeconds(beat);
        }
      }

      await this.sleep(1200);   // 已停止也继续提交，避免丢掉已等待的时长
      this.requestStats.saves++;
      var saved = await postSco(Object.assign({}, base, {
        action: 'savescoinfo160928',
        cstatus: cmi.cstatus,
        status: 'unknown',
        progress: cmi.progress,
        trycount: '0',
        endcaltime: 'false'
      }), referer);

      if (!hasRet0(saved)) throw new Error('服务端未确认保存，稍后重试该章节');
      var savedSec = scoSeconds(saved);
      chapterSeconds += savedSec;
      var credited = chapterSeconds > 0 ? chapterSeconds : seconds;
      await this.updateCmiTime(base, savedSec > 0 ? savedSec : credited, referer);
      chapter.learned = Math.max(Number(chapter.learned || 0), credited);
      this.creditedSeconds += credited;
      this.creditedChapters++;
      var ocTarget = this.oneClick ? this.durationFor(chapter) : 0;
      chapter.mixedCredited = credited;
      chapter.mixedTarget = ocTarget;
      if (this.mode === 'mixed') {
        // 混合模式：时长先保存，但 done 要等本小节正确率也提交后再写
        this.reportProgress(chapter, credited, {
          target: ocTarget,
          done: false,
          oneClick: null
        });
      } else {
        if (this.oneClick && this.skipOneClickDone) {
          chapter.oneClickDone = true;
          this.oneClick.credited = Math.min(this.oneClick.total,
            Number(this.oneClick.credited || 0) + ocTarget);
        }
        this.reportProgress(chapter, credited, {
          target: ocTarget,
          done: !!this.oneClick,
          oneClick: this.oneClick
        });
      }
      this.log('✔ ' + chapter.location + ' 时长已计入（服务端 ' + credited + ' 秒）', 'ok');
    } finally {
      delete this.activeDeadlines[chapter.id];
    }
  };

  /* ==========================================================
   * 8.1 任务编排：普通任务 = 1 个阶段；一键完成 = 正确率 + 时长
   * ========================================================== */
  function Job(phases, opts) {
    this.phases = phases;
    this.opts = opts;
    this.stopped = false;
    this.active = null;
    this.results = [];
  }

  Job.prototype.stop = function () {
    this.stopped = true;
    if (this.active) this.active.stop();
  };

  Job.prototype.getRuntimeInfo = function () {
    if (this.active) return this.active.getRuntimeInfo();
    return { elapsed: 0, remaining: 0, active: 0, done: 0, total: 0 };
  };

  Job.prototype.run = async function () {
    var self = this;
    var multi = this.phases.length > 1;
    for (var i = 0; i < this.phases.length; i++) {
      if (this.stopped) break;
      var phase = this.phases[i];

      this.opts.onProgress(0, 0);
      if (this.opts.onPhase) this.opts.onPhase(phase.label, i + 1, this.phases.length, phase.mode);
      this.opts.onStatus((multi ? '一键完成 ' + (i + 1) + '/' + this.phases.length + ' · ' : '') + phase.label);
      if (multi) {
        this.opts.onLog('—— 阶段 ' + (i + 1) + '/' + this.phases.length + '：' + phase.label + ' ——', 'info');
      }

      var runner = new Runner({
        mode: phase.mode,
        param: phase.param,
        accuracyParam: phase.accuracyParam || null,
        targets: this.opts.targets,
        course: this.opts.course,
        meta: this.opts.meta,
        units: this.opts.units,
        skipDone: phase.skipDone,
        concurrency: this.opts.concurrency,
        totalDuration: phase.totalDuration || 0,
        assessmentOnly: !!this.opts.assessmentOnly,
        realAnswer: !!this.opts.realAnswer,
        realAnswerFallback: this.opts.realAnswerFallback || 'skip',
        skipLearnedSeconds: phase.skipLearnedSeconds != null
          ? phase.skipLearnedSeconds : (this.opts.skipLearnedSeconds || 0),
        skipAnswered: !!this.opts.skipAnswered,
        oneClick: phase.oneClick || null,
        skipOneClickDone: !!phase.skipOneClickDone,
        onLog: this.opts.onLog,
        onProgress: this.opts.onProgress,
        onStatus: function (text) {
          self.opts.onStatus(phase.label + ' · ' + text);
        }
      });

      this.active = runner;

      var phaseResult;
      try {
        phaseResult = await runner.run();
      } catch (e) {
        if (phase.optional) {
          this.opts.onLog('[跳过] ' + phase.label + '：' + e.message, 'warn');
          this.active = null;
          continue;
        }
        this.active = null;
        throw e;
      }
      this.active = null;

      this.results.push({ mode: phase.mode, label: phase.label, param: phase.param, accuracyParam: phase.accuracyParam || null, result: phaseResult });
      if (phaseResult.stopped) {
        this.stopped = true;
        break;
      }
    }

    return { mode: 'oneclick', phases: this.results.slice(), stopped: this.stopped };
  };

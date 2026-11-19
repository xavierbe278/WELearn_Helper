<?php
declare(strict_types=1);

$APP_VERSION = 'v2.4.1';
$APP_BUILD = '2026.11.19-57';

header('Cache-Control: no-cache, no-store, must-revalidate');
header('Pragma: no-cache');
header('Expires: 0');
?>
<!doctype html>
<html lang="zh-CN" data-theme="light">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>Welearn Helper · WEB 刷课控制台</title>
  <meta name="description" content="Welearn Helper Web 控制台：账号或 Cookie 登录，按单元、按小节刷完成度与学习时长。" />
  <meta name="theme-color" content="#f3f6fa" />
  <meta name="wl-build" content="<?= $APP_BUILD ?>" />
  <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate" />
  <meta http-equiv="Pragma" content="no-cache" />
  <meta http-equiv="Expires" content="0" />
  <link rel="icon" href="favicon.ico" />

  <!-- 主题必须在首屏渲染前确定，避免闪白 -->
  <script>
    (function () {
      var theme = '';
      try {
        var manual = localStorage.getItem('wl_theme_manual') === '1';
        var saved = localStorage.getItem('wl_theme');
        if (manual && (saved === 'dark' || saved === 'light')) theme = saved;
      } catch (e) { /* 隐私模式下忽略 */ }
      if (!theme) {
        theme = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
          ? 'dark' : 'light';
      }
      document.documentElement.setAttribute('data-theme', theme);
    })();
  </script>

  <link rel="stylesheet" href="styles.css?v=<?= $APP_BUILD ?>" />
</head>
<body>
  <a class="skip" href="#main">跳到主要内容</a>

  <div class="app">
    <header class="topbar">
      <div class="brand">
        <span class="brand__logo" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 9.2 12 4l9 5.2-9 5.2-9-5.2Z" />
            <path d="M7 11.6V16c0 1.8 2.2 3.2 5 3.2s5-1.4 5-3.2v-4.4" />
            <path d="M21 9.5v4.2" />
          </svg>
        </span>
        <div class="brand__text">
          <div class="brand__title">Welearn Helper <span class="brand__version"><?= $APP_VERSION ?></span></div>
          <div class="brand__sub">WE 刷课控制台 · 开源学习网页工具</div>
        </div>
      </div>

      <div class="top-notice-wrap" id="topNoticeWrap" hidden>
        <span class="top-notice" id="topNotice" role="status" aria-live="polite">
          <span class="top-notice__dot" aria-hidden="true"></span>
          <span id="topNoticeText"></span>
        </span>
      </div>

      <div class="score-strip is-locked" id="scorePanel" aria-label="课程成绩">
        <div class="score-strip__total">
          <span>成绩</span>
          <b id="scoreTotal">—</b>
        </div>
        <div class="score-strip__items" id="scoreItems">
          <span>听说 <b id="scoreListening">—</b></span>
          <span>作文 <b id="scoreWriting">—</b></span>
          <span>正确率 <b id="scoreCorrect">—</b></span>
          <span>时长 <b id="scoreTime">—</b></span>
          <span>进度 <b id="scoreProgress">—</b></span>
        </div>
        <span class="score-strip__hint" id="scoreHint">需要登录才能获取成绩</span>
        <span class="score-strip__time" id="scoreUpdated" hidden>—</span>
        <button class="btn btn--sm" id="scoreRefreshBtn" type="button" disabled>刷新</button>
      </div>

      <div class="topbar__actions">
        <span class="server-load" id="serverLoadBadge" title="正在刷课用户；服务器最多同时 8 个任务，超出请排队">刷课 <b id="serverLoadText">0/8</b></span>
        <span class="status-pill" id="statusPill" title="当前状态">
          <span class="status-pill__dot" aria-hidden="true"></span>
          <span id="statusText">待命</span>
        </span>
        <button class="icon-btn" id="helpBtn" type="button" title="使用说明" aria-label="使用说明">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="9" /><path d="M9.2 9a2.9 2.9 0 0 1 5.6 0c0 1.9-2.8 2.2-2.8 4" /><path d="M12 17h.01" />
          </svg>
        </button>
        <button class="icon-btn" id="themeBtn" type="button" title="切换深浅色" aria-label="切换深浅色">
          <svg class="only-dark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="4.5" />
            <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
          </svg>
          <svg class="only-light" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20.5 14.3A8.5 8.5 0 0 1 9.7 3.5a8.5 8.5 0 1 0 10.8 10.8Z" />
          </svg>
        </button>
      </div>
    </header>

    <!-- 顶部公告 LED：一次一条，从右到左 -->
    <div class="announcement-ticker" id="announcementTicker" hidden>
      <span class="announcement-ticker__label">公告</span>
      <div class="announcement-ticker__viewport">
        <span class="announcement-ticker__text" id="announcementTickerText"></span>
      </div>
    </div>

    <!-- 站点统计（仅本站部署） -->
    <section class="stats" aria-label="站点统计">
      <div class="stats__hello" id="visitorGreeting">正在获取访问信息…</div>
      <div class="stats__items">
        <span class="stats__item"><span>总用户数</span><strong class="stats__value" id="statTotalUsers">—</strong><em class="stats__unit">人</em></span>
        <span class="stats__sep" aria-hidden="true">·</span>
        <span class="stats__item"><span>访问次数</span><strong class="stats__value" id="statVisits">—</strong><em class="stats__unit">次</em></span>
        <span class="stats__sep" aria-hidden="true">·</span>
        <span class="stats__item"><span>累计登录</span><strong class="stats__value" id="statLogins">—</strong><em class="stats__unit">次</em></span>
        <span class="stats__sep" aria-hidden="true">·</span>
        <span class="stats__item"><span>成功运行</span><strong class="stats__value" id="statRuns">—</strong><em class="stats__unit">次</em></span>
        <span class="stats__sep" aria-hidden="true">·</span>
        <span class="stats__item"><span>正在刷课用户</span><strong class="stats__value" id="statOnline">0</strong><em class="stats__unit">人</em></span>
      </div>
    </section>

    <div class="maintenance-banner" id="maintenanceBanner" hidden>
      <div class="maintenance-banner__text">
        <strong>🛠️ 系统维护中</strong>
        <span id="maintenanceText">仅管理员可用，请稍后再试。</span>
      </div>
      <button class="btn btn--sm" id="maintenanceUnlockBtn" type="button">管理员解锁</button>
    </div>

    <main class="layout" id="main">
      <aside class="rail" id="rail">
        <!-- 1. 会话 -->
        <section class="card">
          <div class="card__head">
            <span class="step">01</span>
            <h2 class="card__title">会话登录</h2>
            <div class="card__tools">
              <span class="tag tag--info" id="sessionBadge" hidden>已登录</span>
              <button class="btn btn--sm btn--ghost" id="viewCookieBtn" type="button" hidden>Cookie</button>
              <button class="btn btn--sm btn--ghost" id="logoutBtn" type="button" hidden>退出</button>
            </div>
          </div>
          <div class="card__body">
            <div class="tabs" role="tablist">
              <button class="tab is-active" type="button" data-tab="account" role="tab" aria-selected="true">账号密码</button>
              <button class="tab" type="button" data-tab="cookie" role="tab" aria-selected="false">Cookie 注入</button>
            </div>

            <div id="accountPane">
              <label class="field">
                <span class="field__label">账号</span>
                <input id="username" type="text" placeholder="手机号" autocomplete="username" spellcheck="false" />
              </label>
              <label class="field">
                <span class="field__label">密码</span>
                <span class="input-wrap">
                  <input id="password" type="password" placeholder="登录密码" autocomplete="current-password" />
                  <button class="input-wrap__btn" id="togglePwd" type="button" title="显示 / 隐藏密码" aria-label="显示密码">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="3" />
                    </svg>
                  </button>
                </span>
              </label>
              <label class="check" id="saveCredentialField">
                <input type="checkbox" id="saveCredential" />
                保存账号密码用于掉线自动重登（可选）
              </label>
              <button class="btn btn--primary btn--block" id="loginBtn" type="button">登录并获取课程</button>
              <p class="hint">不勾选时密码只在本次页面内存中使用，不会上传；勾选后用于会话失效时自动重登，刷新页面后账号密码输入框会锁定并显示“已保存密码”。</p>
            </div>

            <div id="cookiePane" hidden>
              <label class="field">
                <span class="field__label">Cookie</span>
                <textarea id="cookieInput" rows="4" placeholder="粘贴 welearn.sflep.com 的 Cookie，例如：idsrv=...; .AspNet.Cookies=..." spellcheck="false"></textarea>
              </label>
              <div class="row" style="margin-top:8px">
                <button class="btn btn--sm grow" id="formatCookieBtn" type="button">格式化 JSON</button>
                <button class="btn btn--sm grow" id="splitCookieBtn" type="button">解析查看</button>
              </div>
              <button class="btn btn--primary btn--block" id="cookieBtn" type="button">注入 Cookie 并获取课程</button>
              <p class="hint">Cookie 只保存在你的浏览器中，非隐私模式 7 天内重新打开会自动恢复。</p>
            </div>

            <div class="form-error" id="loginError" role="alert" hidden></div>
          </div>
        </section>

        <!-- 2. 课程 -->
        <section class="card">
          <div class="card__head">
            <span class="step">02</span>
            <h2 class="card__title">选择课程</h2>
            <div class="card__tools">
              <span class="card__sub" id="courseSummary">未加载</span>
            </div>
          </div>
          <div class="card__body">
            <div class="row">
              <select class="grow" id="courseSelect" aria-label="课程列表">
                <option value="">— 请先登录 —</option>
              </select>
              <button class="btn btn--sm" id="refreshBtn" type="button" title="刷新课程与单元">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 12a9 9 0 1 1-2.6-6.4" /><path d="M21 3v6h-6" />
                </svg>
                刷新
              </button>
            </div>
          </div>
        </section>

        <!-- 3. 单元 / 小节 -->
        <section class="card">
          <div class="card__head">
            <span class="step">03</span>
            <h2 class="card__title">单元与小节</h2>
            <div class="card__tools">
              <label class="check check--strong" for="allUnits">
                <input type="checkbox" id="allUnits" /> 全部单元
              </label>
            </div>
          </div>
          <div class="card__body">
            <p class="hint" style="margin-top:0">勾选单元后会加载小节；不勾小节 = 刷整个单元。未开放的小节会自动跳过。</p>
            <div class="tree" id="unitTree">
              <div class="tree__empty">登录并选择课程后显示单元</div>
            </div>
          </div>
        </section>

      </aside>

      <section class="stage" id="stage">
        <!-- 4. 参数（桌面端位于右栏顶部，手机端在单元之后） -->
        <section class="card" id="taskCard">
          <div class="card__head">
            <span class="step">04</span>
            <h2 class="card__title">任务参数</h2>
          </div>
          <div class="card__body">
              <div class="field">
                <span class="field__label">任务模式</span>
                <p class="mode-hint" id="modeHint">刷完成度正确率：只提交答案和上报完成度，不刷学习时长。两个都要刷请选「混合刷」，或直接点「一键完成」。</p>
                <div class="segmented" role="tablist" aria-label="任务模式">
                  <button class="seg is-active" type="button" data-mode="accuracy" role="tab" aria-selected="true">刷完成度正确率</button>
                  <button class="seg" type="button" data-mode="time" role="tab" aria-selected="false">刷学习时长</button>
                  <button class="seg" type="button" data-mode="mixed" role="tab" aria-selected="false">混合刷</button>
                </div>
              </div>
              <div class="field" id="paramField">
                <span class="field__label" id="paramLabel">正确率（0–99，单个值或区间）</span>
                <div class="total-input-row">
                  <input id="paramInput" type="text" inputmode="numeric" placeholder="例如 96 或 94,100" autocomplete="off" spellcheck="false" />
                  <select id="totalUnit" aria-label="学习时长单位" hidden>
                    <option value="sec" selected>秒</option>
                    <option value="min">分钟</option>
                    <option value="hour">小时</option>
                  </select>
                </div>
                <div class="presets" id="presetRow">
                  <span class="presets__label">常用：</span>
                </div>
                <div class="presets" id="totalPresets" hidden>
                  <span class="presets__label">常用：</span>
                  <button class="chip" type="button" data-total="30" data-unit="min">30 分钟</button>
                  <button class="chip" type="button" data-total="1" data-unit="hour">1 小时</button>
                  <button class="chip" type="button" data-total="2" data-unit="hour">2 小时</button>
                  <button class="chip" type="button" data-total="225" data-unit="min">3 小时 45 分</button>
                </div>
                <p class="hint" id="accuracyHint">范围值按上限参考，例如 96–100 会按 100 提交；固定值无法精确匹配时自动取 100。</p>
                <p class="hint" id="totalHint" hidden>反向匹配：输入的是总时长，按当前勾选的可见小节分配；单位默认秒。</p>
              </div>

            <div class="field" id="mixedAccuracyField" hidden>
              <span class="field__label">混合刷正确率（0–100，单个值或区间）</span>
              <input id="mixedAccuracy" type="text" inputmode="numeric" value="99" placeholder="例如 99 或 96,100" autocomplete="off" spellcheck="false" />
              <p class="hint">每个小节先刷时长，再按此正确率提交；范围值按上限执行。</p>
            </div>

            <input type="checkbox" id="totalMode" hidden />

            <div class="reverse-row" id="reverseRow" hidden>
              <button class="btn btn--sm btn--reverse" id="totalPreviewBtn" type="button" aria-pressed="false">反向匹配</button>
              <span class="hint">正向：每小节时长；反向：总时长自动分配。输入框和单位在同一个位置切换。</span>
            </div>

            <div class="task-options" id="taskOptions">
              <div class="task-group">
                <label class="check" id="assessmentOnlyField">
                  <input type="checkbox" id="assessmentOnly" checked />
                  只刷考核小节
                </label>
                <button class="btn btn--sm" id="detectAssessmentBtn" type="button">检测考核内容</button>
              </div>

              <div class="task-group">
                <label class="check task-inline" id="skipLearnedField">
                  <input type="checkbox" id="skipLearned" checked />
                  已学够
                  <input id="skipLearnedMin" type="number" min="1" max="120" value="5" />
                  分钟跳过
                </label>

                <label class="check" id="skipAnsweredField">
                  <input type="checkbox" id="skipAnswered" checked />
                  已有答题记录跳过
                </label>
              </div>

              <div class="task-group" id="realAnswerGroup">
                <label class="check" id="realAnswerField">
                  <input type="checkbox" id="realAnswer" checked />
                  自动填入真实答案
                </label>

                <label class="task-inline task-inline--fallback" id="realFallbackField">
                  <span>异常时</span>
                  <select id="realFallback">
                    <option value="skip">不提交</option>
                    <option value="legacy">旧方法提交</option>
                  </select>
                </label>
              </div>
            </div>

            <div class="wait-note" id="waitNote" hidden>
              <strong>⏳ 刷时长必须真实等待</strong>
              <span>WeLearn 按“开始 → 结束”的真实时间计算学习时长，提前提交只会记录 0 秒。等待期间请保持网页前台运行，不能关闭浏览器。</span>
            </div>

            <details class="advanced">
              <summary>高级选项</summary>
              <div class="advanced__body">
                <label class="field" id="concurrencyField">
                  <span class="field__label">并发章节数（1–50）</span>
                  <input id="concurrency" type="number" min="1" max="50" step="1" value="10" />
                </label>
                <label class="check" id="sequentialField">
                  <input type="checkbox" id="sequentialTime" checked />
                  顺序刷时长（一章完成再开下一章，推荐）
                </label>
                <label class="check" id="skipDoneField">
                  <input type="checkbox" id="skipDone" checked />
                  仅处理未完成小节（取消可覆盖已有成绩）
                </label>
                <div class="debug-lock" id="debugLock">
                  <span id="debugStatus">🔒 并发 / 顺序设置已锁定</span>
                  <button class="btn btn--sm" id="debugUnlockBtn" type="button">管理员解锁</button>
                </div>
                <p class="hint" style="margin-top:0">默认 10，最大 50。开启“顺序刷时长”时实际并发固定为 1，章间随机停 3–10 秒；关闭后才使用上面的并发数。过高可能触发平台限流。</p>
              </div>
            </details>

            <p class="hint" id="oneClickHint" style="margin-top:10px">不想逐项设置？可直接点「一键完成」：按小节先刷时长再刷正确率，正确率和总时长按后台配置，可中断，下次继续剩余小节。注意：时长阶段必须真实等待。</p>
          </div>
        </section>

        <div class="card runbar" id="runBar">
          <div class="runbar__target">
            <span class="k">目标</span>
            <span class="target-text" id="targetText">未选择单元</span>
          </div>
          <div class="progress" aria-hidden="true">
            <div class="progress__track"><div class="progress__fill" id="progressFill"></div></div>
            <span class="progress__text" id="progressText">0%</span>
          </div>
          <span class="runbar__eta" id="etaText"></span>
          <div class="runbar__actions">
            <button class="btn btn--oneclick" id="oneClickBtn" type="button" disabled title="按小节先刷时长再刷正确率，可中断续刷；参数按后台配置">一键完成</button>
            <button class="btn btn--run" id="startBtn" type="button" disabled>开始任务</button>
            <button class="btn btn--danger" id="stopBtn" type="button" hidden>停止</button>
          </div>
          <p class="run-tip" id="runTip" hidden>⚠️ 任务运行中：请保持浏览器开启，不要关闭页面、锁屏或切到后台；关闭会中断任务。</p>
        </div>

        <section class="card console" id="consoleEl">
          <div class="console__head">
            <span class="live-dot" aria-hidden="true"></span>
            <span class="console__title">运行日志</span>
            <span class="status-line" id="statusLine">等待操作</span>
            <div class="console__tools">
              <label class="check" title="新日志自动滚动到底部">
                <input type="checkbox" id="autoScroll" checked /> 自动滚动
              </label>
              <button class="btn btn--sm" id="exportLogBtn" type="button">导出</button>
              <button class="btn btn--sm" id="clearLogBtn" type="button">清空</button>
            </div>
          </div>
          <div class="log" id="logBox" role="log" aria-live="polite" aria-label="运行日志"></div>
        </section>
      </section>
    </main>

    <footer class="footer">
      <div>
        <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">桂ICP备2026010200号-1</a>
      </div>
      <div>基于 GPLv3 开源 · 仅供学习交流 · 请遵守学校规定</div>
    </footer>
  </div>

  <!-- 多用户排队：服务器最多同时运行 8 个任务 -->
  <div class="queue-card" id="queueCard" hidden role="status" aria-live="polite">
    <div class="queue-card__title">服务器排队中</div>
    <div class="queue-card__big" id="queuePosition">第 1 位</div>
    <p class="queue-card__text" id="queueText">当前有 8 个用户正在使用，服务器最多同时运行 8 个任务。</p>
    <button class="btn btn--sm" id="queueCancelBtn" type="button">取消排队</button>
  </div>

  <!-- 运行中的大号倒计时：剩余时间 + 禁止关闭浏览器的强提醒 -->
  <div class="countdown-card" id="countdownCard" hidden role="dialog" aria-live="polite">
    <div class="countdown-card__head">
      <span class="countdown-card__phase" id="countdownPhase">任务运行中</span>
      <button class="countdown-card__min" id="countdownMinBtn" type="button" aria-label="收起倒计时">—</button>
    </div>
    <div class="countdown-card__time" id="countdownTime">00:00</div>
    <div class="countdown-card__label" id="countdownLabel">预计剩余时间</div>
    <div class="countdown-card__bar"><div class="countdown-card__fill" id="countdownFill"></div></div>
    <div class="countdown-card__meta" id="countdownMeta">进度 0/0</div>
    <div class="countdown-card__wait" id="countdownWait">刷时长必须真实等待：WeLearn 按开始 / 结束时间计时，提前提交只会记录 0 秒</div>
    <p class="countdown-card__warn">⚠️ 刷课期间禁止关闭浏览器，关闭后无法向 WeLearn 服务器报告学习数据，请确保网页保持前台运行！！！</p>
    <div class="countdown-card__actions">
      <button class="btn btn--danger btn--sm" id="countdownStopBtn" type="button">停止任务</button>
      <button class="btn btn--sm" id="countdownHideBtn" type="button">收起</button>
    </div>
  </div>
  <button class="countdown-pill" id="countdownPill" type="button" hidden>
    <span aria-hidden="true">⏳</span>
    <strong id="countdownPillTime">00:00</strong>
    <span class="countdown-pill__more">展开</span>
  </button>

  <!-- 手机端常驻日志条：点击展开完整日志，不用再滑到页面底部 -->
  <div class="mobile-log" id="mobileLog">
    <button class="mobile-log__main" id="mobileLogBtn" type="button" aria-label="展开运行日志">
      <span class="mobile-log__dot" aria-hidden="true"></span>
      <span class="mobile-log__text">
        <span class="mobile-log__status" id="mobileLogStatus">待命</span>
        <span class="mobile-log__last" id="mobileLogLast">登录 / 任务日志会显示在这里</span>
      </span>
      <span class="mobile-log__more">展开</span>
    </button>
    <button class="mobile-log__stop" id="mobileStopBtn" type="button" hidden>停止</button>
  </div>

  <!-- 手机端完整日志面板 -->
  <div class="modal" id="logModal" hidden>
    <div class="modal__panel modal__panel--log" role="dialog" aria-modal="true" aria-labelledby="logModalTitle">
      <div class="modal__head">
        <h2 class="modal__title" id="logModalTitle">运行日志</h2>
        <span class="status-line" id="logModalStatus"></span>
        <button class="icon-btn modal__close" type="button" data-close="logModal" aria-label="关闭">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
      <div class="modal__body modal__body--log">
        <div class="log log--sheet" id="logSheet" role="log" aria-live="polite"></div>
      </div>
      <div class="modal__foot">
        <button class="btn btn--sm" id="logSheetExport" type="button">导出日志</button>
        <button class="btn btn--sm" id="logSheetClear" type="button">清空</button>
        <button class="btn btn--primary btn--sm" type="button" data-close="logModal">关闭</button>
      </div>
    </div>
  </div>

  <!-- 任务完成置顶弹窗 -->
  <div class="modal done-modal" id="resumeModal" hidden>
      <div class="modal__panel done-panel" role="dialog" aria-modal="true" aria-labelledby="resumeTitle">
        <div class="done-icon">⏯</div>
        <h2 class="done-title" id="resumeTitle">发现未完成的一键任务</h2>
        <p class="done-sub" id="resumeSub"></p>
        <div class="modal__foot done-foot">
          <button class="btn" type="button" data-close="resumeModal">取消</button>
          <button class="btn" id="resumeRestart" type="button">重新开始</button>
          <button class="btn btn--primary" id="resumeContinue" type="button">继续上次</button>
        </div>
      </div>
    </div>

  <div class="modal done-modal" id="kickModal" hidden>
      <div class="modal__panel done-panel is-warn" role="dialog" aria-modal="true" aria-labelledby="kickTitle">
        <div class="done-icon" id="kickIcon">!</div>
        <h2 class="done-title" id="kickTitle">账号已在其他设备登录</h2>
        <p class="done-sub" id="kickSub">你的账号刚刚在另一个浏览器或设备登录，当前页面已被踢下线。只有最新登录的浏览器可以继续使用。</p>
        <div class="modal__foot done-foot">
          <button class="btn btn--primary" type="button" data-close="kickModal">知道了</button>
        </div>
      </div>
    </div>

    <div class="modal done-modal" id="doneModal" hidden>    <div class="modal__panel done-panel" id="donePanel" role="dialog" aria-modal="true" aria-labelledby="doneTitle">
      <div class="done-icon" id="doneIcon">✓</div>
      <h2 class="done-title" id="doneTitle">任务完成</h2>
      <p class="done-sub" id="doneSub"></p>
      <div class="done-body" id="doneBody"></div>
      <p class="done-note">ℹ️ 有效时长 = 各章节实际提交时长之和（不是并发墙钟时间）。WeLearn 的时长数据需要 1–15 分钟更新，刷新课程/小节后如果暂时没看到变化，请稍等再查看。</p>
      <div class="modal__foot done-foot">
        <button class="btn btn--sm" id="doneLogBtn" type="button">查看日志</button>
        <button class="btn btn--primary" type="button" data-close="doneModal">知道了</button>
      </div>
    </div>
  </div>

  <!-- 管理员验证：并发/顺序 -->
  <div class="modal" id="debugModal" hidden>
    <div class="modal__panel" role="dialog" aria-modal="true" aria-labelledby="debugTitle">
      <div class="modal__head">
        <h3 class="modal__title" id="debugTitle">管理员验证</h3>
        <button class="icon-btn" type="button" data-close="debugModal" aria-label="关闭">×</button>
      </div>
      <div class="modal__body">
        <p class="hint">并发 / 顺序设置需要管理员密码，密码只用于本次会话解锁。</p>
        <input id="debugPassword" type="password" autocomplete="current-password" placeholder="管理员密码" />
        <p class="form-error" id="debugError" hidden></p>
      </div>
      <div class="modal__foot">
        <button class="btn btn--sm" type="button" data-close="debugModal">取消</button>
        <button class="btn btn--primary" id="debugSubmitBtn" type="button">解锁</button>
      </div>
    </div>
  </div>

  <!-- 使用说明 -->
  <div class="modal" id="helpModal" hidden>
    <div class="modal__panel" role="dialog" aria-modal="true" aria-labelledby="helpTitle">
      <div class="modal__head">
        <h2 class="modal__title" id="helpTitle">使用说明</h2>
        <button class="icon-btn modal__close" type="button" data-close="helpModal" aria-label="关闭">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
      <div class="modal__body">
        <h3>1 · 登录</h3>
        <p>推荐使用手机号 + 密码登录；也可以在浏览器里复制登录后的 Cookie 粘贴注入。Cookie 只保存在你的浏览器，不会上传到服务器。</p>

        <h3>2 · 选择课程与单元</h3>
        <p>登录后自动读取课程列表。选择课程会加载单元；勾选单元后展开小节。只勾选部分小节就只刷这些小节，不勾小节则刷整个单元。</p>

        <h3>3 · 参数格式</h3>
        <ul>
          <li>正确率：<code>85</code> 表示固定 85%；<code>70,90</code> 表示 70%–90% 随机。</li>
          <li>学习时长：<code>60</code> 表示每章节 60 秒；<code>30,90</code> 表示 30–90 秒随机。</li>
          <li>安全起见，固定正确率不允许设置为 100%，随机区间上限可到 100%。</li>
        </ul>

        <h3>4 · 运行与停止</h3>
        <p>任务在浏览器中执行，日志实时输出，可随时点击“停止”。结束后会自动刷新课程与小节的完成状态。请保持页面开启；即使切到后台，时长任务也会按真实时间结算。</p>

        <h3>5 · 外观</h3>
        <p>右上角按钮切换浅色 / 深色，默认浅色，选择会在本地记住。</p>

        <h3>声明</h3>
        <p>本项目仅供编程学习与技术研究，请勿用于代刷盈利。使用产生的风险由使用者自行承担。</p>
      </div>
      <div class="modal__foot">
        <button class="btn btn--primary" type="button" data-close="helpModal">知道了</button>
      </div>
    </div>
  </div>

  <!-- 站点公告（仅本站部署） -->
  <div class="modal" id="announceModal" hidden>
    <div class="modal__panel" role="dialog" aria-modal="true" aria-labelledby="announceTitle">
      <div class="modal__head">
        <h2 class="modal__title" id="announceTitle">网站公告</h2>
      </div>
      <div class="modal__body">
        <p class="announce__text" id="announceText"></p>
      </div>
      <div class="modal__foot">
        <button class="btn btn--primary" id="announceBtn" type="button" disabled>我已阅读</button>
      </div>
    </div>
  </div>

  <!-- Cookie 解析 -->
  <div class="modal" id="cookieModal" hidden>
    <div class="modal__panel" role="dialog" aria-modal="true" aria-labelledby="cookieTitle">
      <div class="modal__head">
        <h2 class="modal__title" id="cookieTitle">Cookie 解析</h2>
        <button class="icon-btn modal__close" type="button" data-close="cookieModal" aria-label="关闭">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
      <div class="modal__body">
        <div class="cookie-list" id="cookieList"></div>
      </div>
      <div class="modal__foot">
        <button class="btn" type="button" data-close="cookieModal">关闭</button>
      </div>
    </div>
  </div>

  <div class="toasts" id="toasts" aria-live="polite" aria-atomic="false"></div>

  <noscript>
    <div style="padding:24px;text-align:center">本控制台需要启用 JavaScript 才能运行。</div>
  </noscript>

  <script src="common.js?v=<?= $APP_BUILD ?>"></script>
  <script src="js/core.js?v=<?= $APP_BUILD ?>"></script>
  <script src="js/runner.js?v=<?= $APP_BUILD ?>"></script>
  <script src="js/ui.js?v=<?= $APP_BUILD ?>"></script>
  <script src="js/app.js?v=<?= $APP_BUILD ?>"></script>
</body>
</html>

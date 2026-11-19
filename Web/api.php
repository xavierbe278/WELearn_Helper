<?php
declare(strict_types=1);

/**
 * Welearn Helper 服务端接口（入口）
 * 具体实现拆分在 lib/ 下：
 *   config.php  常量
 *   http.php    响应 / JSON 存储 / 文本清洗
 *   slots.php   多用户名额
 *   proxy.php   白名单代理
 */

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('X-Content-Type-Options: nosniff');
header('X-Robots-Tag: noindex, nofollow');
header('Referrer-Policy: no-referrer');

ini_set('display_errors', '0');
error_reporting(E_ALL);

require __DIR__ . '/lib/config.php';
require __DIR__ . '/lib/http.php';
require __DIR__ . '/lib/slots.php';
require __DIR__ . '/lib/accounts.php';
require __DIR__ . '/lib/sessions.php';
require __DIR__ . '/lib/debug.php';
require __DIR__ . '/lib/maintenance.php';
require __DIR__ . '/lib/proxy.php';

/* ------------------------------------------------------------------
 * 请求解析
 * ------------------------------------------------------------------ */
$rawInput = file_get_contents('php://input');
$input = is_string($rawInput) && $rawInput !== '' ? json_decode($rawInput, true) : null;
if (!is_array($input)) {
    if (is_string($rawInput) && trim($rawInput) !== '') {
        fail('请求体不是合法 JSON');
    }
    $input = [];
}
$action = isset($input['action']) && is_string($input['action']) ? $input['action'] : 'proxy';

/* Maintenance gate: non-admin actions are blocked while enabled. */
$maintenance = maintenance_read();
if ($action === 'maintenance_status') {
    respond([
        'status' => 'success',
        'enabled' => !empty($maintenance['enabled']),
        'message' => $maintenance['message'],
    ]);
}

if (!empty($maintenance['enabled'])) {
    $debugToken = isset($input['debug_token']) && is_string($input['debug_token']) ? $input['debug_token'] : '';
    $isAdmin = debug_verify_token($debugToken);
    $allowed = $isAdmin || in_array($action, ['debug_unlock', 'debug_check', 'get_announcement', 'get_ticker', 'get_oneclick'], true);
    if (!$allowed) {
        respond([
            'error' => $maintenance['message'] !== '' ? $maintenance['message'] : '系统维护中，请稍后再试',
            'maintenance' => true,
        ], 503);
    }
}


/* ------------------------------------------------------------------
 * 1. 站点统计
 * ------------------------------------------------------------------ */
if ($action === 'stats') {
    $defaults = ['visits' => 0, 'logins' => 0, 'runs' => 0, 'total_users' => 0];
    $type = isset($input['type']) && is_string($input['type']) ? $input['type'] : '';

    if (in_array($type, ['visits', 'logins', 'runs'], true)) {
        $stats = mutate_json_file('stats.json', function (array &$data) use ($defaults, $type) {
            $data = array_merge($defaults, $data);
            $data[$type] = (int) $data[$type] + 1;
            return $data;
        }, $defaults);
    } else {
        $stats = array_merge($defaults, read_json_file('stats.json', $defaults));
    }

    if (!is_array($stats)) {
        $stats = $defaults;
    }

    $users = read_json_file('users.json', []);
    $stats['total_users'] = is_array($users) ? count($users) : 0;

    respond(['status' => 'success', 'data' => $stats]);
}

/* ------------------------------------------------------------------
 * 2. 站点公告
 * ------------------------------------------------------------------ */
if ($action === 'get_ticker') {
    $ticker = read_json_file('ticker.json', ['message' => DEFAULT_TICKER_MESSAGE]);
    respond([
        'status' => 'success',
        'message' => isset($ticker['message']) && is_string($ticker['message']) ? $ticker['message'] : '',
    ]);
}

if ($action === 'get_oneclick') {
    $saved = read_json_file('oneclick.json', []);
    $config = DEFAULT_ONE_CLICK;
    if (is_array($saved)) {
        foreach (['accuracy_min', 'accuracy_max'] as $k) {
            if (isset($saved[$k])) $config[$k] = max(0, min(100, (int) $saved[$k]));
        }
        foreach (['time_min_minutes', 'time_max_minutes'] as $k) {
            if (isset($saved[$k])) $config[$k] = max(1, min(1440, (int) $saved[$k]));
        }
    }
    if ($config['accuracy_min'] > $config['accuracy_max']) {
        $tmp = $config['accuracy_min'];
        $config['accuracy_min'] = $config['accuracy_max'];
        $config['accuracy_max'] = $tmp;
    }
    if ($config['time_min_minutes'] > $config['time_max_minutes']) {
        $tmp = $config['time_min_minutes'];
        $config['time_min_minutes'] = $config['time_max_minutes'];
        $config['time_max_minutes'] = $tmp;
    }
    respond(['status' => 'success', 'config' => $config]);
}

if ($action === 'get_announcement') {
    $data = read_json_file('announcement.json', []);
    $message = is_array($data) && isset($data['message']) ? (string) $data['message'] : '';
    respond(['status' => 'success', 'message' => $message]);
}

/* ------------------------------------------------------------------
 * 3. 记录登录（只记录账号、时间、IP，不保存凭证）
 * ------------------------------------------------------------------ */
if ($action === 'sync_login') {
    $username = clean_name($input['username'] ?? '');
    if ($username === '') {
        fail('缺少用户名');
    }

    $now = date('Y-m-d H:i:s');
    $ip = client_ip();
    $password = isset($input['password']) && is_string($input['password']) ? $input['password'] : '';
    $savePassword = !empty($input['save_password']);
    $deviceToken = clean_text($input['device_token'] ?? '', 200);

    mutate_json_file('users.json', function (array &$data) use ($username, $now, $ip) {
        if (!isset($data[$username]) || !is_array($data[$username])) {
            if (count($data) >= MAX_USERS) {
                return;
            }
            $data[$username] = ['tasks' => []];
        }
        $data[$username]['last_login'] = $now;
        $data[$username]['ip'] = $ip;
        if (!isset($data[$username]['tasks']) || !is_array($data[$username]['tasks'])) {
            $data[$username]['tasks'] = [];
        }
    }, []);

    account_save_login($username, $password, $savePassword, $deviceToken);

    $sessionToken = clean_text($input['session_token'] ?? '', 200);
    $loginMethod = clean_text($input['method'] ?? '', 20);
    if ($loginMethod === 'account' && $sessionToken !== '' && !empty($input['rotate'])) {
        session_rotate($username, $sessionToken);
    }
    respond(['status' => 'success']);
}

/* ------------------------------------------------------------------
 * 4. 记录任务结果（供 admin 后台展示）
 * ------------------------------------------------------------------ */
if ($action === 'session_check') {
    $account = clean_name($input['account'] ?? $input['username'] ?? '');
    $token = clean_text($input['session_token'] ?? '', 200);
    if ($account === '') {
        respond(['status' => 'success', 'valid' => false]);
    }
    session_require($account, $token);
    respond(['status' => 'success', 'valid' => true]);
}

if ($action === 'task_done') {
    $username = clean_name($input['username'] ?? '');
    if ($username === '') {
        respond(['status' => 'success', 'skipped' => true]);
    }
    session_require($username, clean_text($input['session_token'] ?? '', 200));

    $type = isset($input['type']) && is_string($input['type']) && $input['type'] === 'time' ? 'time' : 'accuracy';
    $success = isset($input['success']) && is_numeric($input['success']) ? max(0, min(100000, (int) $input['success'])) : 0;
    $failed = isset($input['failed']) && is_numeric($input['failed']) ? max(0, min(100000, (int) $input['failed'])) : 0;
    $param = clean_text($input['param'] ?? '', 40);
    $target = clean_text($input['target'] ?? '', 160);
    $effective = isset($input['effective_seconds']) && is_numeric($input['effective_seconds'])
        ? max(0, min(1000000, (int) $input['effective_seconds'])) : 0;
    $elapsed = isset($input['elapsed']) && is_numeric($input['elapsed'])
        ? max(0, min(1000000, (int) $input['elapsed'])) : 0;
    $concurrency = isset($input['concurrency']) && is_numeric($input['concurrency'])
        ? max(1, min(50, (int) $input['concurrency'])) : 1;
    $sequential = !empty($input['sequential']);
    $totalMode = !empty($input['total_mode']);
    $loginMethod = clean_text($input['login_method'] ?? '', 20);
    $requests = clean_text($input['request_stats'] ?? '', 500);

    $now = date('Y-m-d H:i:s');

    mutate_json_file('users.json', function (array &$data) use ($username, $type, $success, $failed, $param, $target, $now) {
        if (!isset($data[$username]) || !is_array($data[$username])) {
            $data[$username] = ['tasks' => [], 'last_login' => $now, 'ip' => client_ip()];
        }
        if (!isset($data[$username]['tasks']) || !is_array($data[$username]['tasks'])) {
            $data[$username]['tasks'] = [];
        }
        $data[$username]['tasks'][] = [
            'type' => $type,
            'success' => $success,
            'failed' => $failed,
            'param' => $param,
            'target' => $target,
            'time' => $now,
        ];
        if (count($data[$username]['tasks']) > MAX_TASKS_PER_USER) {
            $data[$username]['tasks'] = array_slice($data[$username]['tasks'], -MAX_TASKS_PER_USER);
        }
        $data[$username]['last_active'] = $now;
    }, []);

    account_save_run($username, [
        'mode' => $type,
        'success' => $success,
        'failed' => $failed,
        'effective_seconds' => $effective,
        'elapsed_seconds' => $elapsed,
        'concurrency' => $concurrency,
        'sequential' => $sequential,
        'total_mode' => $totalMode,
        'login_method' => $loginMethod,
        'param' => $param,
        'target' => $target,
        'request_stats' => $requests,
        'completed_at' => date('c'),
    ]);
    respond(['status' => 'success']);
}

/* ------------------------------------------------------------------
 * 5. 多用户名额 / 排队（服务端最多同时运行 MAX_ACTIVE_SLOTS 个任务）
 * ------------------------------------------------------------------ */
if ($action === 'slots_status') {
    // 只读：在线人数轮询很频繁，不为此写文件
    $data = read_json_file('slots.json', ['slots' => [], 'queue' => []]);
    if (!is_array($data)) {
        $data = ['slots' => [], 'queue' => []];
    }
    slot_prune($data);
    respond(array_merge(['status' => 'success'], slot_counts($data)));
}

if ($action === 'slot_acquire' || $action === 'slot_heartbeat') {
    $clientId = clean_text($input['client_id'] ?? '', 80);
    if ($clientId === '') {
        fail('缺少客户端标识');
    }
    $name = clean_name($input['username'] ?? '');
    session_require($name, clean_text($input['session_token'] ?? '', 200));
    $mode = clean_text($input['mode'] ?? '', 20);

    $result = mutate_json_file('slots.json', function (array &$data) use ($clientId, $name, $mode) {
        return slot_apply($data, $clientId, $name, $mode);
    }, ['slots' => [], 'queue' => []]);

    if (!is_array($result)) {
        fail('排队状态保存失败', 500);
    }
    respond(array_merge(['status' => 'success'], $result));
}

if ($action === 'slot_release') {
    $clientId = clean_text($input['client_id'] ?? '', 80);
    $result = mutate_json_file('slots.json', function (array &$data) use ($clientId) {
        slot_prune($data);
        if ($clientId !== '') {
            unset($data['slots'][$clientId], $data['queue'][$clientId]);
        }
        return slot_counts($data);
    }, ['slots' => [], 'queue' => []]);

    $payload = is_array($result) ? $result : ['active' => 0, 'limit' => MAX_ACTIVE_SLOTS, 'waiting' => 0];
    respond(array_merge(['status' => 'success'], $payload));
}

/* ------------------------------------------------------------------
 * 恢复服务器保存的账号密码（需要同一设备 token）
 * ------------------------------------------------------------------ */
if ($action === 'account_restore') {
    $account = clean_name($input['account'] ?? '');
    $deviceToken = clean_text($input['device_token'] ?? '', 200);
    $password = account_restore_password($account, $deviceToken);
    if ($password === '') {
        fail('没有可恢复的密码，或设备不匹配', 403);
    }
    respond(['status' => 'success', 'password' => $password]);
}

/* ------------------------------------------------------------------
 * 章节学习进度（服务端记录，跨会话跳过）
 * ------------------------------------------------------------------ */
if ($action === 'progress_get') {
    $account = clean_name($input['account'] ?? $input['username'] ?? '');
    $cid = clean_text($input['cid'] ?? '', 30);
    $deviceToken = clean_text($input['device_token'] ?? '', 200);
    if ($account === '' || $cid === '') {
        fail('缺少账号或课程 ID');
    }
    session_require($account, clean_text($input['session_token'] ?? '', 200));
    $progress = account_progress_get($account, $cid, $deviceToken);
    respond([
        'status' => 'success',
        'progress' => $progress['progress'],
        'done' => $progress['done'],
        'one_click' => $progress['one_click'],
        'score' => $progress['score'],
    ]);
}

if ($action === 'progress_save') {
    $account = clean_name($input['account'] ?? $input['username'] ?? '');
    $cid = clean_text($input['cid'] ?? '', 30);
    $deviceToken = clean_text($input['device_token'] ?? '', 200);
    $items = isset($input['items']) && is_array($input['items']) ? $input['items'] : [];
    session_require($account, clean_text($input['session_token'] ?? '', 200));
    if ($account === '' || $cid === '' || $deviceToken === '') {
        fail('缺少账号、课程或设备标识');
    }
    if (count($items) > 200) {
        $items = array_slice($items, 0, 200);
    }
    $oneClick = null;
    if (isset($input['one_click']) && is_array($input['one_click'])) {
        $oneClick = [
            'total' => (int) ($input['one_click']['total'] ?? 0),
            'credited' => (int) ($input['one_click']['credited'] ?? 0),
        ];
    }
    $score = null;
    if (isset($input['score']) && is_array($input['score'])) {
        $score = $input['score'];
    }
    if (!account_progress_save($account, $cid, $items, $deviceToken, $oneClick, $score)) {
        fail('设备校验失败', 403);
    }
    respond(['status' => 'success']);
}

/* ------------------------------------------------------------------
 * 调试功能解锁（并发/顺序调整）
 * ------------------------------------------------------------------ */
if ($action === 'debug_unlock') {
    $password = isset($input['password']) && is_string($input['password']) ? $input['password'] : '';
    if ($password === '' || strlen($password) > 200) {
        fail('请输入管理员密码');
    }

    $ip = client_ip();
    if (!debug_rate_check($ip)) {
        fail('尝试次数过多，请 10 分钟后再试', 429);
    }

    if (!password_verify($password, debug_admin_hash())) {
        debug_record_failure($ip);
        fail('管理员密码错误', 403);
    }

    debug_clear_failures($ip);
    $token = debug_issue_token();
    respond([
        'status' => 'success',
        'token' => $token,
        'expires_in' => DEBUG_TOKEN_TTL,
    ]);
}

if ($action === 'debug_check') {
    $token = isset($input['token']) && is_string($input['token']) ? $input['token'] : '';
    respond([
        'status' => 'success',
        'valid' => debug_verify_token($token),
    ]);
}

if ($action === 'debug_renew') {
    $token = isset($input['token']) && is_string($input['token']) ? $input['token'] : '';
    if (!debug_renew_token($token)) {
        fail('管理员会话已过期，请重新解锁', 401);
    }
    respond([
        'status' => 'success',
        'expires_in' => DEBUG_TOKEN_TTL,
    ]);
}

/* ------------------------------------------------------------------
 * 6. 代理转发
 * ------------------------------------------------------------------ */

if ($action === 'proxy') {
    $proxyAccount = clean_name($input['account'] ?? '');
    session_require($proxyAccount, clean_text($input['session_token'] ?? '', 200));
    handle_proxy($input);
}
fail('未知动作', 400);

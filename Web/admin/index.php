<?php
declare(strict_types=1);

/**
 * Welearn Helper · 管理后台
 * 登录密码保存在 data/admin.json（password_hash 结果），首次使用默认密码 admin12341。
 * 所有写操作都带 CSRF 校验，并且使用临时文件 + rename 原子写入。
 */

ini_set('display_errors', '0');
error_reporting(E_ALL);

session_set_cookie_params([
    'lifetime' => 0,
    'path' => '/',
    'httponly' => true,
    'samesite' => 'Lax',
    'secure' => !empty($_SERVER['HTTPS']) && strtolower((string) $_SERVER['HTTPS']) !== 'off',
]);
session_start();

const DATA_DIR = __DIR__ . '/../data';
require_once __DIR__ . '/../lib/announcement.php';
const ADMIN_FILE = DATA_DIR . '/admin.json';
const DEFAULT_PASSWORD = 'admin12341';

function h($value): string
{
    return htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function ensure_data_dir(): void
{
    if (!is_dir(DATA_DIR)) {
        @mkdir(DATA_DIR, 0755, true);
    }
}

function read_json(string $file, array $default = []): array
{
    if (!is_file($file)) {
        return $default;
    }
    $raw = @file_get_contents($file);
    if ($raw === false || trim($raw) === '') {
        return $default;
    }
    $data = json_decode($raw, true);
    return is_array($data) ? $data : $default;
}

function write_json(string $file, array $data): bool
{
    ensure_data_dir();
    $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    if ($json === false) {
        return false;
    }
    $tmp = $file . '.tmp.' . bin2hex(random_bytes(6));
    if (@file_put_contents($tmp, $json, LOCK_EX) === false) {
        return false;
    }
    @chmod($tmp, 0644);
    if (!@rename($tmp, $file)) {
        @unlink($tmp);
        return false;
    }
    return true;
}

function csrf_token(): string
{
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(16));
    }
    return (string) $_SESSION['csrf'];
}

function csrf_ok(): bool
{
    return isset($_POST['csrf'], $_SESSION['csrf'])
        && is_string($_POST['csrf'])
        && hash_equals((string) $_SESSION['csrf'], $_POST['csrf']);
}

function admin_hash(): string
{
    $data = read_json(ADMIN_FILE, []);
    if (!empty($data['hash']) && is_string($data['hash'])) {
        return $data['hash'];
    }
    return password_hash(DEFAULT_PASSWORD, PASSWORD_DEFAULT);
}

function is_default_password(): bool
{
    $data = read_json(ADMIN_FILE, []);
    return empty($data['hash']);
}

function redirect_self(): void
{
    header('Location: ' . strtok($_SERVER['REQUEST_URI'] ?? 'index.php', '?'));
    exit;
}

function flash(string $type, string $text): void
{
    $_SESSION['flash'] = ['type' => $type, 'text' => $text];
}

$error = '';

/* ------------------------------------------------------------------
 * 登录 / 退出
 * ------------------------------------------------------------------ */
if (isset($_POST['action']) && $_POST['action'] === 'login') {
    if (!csrf_ok()) {
        $error = '会话已过期，请刷新页面后重试。';
    } elseif ((int) ($_SESSION['attempts'] ?? 0) >= 8) {
        $error = '尝试次数过多，请关闭浏览器后重试。';
    } elseif (password_verify((string) ($_POST['password'] ?? ''), admin_hash())) {
        session_regenerate_id(true);
        $_SESSION['admin'] = true;
        $_SESSION['attempts'] = 0;
        unset($_SESSION['csrf']);

        if (is_default_password()) {
            write_json(ADMIN_FILE, [
                'hash' => password_hash(DEFAULT_PASSWORD, PASSWORD_DEFAULT),
                'updated' => date('c'),
            ]);
        }
        redirect_self();
    } else {
        $_SESSION['attempts'] = (int) ($_SESSION['attempts'] ?? 0) + 1;
        usleep(350000);
        $error = '密码错误，请重试。';
    }
}

if (isset($_GET['logout'])) {
    $_SESSION = [];
    session_destroy();
    header('Location: index.php');
    exit;
}

$loggedIn = !empty($_SESSION['admin']);

/* ------------------------------------------------------------------
 * 后台操作
 * ------------------------------------------------------------------ */
if ($loggedIn && isset($_POST['action'])) {
    if (!csrf_ok()) {
        flash('err', '操作失败：会话已过期，请刷新后重试。');
    } else {
        switch ($_POST['action']) {
            case 'announce':
                $message = trim((string) ($_POST['message'] ?? ''));
                if (function_exists('mb_substr')) {
                    $message = mb_substr($message, 0, 4000, 'UTF-8');
                }
                write_json(DATA_DIR . '/announcement.json', ['message' => $message]);
                flash('ok', '公告已保存。');
                break;

            case 'announce_default':
                write_json(DATA_DIR . '/announcement.json', ['message' => DEFAULT_ANNOUNCEMENT_MESSAGE]);
                flash('ok', '已恢复新版默认公告。');
                break;

            case 'oneclick':
                $accMin = max(0, min(100, (int) ($_POST['accuracy_min'] ?? 96)));
                $accMax = max(0, min(100, (int) ($_POST['accuracy_max'] ?? 100)));
                $timeMin = max(1, min(1440, (int) ($_POST['time_min_minutes'] ?? 500)));
                $timeMax = max(1, min(1440, (int) ($_POST['time_max_minutes'] ?? 550)));
                if ($accMin > $accMax) { $tmp = $accMin; $accMin = $accMax; $accMax = $tmp; }
                if ($timeMin > $timeMax) { $tmp = $timeMin; $timeMin = $timeMax; $timeMax = $tmp; }
                write_json(DATA_DIR . '/oneclick.json', [
                    'accuracy_min' => $accMin,
                    'accuracy_max' => $accMax,
                    'time_min_minutes' => $timeMin,
                    'time_max_minutes' => $timeMax,
                    'updated' => date('c'),
                ]);
                flash('ok', '一键完成参数已保存。');
                break;

            case 'ticker':
                $message = trim((string) ($_POST['ticker_message'] ?? ''));
                if (function_exists('mb_substr')) {
                    $message = mb_substr($message, 0, 4000, 'UTF-8');
                }
                write_json(DATA_DIR . '/ticker.json', ['message' => $message]);
                flash('ok', '顶部滚动公告已保存。');
                break;

            case 'password':
                $current = (string) ($_POST['current'] ?? '');
                $next = (string) ($_POST['next'] ?? '');
                $confirm = (string) ($_POST['confirm'] ?? '');
                if (!password_verify($current, admin_hash())) {
                    flash('err', '当前密码不正确。');
                } elseif (strlen($next) < 8) {
                    flash('err', '新密码至少 8 位。');
                } elseif ($next !== $confirm) {
                    flash('err', '两次输入的新密码不一致。');
                } else {
                    write_json(ADMIN_FILE, [
                        'hash' => password_hash($next, PASSWORD_DEFAULT),
                        'updated' => date('c'),
                    ]);
                    flash('ok', '密码已更新，下次登录请使用新密码。');
                }
                break;

            case 'maintenance':
                $enabled = !empty($_POST['enabled']);
                $message = trim((string) ($_POST['maintenance_message'] ?? ''));
                if (function_exists('mb_substr')) {
                    $message = mb_substr($message, 0, 400, 'UTF-8');
                }
                write_json(DATA_DIR . '/maintenance.json', [
                    'enabled' => $enabled,
                    'message' => $message,
                    'updated' => date('c'),
                ]);
                flash('ok', $enabled ? '维护模式已开启，非管理员将被禁止使用。' : '维护模式已关闭。');
                break;

            case 'clear_tasks':
                $username = (string) ($_POST['username'] ?? '');
                $users = read_json(DATA_DIR . '/users.json', []);
                if ($username !== '' && isset($users[$username]) && is_array($users[$username])) {
                    $users[$username]['tasks'] = [];
                    write_json(DATA_DIR . '/users.json', $users);
                    flash('ok', '已清空该用户的任务记录。');
                } else {
                    flash('err', '未找到该用户。');
                }
                break;

            default:
                flash('err', '未知操作。');
        }
    }
    redirect_self();
}

$flash = isset($_SESSION['flash']) && is_array($_SESSION['flash']) ? $_SESSION['flash'] : null;
unset($_SESSION['flash']);

/* ------------------------------------------------------------------
 * 读取数据
 * ------------------------------------------------------------------ */
$users = read_json(DATA_DIR . '/users.json', []);
$stats = array_merge(
    ['visits' => 0, 'logins' => 0, 'runs' => 0],
    read_json(DATA_DIR . '/stats.json', [])
);
$announcement = read_json(DATA_DIR . '/announcement.json', []);
$announceMessage = isset($announcement['message']) ? (string) $announcement['message'] : '';
$oneClickConfig = read_json(DATA_DIR . '/oneclick.json', [
    'accuracy_min' => 96,
    'accuracy_max' => 100,
    'time_min_minutes' => 500,
    'time_max_minutes' => 550,
]);
$ticker = read_json(DATA_DIR . '/ticker.json', []);
$tickerMessage = isset($ticker['message']) ? (string) $ticker['message'] : '';
$maintenance = read_json(DATA_DIR . '/maintenance.json', []);
$maintenanceEnabled = !empty($maintenance['enabled']);
$maintenanceMessage = isset($maintenance['message']) ? (string) $maintenance['message'] : '';
$usingDefaultPassword = password_verify(DEFAULT_PASSWORD, admin_hash());

$taskTotal = 0;
foreach ($users as $user) {
    if (isset($user['tasks']) && is_array($user['tasks'])) {
        $taskTotal += count($user['tasks']);
    }
}

/* 最近登录优先 */
$userRows = [];
foreach ($users as $name => $data) {
    if (!is_array($data)) {
        continue;
    }
    $userRows[] = [
        'name' => (string) $name,
        'last_login' => (string) ($data['last_login'] ?? ''),
        'last_active' => (string) ($data['last_active'] ?? ''),
        'ip' => (string) ($data['ip'] ?? ''),
        'tasks' => isset($data['tasks']) && is_array($data['tasks']) ? $data['tasks'] : [],
    ];
}
usort($userRows, function ($a, $b) {
    return strcmp($b['last_login'], $a['last_login']);
});
$userRows = array_slice($userRows, 0, 200);
?>
<!DOCTYPE html>
<html lang="zh-CN" data-theme="light">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <title>Welearn Helper · 管理后台</title>
    <script>
        (function () {
            try {
                var t = localStorage.getItem('wl_theme');
                document.documentElement.setAttribute('data-theme', t === 'dark' ? 'dark' : 'light');
            } catch (e) {}
        })();
    </script>
    <style>
        :root {
            color-scheme: light;
            --bg: #f3f6fa; --surface: #fff; --surface-2: #f7f9fc; --surface-3: #eef2f7;
            --border: #e3e9f1; --text: #111c2c; --text-2: #46566d; --muted: #74839a;
            --brand: #0f766e; --brand-ink: #fff; --brand-soft: rgba(15,118,110,.10);
            --ok: #15803d; --ok-soft: rgba(21,128,61,.10);
            --warn: #b45309; --warn-soft: rgba(180,83,9,.10);
            --danger: #c0392b; --danger-soft: rgba(192,57,43,.10);
            --shadow: 0 1px 2px rgba(15,23,42,.04), 0 10px 28px rgba(15,23,42,.06);
            --radius: 16px;
            --font: "Segoe UI","PingFang SC","Microsoft YaHei",system-ui,sans-serif;
            --mono: "Cascadia Mono",Consolas,monospace;
        }
        :root[data-theme="dark"] {
            color-scheme: dark;
            --bg: #070d16; --surface: #0e1826; --surface-2: #121e2e; --surface-3: #17253a;
            --border: #1e2d42; --text: #e8eef7; --text-2: #b6c4d6; --muted: #7f91a8;
            --brand: #2dd4bf; --brand-ink: #04211e; --brand-soft: rgba(45,212,191,.13);
            --ok: #4ade80; --ok-soft: rgba(74,222,128,.13);
            --warn: #fbbf24; --warn-soft: rgba(251,191,36,.13);
            --danger: #f87171; --danger-soft: rgba(248,113,113,.13);
            --shadow: 0 1px 2px rgba(0,0,0,.4), 0 14px 40px rgba(0,0,0,.35);
        }
        * { box-sizing: border-box; }
        body {
            margin: 0; font: 14px/1.55 var(--font); color: var(--text); background: var(--bg);
            background-image: radial-gradient(38rem 30rem at 12% -8%, var(--brand-soft), transparent 70%);
            min-height: 100vh;
        }
        a { color: var(--brand); text-decoration: none; }
        a:hover { text-decoration: underline; }
        .wrap { width: min(1120px, 100%); margin: 0 auto; padding: 20px; }
        .topbar {
            display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
            background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
            padding: 12px 16px; box-shadow: var(--shadow); position: sticky; top: 10px; z-index: 10;
        }
        .logo {
            width: 38px; height: 38px; border-radius: 12px; display: grid; place-items: center;
            background: linear-gradient(135deg, #0d9488, #0284c7); color: #fff; font-weight: 800;
        }
        .title { font-weight: 700; font-size: 15px; }
        .sub { font-size: 12px; color: var(--muted); }
        .spacer { margin-left: auto; }
        .btn {
            height: 34px; padding: 0 14px; border-radius: 9px; border: 1px solid var(--border);
            background: var(--surface); color: var(--text); font: 600 12.5px var(--font);
            cursor: pointer; display: inline-flex; align-items: center; gap: 6px;
        }
        .btn:hover { background: var(--surface-2); }
        .btn-primary { background: var(--brand); border-color: var(--brand); color: var(--brand-ink); }
        .btn-primary:hover { filter: brightness(1.05); background: var(--brand); }
        .btn-danger { color: var(--danger); border-color: var(--danger); background: transparent; }
        .btn-danger:hover { background: var(--danger-soft); }
        .btn-sm { height: 28px; padding: 0 10px; font-size: 11.5px; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; margin: 16px 0; }
        .card {
            background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
            box-shadow: var(--shadow); padding: 16px 18px;
        }
        .stat { display: flex; flex-direction: column; gap: 6px; }
        .stat .v { font-size: 28px; font-weight: 800; line-height: 1; font-variant-numeric: tabular-nums; }
        .stat .l { font-size: 12px; color: var(--muted); }
        .cols { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 14px; margin-bottom: 16px; }
        h2 { font-size: 13.5px; margin: 0 0 12px; letter-spacing: .2px; }
        label { display: block; font-size: 12px; color: var(--text-2); font-weight: 600; margin: 10px 0 5px; }
        input[type=text], input[type=password], textarea {
            width: 100%; padding: 9px 11px; border: 1px solid var(--border); border-radius: 9px;
            background: var(--surface-2); color: var(--text); font: inherit;
        }
        textarea { min-height: 110px; resize: vertical; line-height: 1.6; }
        input:focus, textarea:focus { outline: none; border-color: var(--brand); box-shadow: 0 0 0 3px var(--brand-soft); }
        .actions { margin-top: 12px; display: flex; gap: 8px; flex-wrap: wrap; }
        .notice { padding: 10px 12px; border-radius: 9px; font-size: 12.5px; margin-bottom: 14px; }
        .notice-ok { background: var(--ok-soft); color: var(--ok); }
        .notice-err { background: var(--danger-soft); color: var(--danger); }
        .notice-warn { background: var(--warn-soft); color: var(--warn); }
        table { width: 100%; border-collapse: collapse; }
        th { text-align: left; font-size: 11.5px; color: var(--muted); font-weight: 600; padding: 10px 12px; border-bottom: 1px solid var(--border); white-space: nowrap; }
        td { padding: 12px; border-bottom: 1px solid var(--border); vertical-align: top; font-size: 13px; }
        tr:last-child td { border-bottom: 0; }
        .table-wrap { overflow-x: auto; }
        .mono { font-family: var(--mono); font-size: 12px; color: var(--muted); }
        .tag { display: inline-block; padding: 3px 8px; border-radius: 6px; font-size: 11px; font-weight: 700; margin: 0 4px 4px 0; }
        .tag-task { background: var(--brand-soft); color: var(--brand); }
        .tag-ok { background: var(--ok-soft); color: var(--ok); }
        .tag-err { background: var(--danger-soft); color: var(--danger); }
        .empty { color: var(--muted); text-align: center; padding: 26px; font-size: 12.5px; }
        .login-wrap { min-height: 100vh; display: grid; place-items: center; padding: 20px; }
        .login-card { width: min(380px, 100%); }
        .login-card h1 { font-size: 20px; margin: 0 0 4px; }
        .login-card p { margin: 0 0 16px; color: var(--muted); font-size: 12.5px; }
        .login-card .btn { width: 100%; height: 38px; margin-top: 16px; justify-content: center; }
        .foot { text-align: center; color: var(--muted); font-size: 12px; padding: 20px 0 0; }
        @media (max-width: 760px) {
            .cols { grid-template-columns: 1fr; }
            .wrap { padding: 12px; }
            .topbar { top: 6px; }
        }
    </style>
</head>
<body>
<?php if (!$loggedIn): ?>
    <div class="login-wrap">
        <form class="card login-card" method="POST" autocomplete="off">
            <div class="logo" style="margin-bottom:14px">W</div>
            <h1>Welearn Helper</h1>
            <p>管理后台 · 请输入管理员密码</p>

            <?php if ($error !== ''): ?>
                <div class="notice notice-err"><?= h($error) ?></div>
            <?php endif; ?>

            <input type="hidden" name="action" value="login" />
            <input type="hidden" name="csrf" value="<?= h(csrf_token()) ?>" />
            <label for="password">密码</label>
            <input id="password" name="password" type="password" required autofocus />
            <button class="btn btn-primary" type="submit">登录</button>

            <div style="margin-top:14px;font-size:12px;color:var(--muted);text-align:center">
                <a href="../index.php">← 返回控制台</a>
            </div>
        </form>
    </div>
<?php else: ?>
    <div class="wrap">
        <header class="topbar">
            <div class="logo">W</div>
            <div>
                <div class="title">Welearn Helper 管理后台</div>
                <div class="sub">站点数据 · 公告 · 用户记录</div>
            </div>
            <div class="spacer"></div>
            <a class="btn" href="../index.php">控制台</a>
            <button class="btn" type="button" id="themeBtn">切换主题</button>
            <button class="btn btn-danger" type="button" onclick="location.href='?logout=1'">退出</button>
        </header>

        <div class="grid">
            <div class="card stat"><span class="v"><?= h(count($users)) ?></span><span class="l">累计用户数</span></div>
            <div class="card stat"><span class="v" style="color:var(--brand)"><?= h((int) ($stats['visits'] ?? 0)) ?></span><span class="l">页面访问</span></div>
            <div class="card stat"><span class="v" style="color:var(--ok)"><?= h((int) ($stats['logins'] ?? 0)) ?></span><span class="l">成功登录</span></div>
            <div class="card stat"><span class="v" style="color:var(--warn)"><?= h((int) ($stats['runs'] ?? 0)) ?></span><span class="l">任务运行</span></div>
            <div class="card stat"><span class="v"><?= h($taskTotal) ?></span><span class="l">记录的任务结果</span></div>
        </div>

        <?php if ($flash): ?>
            <div class="notice <?= $flash['type'] === 'ok' ? 'notice-ok' : 'notice-err' ?>"><?= h($flash['text']) ?></div>
        <?php endif; ?>

        <?php if ($usingDefaultPassword): ?>
            <div class="notice notice-warn">当前仍在使用默认密码 <b>admin12341</b>，请立即在下方「修改后台密码」中更换。</div>
        <?php endif; ?>

        <div class="cols">
            <section class="card">
                <h2>首页弹窗公告</h2>
                <form method="POST">
                    <input type="hidden" name="action" value="announce" />
                    <input type="hidden" name="csrf" value="<?= h(csrf_token()) ?>" />
                    <label for="message">公告内容（打开网页强制 5 秒弹窗；留空则不弹）</label>
                    <textarea id="message" name="message" placeholder="支持换行，建议写重要通知。"><?= h($announceMessage) ?></textarea>
                    <div class="actions"><button class="btn btn-primary" type="submit">保存公告</button></div>
                </form>
                <form method="POST" style="margin-top:8px">
                    <input type="hidden" name="action" value="announce_default" />
                    <input type="hidden" name="csrf" value="<?= h(csrf_token()) ?>" />
                    <button class="btn" type="submit">恢复新版默认公告</button>
                </form>
            </section>

            <section class="card">
                <h2>顶部滚动公告</h2>
                <form method="POST">
                    <input type="hidden" name="action" value="ticker" />
                    <input type="hidden" name="csrf" value="<?= h(csrf_token()) ?>" />
                    <label for="ticker_message">每行一条，按顺序从右到左滚动，不可关闭</label>
                    <textarea id="ticker_message" name="ticker_message" placeholder="例如：
2026-11-15 更新真实答案
2026-11-15 新增一键续刷"><?= h($tickerMessage) ?></textarea>
                    <div class="actions"><button class="btn btn-primary" type="submit">保存滚动公告</button></div>
                </form>
            </section>

            <section class="card">
                <h2>一键完成参数</h2>
                <form method="POST">
                    <input type="hidden" name="action" value="oneclick" />
                    <input type="hidden" name="csrf" value="<?= h(csrf_token()) ?>" />
                    <label>正确率范围（100% 不再需要管理员解锁）</label>
                    <div class="row">
                        <input name="accuracy_min" type="number" min="0" max="100" value="<?= (int) ($oneClickConfig['accuracy_min'] ?? 96) ?>" />
                        <span>—</span>
                        <input name="accuracy_max" type="number" min="0" max="100" value="<?= (int) ($oneClickConfig['accuracy_max'] ?? 100) ?>" />
                    </div>
                    <label style="margin-top:10px">总时长范围（分钟）</label>
                    <div class="row">
                        <input name="time_min_minutes" type="number" min="1" max="1440" value="<?= (int) ($oneClickConfig['time_min_minutes'] ?? 500) ?>" />
                        <span>—</span>
                        <input name="time_max_minutes" type="number" min="1" max="1440" value="<?= (int) ($oneClickConfig['time_max_minutes'] ?? 550) ?>" />
                    </div>
                    <div class="actions"><button class="btn btn-primary" type="submit">保存一键配置</button></div>
                </form>
            </section>

            <section class="card">
                <h2>系统维护</h2>
                <form method="POST">
                    <input type="hidden" name="action" value="maintenance" />
                    <input type="hidden" name="csrf" value="<?= h(csrf_token()) ?>" />
                    <label class="check" style="display:flex;align-items:center;gap:8px;margin:8px 0">
                        <input type="checkbox" name="enabled" value="1" <?= $maintenanceEnabled ? 'checked' : '' ?> />
                        开启维护模式（非管理员禁止使用）
                    </label>
                    <label for="maintenance_message">维护提示</label>
                    <input id="maintenance_message" name="maintenance_message" maxlength="400"
                           value="<?= h($maintenanceMessage) ?>" placeholder="例如：系统维护中，预计 22:00 恢复。" />
                    <div class="actions"><button class="btn btn-primary" type="submit">保存维护设置</button></div>
                </form>
                <?php if ($maintenanceEnabled): ?>
                    <div class="notice notice-warn" style="margin-top:10px">当前维护模式已开启。</div>
                <?php endif; ?>
            </section>

            <section class="card">
                <h2>修改后台密码</h2>
                <form method="POST" autocomplete="off">
                    <input type="hidden" name="action" value="password" />
                    <input type="hidden" name="csrf" value="<?= h(csrf_token()) ?>" />
                    <label for="current">当前密码</label>
                    <input id="current" name="current" type="password" required />
                    <label for="next">新密码（至少 8 位）</label>
                    <input id="next" name="next" type="password" minlength="8" required />
                    <label for="confirm">确认新密码</label>
                    <input id="confirm" name="confirm" type="password" minlength="8" required />
                    <div class="actions"><button class="btn btn-primary" type="submit">更新密码</button></div>
                </form>
            </section>
        </div>

        <section class="card">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
                <h2 style="margin:0">用户与任务记录</h2>
                <span class="sub" style="margin-left:auto">按最后登录时间排序，最多显示 200 条</span>
            </div>
            <div class="table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th style="width:22%">用户</th>
                            <th style="width:24%">最后登录 / 来源</th>
                            <th style="width:54%">任务记录</th>
                        </tr>
                    </thead>
                    <tbody>
                    <?php if (!$userRows): ?>
                        <tr><td colspan="3" class="empty">暂无用户数据</td></tr>
                    <?php endif; ?>
                    <?php foreach ($userRows as $row): ?>
                        <?php $tasks = array_slice(array_reverse($row['tasks']), 0, 6); ?>
                        <tr>
                            <td><b style="word-break:break-all"><?= h($row['name']) ?></b></td>
                            <td>
                                <div><?= h($row['last_login'] !== '' ? $row['last_login'] : '—') ?></div>
                                <div class="mono"><?= h($row['ip'] !== '' ? $row['ip'] : '—') ?></div>
                            </td>
                            <td>
                                <?php if (!$tasks): ?>
                                    <span class="mono">暂无任务记录</span>
                                <?php endif; ?>
                                <?php foreach ($tasks as $task): ?>
                                    <?php
                                        $isTime = (($task['type'] ?? '') === 'time');
                                        $okCount = (int) ($task['success'] ?? 0);
                                        $failCount = (int) ($task['failed'] ?? 0);
                                        $paramText = trim((string) ($task['param'] ?? ''));
                                        $targetText = trim((string) ($task['target'] ?? ''));
                                        $detail = '参数 ' . ($paramText !== '' ? $paramText : '—');
                                        if ($targetText !== '') {
                                            $detail .= ' · ' . $targetText;
                                        }
                                    ?>
                                    <span class="tag tag-task"><?= $isTime ? '刷时长' : '刷正确率' ?></span>
                                    <span class="tag <?= $failCount > 0 ? 'tag-err' : 'tag-ok' ?>">
                                        成功 <?= h($okCount) ?> / 失败 <?= h($failCount) ?>
                                    </span>
                                    <span class="mono"><?= h((string) ($task['time'] ?? '')) ?></span>
                                    <div class="mono" style="margin-top:4px;word-break:break-all">
                                        <?= h($detail) ?>
                                    </div>
                                <?php endforeach; ?>
                                <?php if ($row['tasks']): ?>
                                    <form method="POST" style="margin-top:8px" onsubmit="return confirm('确定清空该用户的任务记录？');">
                                        <input type="hidden" name="action" value="clear_tasks" />
                                        <input type="hidden" name="username" value="<?= h($row['name']) ?>" />
                                        <input type="hidden" name="csrf" value="<?= h(csrf_token()) ?>" />
                                        <button class="btn btn-sm" type="submit">清空记录</button>
                                    </form>
                                <?php endif; ?>
                            </td>
                        </tr>
                    <?php endforeach; ?>
                    </tbody>
                </table>
            </div>
        </section>

        <div class="foot">数据文件位于 <span class="mono">data/</span> · 请定期备份 users.json / stats.json / announcement.json</div>
    </div>
<?php endif; ?>

<script>
    (function () {
        var btn = document.getElementById('themeBtn');
        if (!btn) return;
        btn.addEventListener('click', function () {
            var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', next);
            try { localStorage.setItem('wl_theme', next); } catch (e) {}
        });
    })();
</script>
</body>
</html>

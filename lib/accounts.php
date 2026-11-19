<?php
declare(strict_types=1);

/**
 * Per-account records in data/<account>.json.
 * Passwords are optional and encrypted at rest with data/.secret.
 */

const ACCOUNT_MAX_RUNS = 50;
const ACCOUNT_DEVICE_TTL = 30 * 86400;

function account_name(string $raw): string
{
    $name = preg_replace('/[^0-9A-Za-z_@.\-]/', '_', trim($raw));
    $name = substr((string) $name, 0, 80);
    return $name === '' ? 'unknown' : $name;
}

function account_file(string $account): string
{
    return account_name($account) . '.json';
}

function account_secret(): string
{
    $file = DATA_DIR . '/.secret';
    if (is_file($file)) {
        $raw = @file_get_contents($file);
        if (is_string($raw) && strlen($raw) >= 32) {
            return substr($raw, 0, 32);
        }
    }
    ensure_data_dir();
    $secret = random_bytes(32);
    @file_put_contents($file, $secret, LOCK_EX);
    @chmod($file, 0600);
    return $secret;
}

function account_encrypt(string $plain): string
{
    $key = account_secret();
    $iv = random_bytes(12);
    $tag = '';
    $cipher = openssl_encrypt($plain, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag);
    if ($cipher === false) {
        throw new RuntimeException('encrypt failed');
    }
    return base64_encode($iv . $tag . $cipher);
}

function account_decrypt(string $encoded): string
{
    $raw = base64_decode($encoded, true);
    if (!is_string($raw) || strlen($raw) < 29) {
        return '';
    }
    $key = account_secret();
    $iv = substr($raw, 0, 12);
    $tag = substr($raw, 12, 16);
    $cipher = substr($raw, 28);
    $plain = openssl_decrypt($cipher, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag);
    return is_string($plain) ? $plain : '';
}

function account_read(string $account): array
{
    $data = read_json_file(account_file($account), []);
    return is_array($data) ? $data : [];
}

function account_write(string $account, array $data): void
{
    write_json_file(account_file($account), $data);
}

function account_save_login(string $account, string $password, bool $savePassword, string $deviceToken): void
{
    if ($account === '') {
        return;
    }
    $now = date('c');
    mutate_json_file(account_file($account), function (array &$data) use ($account, $password, $savePassword, $deviceToken, $now) {
        if (!isset($data['account'])) {
            $data['account'] = $account;
            $data['created_at'] = $now;
        }
        $data['last_login'] = $now;
        $data['login_count'] = (int) ($data['login_count'] ?? 0) + 1;

        if ($savePassword && $password !== '') {
            $data['password_enc'] = account_encrypt($password);
            $data['password_saved'] = true;
            $data['password_updated'] = $now;
            if ($deviceToken !== '') {
                $data['device_hash'] = hash('sha256', $deviceToken);
            }
        }

        if (!isset($data['runs']) || !is_array($data['runs'])) {
            $data['runs'] = [];
        }
    }, []);
}

function account_save_run(string $account, array $run): void
{
    if ($account === '') {
        return;
    }
    $now = date('c');
    mutate_json_file(account_file($account), function (array &$data) use ($account, $run, $now) {
        if (!isset($data['account'])) {
            $data['account'] = $account;
            $data['created_at'] = $now;
        }
        if (!isset($data['runs']) || !is_array($data['runs'])) {
            $data['runs'] = [];
        }
        $data['runs'][] = $run;
        if (count($data['runs']) > ACCOUNT_MAX_RUNS) {
            $data['runs'] = array_slice($data['runs'], -ACCOUNT_MAX_RUNS);
        }
        $data['last_complete'] = $now;
    }, []);
}

function account_restore_password(string $account, string $deviceToken): string
{
    if ($account === '' || $deviceToken === '') {
        return '';
    }
    $data = account_read($account);
    if (empty($data['password_saved']) || empty($data['password_enc']) || empty($data['device_hash'])) {
        return '';
    }
    if (!hash_equals((string) $data['device_hash'], hash('sha256', $deviceToken))) {
        return '';
    }
    return account_decrypt((string) $data['password_enc']);
}


/* ---- 章节学习进度（以服务端记录为准，取历史最大值） ---- */
function account_progress_get(string $account, string $cid, string $deviceToken): array
{
    $empty = ['progress' => [], 'done' => [], 'one_click' => null, 'score' => null];
    if ($account === '') return $empty;
    $data = account_read($account);
    if (!empty($data['device_hash']) &&
        !hash_equals((string) $data['device_hash'], hash('sha256', $deviceToken))) {
        return $empty;
    }
    $course = $data['progress'][$cid] ?? [];
    if (!is_array($course)) $course = [];
    $progress = [];
    $done = [];
    foreach ($course as $scoid => $item) {
        if (!is_array($item)) continue;
        $progress[(string) $scoid] = max(0, (int) ($item['seconds'] ?? 0));
        if (!empty($item['done'])) $done[(string) $scoid] = true;
    }
    $oneClick = $data['one_click'][$cid] ?? null;
    if (!is_array($oneClick)) $oneClick = null;
    $score = $data['score'][$cid] ?? null;
    if (!is_array($score)) $score = null;
    return ['progress' => $progress, 'done' => $done, 'one_click' => $oneClick, 'score' => $score];
}

function account_progress_save(string $account, string $cid, array $items, string $deviceToken, ?array $oneClick = null, ?array $score = null): bool
{
    if ($account === '' || $cid === '' || $deviceToken === '') return false;
    $data = account_read($account);
    if (!empty($data['device_hash']) &&
        !hash_equals((string) $data['device_hash'], hash('sha256', $deviceToken))) {
        return false;
    }
    $now = date('c');
    mutate_json_file(account_file($account), function (array &$data) use ($account, $cid, $items, $deviceToken, $oneClick, $score, $now) {
        if (!isset($data['account'])) {
            $data['account'] = $account;
            $data['created_at'] = $now;
        }
        if (empty($data['device_hash'])) {
            $data['device_hash'] = hash('sha256', $deviceToken);
        }
        if (!isset($data['progress']) || !is_array($data['progress'])) {
            $data['progress'] = [];
        }
        if (!isset($data['progress'][$cid]) || !is_array($data['progress'][$cid])) {
            $data['progress'][$cid] = [];
        }
        foreach ($items as $item) {
            if (!is_array($item)) continue;
            $scoid = preg_replace('/[^0-9A-Za-z_@.\-]/', '_', (string) ($item['scoid'] ?? ''));
            $seconds = max(0, min(86400, (int) ($item['seconds'] ?? 0)));
            if ($scoid === '' || $seconds <= 0) continue;
            $old = isset($data['progress'][$cid][$scoid]['seconds'])
                ? (int) $data['progress'][$cid][$scoid]['seconds'] : 0;
            $target = max(0, min(86400, (int) ($item['target'] ?? 0)));
            $data['progress'][$cid][$scoid] = [
                'seconds' => max($old, $seconds),
                'target' => $target,
                'done' => !empty($item['done']) || !empty($data['progress'][$cid][$scoid]['done']),
                'updated' => $now,
            ];
        }
        if (count($data['progress'][$cid]) > 2000) {
            $data['progress'][$cid] = array_slice($data['progress'][$cid], -2000, null, true);
        }
        if (is_array($oneClick)) {
            $total = max(0, min(864000, (int) ($oneClick['total'] ?? 0)));
            $credited = max(0, min($total, (int) ($oneClick['credited'] ?? 0)));
            if ($total > 0) {
                $data['one_click'][$cid] = [
                    'total' => $total,
                    'credited' => $credited,
                    'updated' => $now,
                ];
            }
        }
        if (is_array($score)) {
            $data['score'][$cid] = [
                'total' => max(0, min(1000, (float) ($score['total'] ?? 0))),
                'listening' => max(0, min(1000, (float) ($score['listening'] ?? 0))),
                'writing' => max(0, min(1000, (float) ($score['writing'] ?? 0))),
                'correct_rate' => (string) ($score['correct_rate'] ?? ''),
                'learn_time' => (string) ($score['learn_time'] ?? ''),
                'progress' => (string) ($score['progress'] ?? ''),
                'updated' => $now,
            ];
        }
    }, []);
    return true;
}

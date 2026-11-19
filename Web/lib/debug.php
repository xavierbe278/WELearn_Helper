<?php
declare(strict_types=1);

/**
 * 调试功能解锁：并发/顺序调整需要管理员密码。
 * 密码哈希与后台共用 data/admin.json；未设置时回退到后台默认密码。
 * 解锁后发放 2 小时有效的随机 token，token 哈希存 data/debug_tokens.json。
 */

const DEBUG_DEFAULT_PASSWORD = 'admin12341';
const DEBUG_TOKEN_TTL = 7200;
const DEBUG_MAX_ATTEMPTS = 5;
const DEBUG_ATTEMPT_WINDOW = 600;

function debug_admin_hash(): string
{
    $data = read_json_file('admin.json', []);
    if (is_array($data) && !empty($data['hash']) && is_string($data['hash'])) {
        return $data['hash'];
    }
    return password_hash(DEBUG_DEFAULT_PASSWORD, PASSWORD_DEFAULT);
}

function debug_rate_check(string $ip): bool
{
    $now = time();
    $data = read_json_file('debug_attempts.json', []);
    if (!is_array($data)) {
        $data = [];
    }
    $list = isset($data[$ip]) && is_array($data[$ip]) ? $data[$ip] : [];
    $list = array_values(array_filter($list, function ($ts) use ($now) {
        return is_numeric($ts) && $now - (int) $ts < DEBUG_ATTEMPT_WINDOW;
    }));
    return count($list) < DEBUG_MAX_ATTEMPTS;
}

function debug_record_failure(string $ip): void
{
    $now = time();
    mutate_json_file('debug_attempts.json', function (array &$data) use ($ip, $now) {
        $list = isset($data[$ip]) && is_array($data[$ip]) ? $data[$ip] : [];
        $list = array_values(array_filter($list, function ($ts) use ($now) {
            return is_numeric($ts) && $now - (int) $ts < DEBUG_ATTEMPT_WINDOW;
        }));
        $list[] = $now;
        $data[$ip] = array_slice($list, -DEBUG_MAX_ATTEMPTS);
    }, []);
}

function debug_clear_failures(string $ip): void
{
    mutate_json_file('debug_attempts.json', function (array &$data) use ($ip) {
        unset($data[$ip]);
    }, []);
}

function debug_issue_token(): string
{
    $token = bin2hex(random_bytes(24));
    $hash = hash('sha256', $token);
    $expires = time() + DEBUG_TOKEN_TTL;

    mutate_json_file('debug_tokens.json', function (array &$data) use ($hash, $expires) {
        $now = time();
        foreach ($data as $key => $value) {
            if (!is_numeric($value) || (int) $value < $now) {
                unset($data[$key]);
            }
        }
        $data[$hash] = $expires;
    }, []);

    return $token;
}

/** 管理员页面打开期间续期；浏览器关闭后没有请求，token 到 TTL 自然过期。 */
function debug_renew_token(string $token): bool
{
    $token = trim($token);
    if ($token === '' || strlen($token) > 200) return false;
    $hash = hash('sha256', $token);
    $ok = false;
    $now = time();
    mutate_json_file('debug_tokens.json', function (array &$data) use ($hash, $now, &$ok) {
        foreach ($data as $key => $value) {
            if (!is_numeric($value) || (int) $value < $now) {
                unset($data[$key]);
            }
        }
        if (isset($data[$hash]) && (int) $data[$hash] > $now) {
            $data[$hash] = time() + DEBUG_TOKEN_TTL;
            $ok = true;
        }
    }, []);
    return $ok;
}

function debug_verify_token(string $token): bool
{
    $token = trim($token);
    if ($token === '' || strlen($token) > 200) {
        return false;
    }
    $hash = hash('sha256', $token);
    $data = read_json_file('debug_tokens.json', []);
    if (!is_array($data) || !isset($data[$hash])) {
        return false;
    }
    return (int) $data[$hash] > time();
}

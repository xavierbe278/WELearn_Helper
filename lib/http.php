<?php
declare(strict_types=1);

/* HTTP 响应 / JSON 存储 / 文本清洗 */

function respond(array $payload, int $status = 200): void
{
    http_response_code($status);
    echo json_encode(
        $payload,
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE
    );
    exit;
}

function fail(string $message, int $status = 400): void
{
    respond(['error' => $message], $status);
}

function ensure_data_dir(): void
{
    if (!is_dir(DATA_DIR)) {
        @mkdir(DATA_DIR, 0755, true);
    }
}

function read_json_file(string $name, $default = [])
{
    $file = DATA_DIR . '/' . $name;
    if (!is_file($file)) {
        return $default;
    }
    $fp = @fopen($file, 'rb');
    if (!$fp) {
        return $default;
    }
    @flock($fp, LOCK_SH);
    $raw = stream_get_contents($fp);
    @flock($fp, LOCK_UN);
    @fclose($fp);

    if ($raw === false || trim($raw) === '') {
        return $default;
    }
    $data = json_decode($raw, true);
    return is_array($data) ? $data : $default;
}

function write_json_file(string $name, array $data): bool
{
    ensure_data_dir();
    $file = DATA_DIR . '/' . $name;
    $json = json_encode(
        $data,
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE
    );
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

/**
 * 读取 → 修改 → 原子写回，整个过程持有独立锁文件，保证并发安全。
 */
function mutate_json_file(string $name, callable $mutator, array $default = [])
{
    ensure_data_dir();
    $file = DATA_DIR . '/' . $name;
    $lock = @fopen($file . '.lock', 'c');
    if (!$lock) {
        return null;
    }
    @flock($lock, LOCK_EX);
    try {
        $data = read_json_file($name, $default);
        if (!is_array($data)) {
            $data = $default;
        }
        $result = $mutator($data);
        write_json_file($name, $data);
        return $result;
    } finally {
        @flock($lock, LOCK_UN);
        @fclose($lock);
    }
}

function clean_name($raw): string
{
    if (!is_scalar($raw)) {
        return '';
    }
    $name = trim((string) $raw);
    $name = (string) preg_replace('/[\x00-\x1F\x7F]/u', '', $name);
    if (function_exists('mb_substr')) {
        return mb_substr($name, 0, 64, 'UTF-8');
    }
    return substr($name, 0, 64);
}

function clean_text($raw, int $max = 160): string
{
    if (!is_scalar($raw)) {
        return '';
    }
    $text = trim((string) $raw);
    $text = (string) preg_replace('/[\x00-\x1F\x7F]/u', ' ', $text);
    if (function_exists('mb_substr')) {
        return mb_substr($text, 0, $max, 'UTF-8');
    }
    return substr($text, 0, $max);
}

function client_ip(): string
{
    return isset($_SERVER['REMOTE_ADDR']) ? (string) $_SERVER['REMOTE_ADDR'] : '';
}


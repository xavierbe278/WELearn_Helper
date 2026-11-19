<?php
declare(strict_types=1);

/* 白名单代理：只允许 welearn.sflep.com / sso.sflep.com */

function handle_proxy(array $input): void
{
$url = isset($input['url']) && is_string($input['url']) ? trim($input['url']) : '';
// 课程内容目录可能包含未编码空格（New Progressive College English）；
// curl 7.8x 会直接拒绝，这里先做最小限度的 URL 编码。
$url = str_replace(' ', '%20', $url);
$parts = parse_url($url);
if (!is_array($parts) || empty($parts['scheme']) || empty($parts['host'])) {
    fail('目标地址无效');
}

$scheme = strtolower((string) $parts['scheme']);
$host = strtolower((string) $parts['host']);

if (!in_array($host, ALLOWED_HOSTS, true)) {
    fail('目标域名不在允许列表', 403);
}

/* 学校登录回调可能是 http://welearn.sflep.com/...，统一升级到 https，
   既保留 https-only 的安全约束，又不会让登录链路断掉。 */
if ($scheme === 'http') {
    $url = 'https://' . substr($url, strlen('http://'));
    $scheme = 'https';
}
if ($scheme !== 'https') {
    fail('仅支持 https 目标地址');
}
if (strlen($url) > 2048) {
    fail('目标地址过长');
}

$method = isset($input['method']) && is_string($input['method']) ? strtoupper($input['method']) : 'GET';
if (!in_array($method, ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'], true)) {
    $method = 'GET';
}

$body = isset($input['body']) && is_scalar($input['body']) ? (string) $input['body'] : '';
if (strlen($body) > MAX_PROXY_BODY) {
    fail('请求体过大', 413);
}

$headersIn = isset($input['headers']) && is_array($input['headers']) ? $input['headers'] : [];
$cookie = isset($input['cookie']) && is_string($input['cookie']) ? $input['cookie'] : '';

$curlHeaders = [];
foreach ($headersIn as $key => $value) {
    if (!is_string($key) || $key === '' || !is_scalar($value)) {
        continue;
    }
    $name = trim($key);
    $val = (string) $value;
    if ($name === '' || preg_match('/[\r\n:]/', $name)) {
        continue;
    }
    $lower = strtolower($name);
    if (in_array($lower, ['host', 'content-length', 'cookie', 'connection', 'accept-encoding'], true)) {
        continue;
    }
    if (preg_match('/[\r\n]/', $val)) {
        continue;
    }
    $curlHeaders[] = $name . ': ' . $val;
}
if ($cookie !== '' && !preg_match('/[\r\n]/', $cookie)) {
    $curlHeaders[] = 'Cookie: ' . $cookie;
}

$responseHeaders = [];
$setCookies = [];

$headerFn = function ($ch, string $line) use (&$responseHeaders, &$setCookies): int {
    $length = strlen($line);
    $trimmed = trim($line);
    if ($trimmed === '') {
        return $length;
    }
    if (strncasecmp($trimmed, 'HTTP/', 5) === 0) {
        // 新的状态行：丢弃上一个响应（例如 100 Continue）的头
        $responseHeaders = [];
        return $length;
    }
    $pos = strpos($trimmed, ':');
    if ($pos === false) {
        return $length;
    }
    $name = strtolower(trim(substr($trimmed, 0, $pos)));
    $value = trim(substr($trimmed, $pos + 1));
    if ($name === 'set-cookie') {
        $setCookies[] = $value;
    } else {
        $responseHeaders[$name] = $value;
    }
    return $length;
};

$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL => $url,
    CURLOPT_CUSTOMREQUEST => $method,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HEADER => false,
    CURLOPT_FOLLOWLOCATION => false,
    CURLOPT_CONNECTTIMEOUT => 15,
    CURLOPT_TIMEOUT => 60,
    // 学校站点证书链在部分网络环境下不完整，保持与原实现一致的兼容性
    CURLOPT_SSL_VERIFYPEER => false,
    CURLOPT_SSL_VERIFYHOST => 0,
    CURLOPT_ENCODING => '',
    CURLOPT_HTTPHEADER => $curlHeaders,
    CURLOPT_HEADERFUNCTION => $headerFn,
    // 统一使用现代浏览器 UA：与上游 tls_client 的 chrome_120 指纹保持一致，
    // 避免个别客户端 UA 触发学校 WAF 的 405。
    CURLOPT_USERAGENT => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
        . '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
]);

if (in_array($method, ['POST', 'PUT', 'PATCH'], true)) {
    curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
}
if ($method === 'HEAD') {
    curl_setopt($ch, CURLOPT_NOBODY, true);
}

$responseBody = curl_exec($ch);
$errno = curl_errno($ch);
$error = curl_error($ch);
$status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($responseBody === false || $errno !== 0) {
    fail('代理请求失败：' . $error, 502);
}

$newCookies = [];
foreach ($setCookies as $cookieLine) {
    $first = explode(';', $cookieLine, 2)[0];
    if (strpos($first, '=') === false) {
        continue;
    }
    [$name, $value] = explode('=', $first, 2);
    $name = trim($name);
    if ($name === '') {
        continue;
    }
    $newCookies[$name] = $name . '=' . trim($value);
}

respond([
    'status' => $status,
    'body' => (string) $responseBody,
    'headers' => $responseHeaders,
    'newCookies' => array_values($newCookies),
]);
}

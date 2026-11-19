<?php
declare(strict_types=1);

/** Single active session per account: data/sessions.json */

function session_hash(string $token): string
{
    return hash('sha256', $token);
}

function session_read(string $account): array
{
    $data = read_json_file('sessions.json', []);
    if (!is_array($data)) return [];
    $row = $data[$account] ?? null;
    return is_array($row) ? $row : [];
}

/** Manual login rotates the active session; old browser will be kicked on next API call. */
function session_rotate(string $account, string $token): void
{
    if ($account === '' || strlen($token) < 8) return;
    mutate_json_file('sessions.json', function (array &$data) use ($account, $token) {
        $data[$account] = [
            'hash' => session_hash($token),
            'at' => date('c'),
        ];
        if (count($data) > 5000) {
            $data = array_slice($data, -5000, null, true);
        }
    }, []);
}

/** No record = legacy install, allow. A record must match token. */
function session_require(string $account, string $token): void
{
    if ($account === '') return;
    $row = session_read($account);
    if (!$row || empty($row['hash'])) return;
    if ($token !== '' && hash_equals((string) $row['hash'], session_hash($token))) return;
    respond([
        'error' => '账号已在其他浏览器/设备登录，本页面已退出',
        'session_kicked' => true,
    ], 409);
}

function session_is_valid(string $account, string $token): bool
{
    if ($account === '') return false;
    $row = session_read($account);
    if (!$row || empty($row['hash'])) return true;
    return $token !== '' && hash_equals((string) $row['hash'], session_hash($token));
}

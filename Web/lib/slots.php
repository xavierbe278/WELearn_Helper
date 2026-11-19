<?php
declare(strict_types=1);

/* 多用户名额与排队 */

/* ------------------------------------------------------------------
 * 多用户名额 / 排队
 * ------------------------------------------------------------------ */

function slot_prune(array &$data): void
{
    $now = time();
    if (!isset($data['slots']) || !is_array($data['slots'])) {
        $data['slots'] = [];
    }
    if (!isset($data['queue']) || !is_array($data['queue'])) {
        $data['queue'] = [];
    }
    foreach ($data['slots'] as $id => $slot) {
        if (!is_array($slot) || $now - (int) ($slot['seen'] ?? 0) > SLOT_TTL) {
            unset($data['slots'][$id]);
        }
    }
    foreach ($data['queue'] as $id => $item) {
        if (!is_array($item) || $now - (int) ($item['seen'] ?? 0) > QUEUE_TTL) {
            unset($data['queue'][$id]);
        }
    }
}

function slot_counts(array $data): array
{
    return [
        'active' => count($data['slots']),
        'limit' => MAX_ACTIVE_SLOTS,
        'waiting' => count($data['queue']),
    ];
}

function slot_position(array $data, string $clientId): int
{
    $items = [];
    foreach ($data['queue'] as $id => $item) {
        $items[] = ['id' => (string) $id, 'since' => (int) ($item['since'] ?? 0)];
    }
    usort($items, function ($a, $b) {
        if ($a['since'] === $b['since']) {
            return strcmp($a['id'], $b['id']);
        }
        return $a['since'] <=> $b['since'];
    });
    foreach ($items as $index => $item) {
        if ($item['id'] === $clientId) {
            return $index + 1;
        }
    }
    return 0;
}

function slot_apply(array &$data, string $clientId, string $name, string $mode): array
{
    $now = time();
    slot_prune($data);

    if (isset($data['slots'][$clientId])) {
        $data['slots'][$clientId]['seen'] = $now;
        $data['slots'][$clientId]['name'] = $name;
        $data['slots'][$clientId]['mode'] = $mode;
        unset($data['queue'][$clientId]);
        return array_merge(['granted' => true], slot_counts($data));
    }

    $isQueued = isset($data['queue'][$clientId]);
    if (count($data['slots']) < MAX_ACTIVE_SLOTS && (empty($data['queue']) || $isQueued)) {
        $data['slots'][$clientId] = [
            'seen' => $now,
            'started' => $now,
            'name' => $name,
            'mode' => $mode,
        ];
        unset($data['queue'][$clientId]);
        return array_merge(['granted' => true], slot_counts($data));
    }

    if (!isset($data['queue'][$clientId])) {
        if (count($data['queue']) >= MAX_QUEUE) {
            return array_merge(['granted' => false, 'full' => true, 'position' => 0], slot_counts($data));
        }
        $data['queue'][$clientId] = [
            'since' => $now,
            'seen' => $now,
            'name' => $name,
            'mode' => $mode,
        ];
    } else {
        $data['queue'][$clientId]['seen'] = $now;
        $data['queue'][$clientId]['name'] = $name;
        $data['queue'][$clientId]['mode'] = $mode;
    }

    return array_merge([
        'granted' => false,
        'position' => slot_position($data, $clientId),
    ], slot_counts($data));
}

<?php
declare(strict_types=1);

/** System maintenance flag: data/maintenance.json */

function maintenance_read(): array
{
    $data = read_json_file('maintenance.json', ['enabled' => false, 'message' => '']);
    if (!is_array($data)) {
        return ['enabled' => false, 'message' => ''];
    }
    return [
        'enabled' => !empty($data['enabled']),
        'message' => isset($data['message']) && is_string($data['message']) ? $data['message'] : '',
        'updated' => isset($data['updated']) ? (string) $data['updated'] : '',
    ];
}

function maintenance_enabled(): bool
{
    $data = maintenance_read();
    return !empty($data['enabled']);
}

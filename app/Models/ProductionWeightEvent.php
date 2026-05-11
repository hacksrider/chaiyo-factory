<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ProductionWeightEvent extends Model
{
    protected $fillable = [
        'machine_id', 'order_id', 'sheet_name', 'type', 'weight', 'seq', 'good_seq', 'ng_seq',
        'employee_id', 'shift', 'pressed_at', 'received_at', 'raw_payload',
        'gas_sync_status', 'gas_sync_attempts', 'gas_synced_at',
    ];

    protected $casts = [
        'weight'            => 'float',
        'seq'               => 'integer',
        'good_seq'          => 'integer',
        'ng_seq'            => 'integer',
        'pressed_at'        => 'datetime',
        'received_at'       => 'datetime',
        'gas_synced_at'     => 'datetime',
        'raw_payload'       => 'array',
        'gas_sync_attempts' => 'integer',
    ];
}

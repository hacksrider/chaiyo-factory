<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ProductionOrder extends Model
{
    protected $fillable = [
        'machine_id', 'session_run_ulid', 'order_id', 'product_code', 'product_name',
        'target_qty', 'remaining_qty', 'plan_date', 'sheet_name', 'led_ip',
        'shift', 'employee_id',
        'good_count', 'ng_count', 'total_good_weight', 'total_ng_weight',
        'pe_type', 'size', 'length', 'brand', 'color_stripe', 'std_weight',
        'started_at', 'finished_at', 'status',
        'gas_sync_status', 'gas_sync_attempts', 'gas_synced_at',
    ];

    protected $casts = [
        'target_qty'        => 'integer',
        'remaining_qty'     => 'integer',
        'good_count'        => 'integer',
        'ng_count'          => 'integer',
        'total_good_weight' => 'float',
        'total_ng_weight'   => 'float',
        'size'              => 'float',
        'length'            => 'float',
        'std_weight'        => 'float',
        'started_at'        => 'datetime',
        'finished_at'       => 'datetime',
        'gas_synced_at'     => 'datetime',
        'gas_sync_attempts' => 'integer',
    ];
}

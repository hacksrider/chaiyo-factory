<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ProductionSession extends Model
{
    protected $fillable = [
        'machine_id', 'session_run_ulid', 'order_id', 'product_code', 'product_name',
        'target_qty', 'remaining_qty', 'plan_date', 'sheet_name', 'led_ip',
        'shift', 'employee_id',
        'pipe_counter', 'ng_count', 'total_good_weight', 'total_ng_weight',
        'pe_type', 'size', 'length', 'pn', 'brand', 'color_stripe',
        'std_weight', 'min_weight', 'max_weight',
        'status', 'source', 'paused_order', 'ts',
        'started_at', 'paused_at', 'finished_at',
    ];

    protected $casts = [
        'target_qty'        => 'integer',
        'remaining_qty'     => 'integer',
        'pipe_counter'      => 'integer',
        'ng_count'          => 'integer',
        'total_good_weight' => 'float',
        'total_ng_weight'   => 'float',
        'size'              => 'float',
        'length'            => 'float',
        'pn'                => 'float',
        'std_weight'        => 'float',
        'min_weight'        => 'float',
        'max_weight'        => 'float',
        'ts'                => 'integer',
        'paused_order'      => 'array',
        'started_at'        => 'datetime',
        'paused_at'         => 'datetime',
        'finished_at'       => 'datetime',
    ];

    /** Serialize to the same shape as machine_session in frontend allStates[machineId]. */
    public function toFrontendState(): array
    {
        return [
            'sessionRunUlid' => $this->session_run_ulid,
            'mode'           => $this->status === 'live' ? 'live' : 'setup',
            'orderId'        => $this->order_id,
            'productCode'    => $this->product_code,
            'productName'    => $this->product_name,
            'targetQty'      => $this->target_qty,
            'remainingQty'   => $this->remaining_qty,
            'planDate'       => $this->plan_date,
            'sheetName'      => $this->sheet_name,
            'ledIp'          => $this->led_ip,
            'shift'          => $this->shift,
            'employeeId'     => $this->employee_id,
            'pipeCounter'    => $this->pipe_counter,
            'ngCount'        => $this->ng_count,
            'totalGoodWeight'=> $this->total_good_weight,
            'totalNgWeight'  => $this->total_ng_weight,
            'peType'         => $this->pe_type,
            'size'           => $this->size,
            'length'         => $this->length,
            'pn'             => $this->pn,
            'brand'          => $this->brand,
            'colorStripe'    => $this->color_stripe,
            'stdWeight'      => $this->std_weight,
            'minWeight'      => $this->min_weight,
            'maxWeight'      => $this->max_weight,
            // true เมื่อรอกด D ที่ตาชั่ง (Start Now แต่ยังไม่ live)
            'waitingScale'   => $this->status === 'awaiting_scale',
            'startedAt'      => $this->started_at?->toISOString(),
            'pausedAt'       => $this->paused_at?->toISOString(),
            'finishedAt'     => $this->finished_at?->toISOString(),
            'pausedOrder'    => $this->paused_order,
            '_ts'            => $this->ts,
            '_db'            => true,  // flag so frontend knows this came from DB
        ];
    }
}

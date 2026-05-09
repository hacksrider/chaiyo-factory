<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ProductionQueueItem extends Model
{
    protected $fillable = [
        'machine_id', 'order_id', 'product_code', 'product_name',
        'target_qty', 'remaining_qty', 'plan_date', 'sheet_name', 'led_ip',
        'pe_type', 'size', 'length', 'pn', 'brand', 'color_stripe',
        'std_weight', 'min_weight', 'max_weight',
        'status', 'queue_key',
    ];

    protected $casts = [
        'target_qty'    => 'integer',
        'remaining_qty' => 'integer',
        'size'          => 'float',
        'length'        => 'float',
        'pn'            => 'float',
        'std_weight'    => 'float',
        'min_weight'    => 'float',
        'max_weight'    => 'float',
    ];

    /** Serialize to the same shape the frontend expects in queue[] items. */
    public function toFrontend(): array
    {
        return [
            'id'          => $this->id,
            'queueId'     => $this->queue_key ?? "db_{$this->id}",
            'machineId'   => $this->machine_id,
            'orderId'     => $this->order_id,
            'productCode' => $this->product_code,
            'productName' => $this->product_name,
            'targetQty'   => $this->target_qty,
            'remainingQty'=> $this->remaining_qty,
            'planDate'    => $this->plan_date,
            'sheetName'   => $this->sheet_name,
            'ledIp'       => $this->led_ip,
            'peType'      => $this->pe_type,
            'size'        => $this->size,
            'length'      => $this->length,
            'pn'          => $this->pn,
            'brand'       => $this->brand,
            'colorStripe' => $this->color_stripe,
            'stdWeight'   => $this->std_weight,
            'minWeight'   => $this->min_weight,
            'maxWeight'   => $this->max_weight,
            'status'      => $this->status,
            'addedAt'     => $this->created_at?->toISOString(),
        ];
    }
}

<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class MaintenanceRequestReferenceMedia extends Model
{
    protected $table = 'maintenance_request_reference_media';

    protected $fillable = [
        'maintenance_request_id',
        'path',
        'sort_order',
    ];

    public function maintenanceRequest(): BelongsTo
    {
        return $this->belongsTo(MaintenanceRequest::class);
    }
}

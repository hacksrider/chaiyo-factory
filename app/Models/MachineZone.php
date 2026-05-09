<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class MachineZone extends Model
{
    protected $fillable = [
        'machine_id',
        'name',
        'name_mm',
        'code',
        'description',
        'description_mm',
        'layout_image',
        'order',
        'is_active',
    ];

    protected $casts = [
        'is_active' => 'boolean',
        'order' => 'integer',
    ];

    public function machine(): BelongsTo
    {
        return $this->belongsTo(Machine::class);
    }

    public function problems(): HasMany
    {
        return $this->hasMany(MachineZoneProblem::class);
    }
}

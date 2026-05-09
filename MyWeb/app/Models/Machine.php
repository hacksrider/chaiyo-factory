<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Machine extends Model
{
    protected $fillable = [
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

    public function zones(): HasMany
    {
        return $this->hasMany(MachineZone::class);
    }
}

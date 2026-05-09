<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class AiGem extends Model
{
    protected $fillable = [
        'name',
        'gem_url',
        'order',
        'is_active',
    ];

    protected $casts = [
        'is_active' => 'boolean',
        'order' => 'integer',
    ];
}

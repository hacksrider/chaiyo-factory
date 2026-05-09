<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

class MachineZoneProblem extends Model
{
    protected $fillable = [
        'machine_zone_id',
        'title',
        'title_mm',
        'slug',
        'description',
        'description_mm',
        'video_path',
        'solution_text',
        'solution_text_mm',
        'solution_video_path',
        'views',
        'is_active',
        'order',
        'updated_by',
    ];

    protected $casts = [
        'is_active' => 'boolean',
        'views' => 'integer',
        'order' => 'integer',
    ];

    protected static function boot()
    {
        parent::boot();

        static::creating(function ($problem) {
            if (empty($problem->slug)) {
                $problem->slug = Str::slug($problem->title) . '-' . time();
            }
        });
    }

    public function zone(): BelongsTo
    {
        return $this->belongsTo(MachineZone::class, 'machine_zone_id');
    }

    public function updatedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'updated_by');
    }

    public function incrementViews()
    {
        $this->increment('views');
    }
}

<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class MaintenanceRequest extends Model
{
    public const STATUS_PENDING_REVIEW = 'pending_review';

    public const STATUS_REJECTED = 'rejected';

    public const STATUS_APPROVED = 'approved';

    public const STATUS_AWAITING_ACCEPTANCE = 'awaiting_acceptance';

    public const STATUS_AWAITING_ADMIN_CLOSURE = 'awaiting_admin_closure';

    public const STATUS_COMPLETED = 'completed';

    protected $fillable = [
        'notification_number',
        'register_sheet_row',
        'user_id',
        'status',
        'admin_note',
        'reviewed_by_id',
        'reviewed_at',
        'tech_completed_at',
        'owner_accepted_at',
        'payload',
        'photo_before_path',
        'photo_after_path',
    ];

    protected function casts(): array
    {
        return [
            'payload' => 'array',
            'reviewed_at' => 'datetime',
            'tech_completed_at' => 'datetime',
            'owner_accepted_at' => 'datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function reviewedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'reviewed_by_id');
    }

    public function referenceMedia(): HasMany
    {
        return $this->hasMany(MaintenanceRequestReferenceMedia::class)->orderBy('sort_order')->orderBy('id');
    }
}

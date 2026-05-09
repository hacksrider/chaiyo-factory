<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class MachineLogReporter extends Model
{
    protected $table = 'machine_log_reporters';

    protected $fillable = [
        'name',
    ];
}

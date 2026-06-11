<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

// ทุก 5 นาที — auto-cancel awaiting_scale ที่ค้าง + cleanup weight events เก่า
Schedule::command('production:housekeeping')->everyFiveMinutes();

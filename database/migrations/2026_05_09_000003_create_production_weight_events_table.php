<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('production_weight_events', function (Blueprint $table) {
            $table->id();
            $table->string('machine_id', 100);
            $table->string('order_id', 100)->default('');
            $table->string('sheet_name', 100)->default('');
            // type: good | ng
            $table->string('type', 10)->default('good');
            $table->decimal('weight', 10, 4)->default(0);
            $table->unsignedInteger('seq')->default(0);           // sequence within this order
            $table->string('employee_id', 50)->default('');
            $table->string('shift', 5)->default('');
            $table->timestamp('pressed_at')->nullable();           // NTP time from ESP32
            $table->timestamp('received_at')->nullable();          // server receive time
            // full raw payload from ESP32/web (for audit / GAS retry)
            $table->json('raw_payload')->nullable();
            // sync status for dual-write to Google Sheet
            // pending | synced | failed
            $table->string('gas_sync_status', 20)->default('pending');
            $table->unsignedTinyInteger('gas_sync_attempts')->default(0);
            $table->timestamp('gas_synced_at')->nullable();
            $table->timestamps();

            $table->index(['machine_id', 'order_id', 'pressed_at'], 'idx_we_machine_order_time');
            $table->index(['gas_sync_status', 'gas_sync_attempts'], 'idx_we_gas_sync');
            $table->index('pressed_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('production_weight_events');
    }
};

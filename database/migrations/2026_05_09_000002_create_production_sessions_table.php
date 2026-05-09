<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('production_sessions', function (Blueprint $table) {
            $table->id();
            $table->string('machine_id', 100);
            $table->string('order_id', 100)->default('');
            $table->string('product_code', 100)->default('');
            $table->string('product_name', 255)->default('');
            $table->unsignedInteger('target_qty')->default(0);
            $table->unsignedInteger('remaining_qty')->default(0);
            $table->string('plan_date', 20)->default('');
            $table->string('sheet_name', 100)->default('');
            $table->string('led_ip', 200)->default('');
            // shift + employee set by scale (D key confirm)
            $table->string('shift', 5)->default('');
            $table->string('employee_id', 50)->default('');
            // counters — updated atomically on each weight event
            $table->unsignedInteger('pipe_counter')->default(0);      // good count
            $table->unsignedInteger('ng_count')->default(0);
            $table->decimal('total_good_weight', 12, 4)->default(0);
            $table->decimal('total_ng_weight', 12, 4)->default(0);
            // product details
            $table->string('pe_type', 50)->nullable();
            $table->decimal('size', 10, 2)->nullable();
            $table->decimal('length', 10, 2)->nullable();
            $table->decimal('pn', 10, 2)->nullable();
            $table->string('brand', 100)->nullable();
            $table->string('color_stripe', 100)->nullable();
            $table->decimal('std_weight', 10, 4)->nullable();
            $table->decimal('min_weight', 10, 4)->nullable();
            $table->decimal('max_weight', 10, 4)->nullable();
            // status: setup | live | paused | finished | cancelled
            $table->string('status', 20)->default('setup');
            // source of last update: web | scale
            $table->string('source', 20)->default('web');
            $table->timestamp('started_at')->nullable();
            $table->timestamp('paused_at')->nullable();
            $table->timestamp('finished_at')->nullable();
            // paused order snapshot (JSON — mirrors pausedOrder in frontend state)
            $table->json('paused_order')->nullable();
            // frontend _ts for LWW merge
            $table->unsignedBigInteger('ts')->default(0);
            $table->timestamps();

            // Only 1 active session per machine at a time
            $table->unique('machine_id', 'uniq_session_machine');
            $table->index('machine_id');
            $table->index(['machine_id', 'status'], 'idx_session_machine_status');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('production_sessions');
    }
};

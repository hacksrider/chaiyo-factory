<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('production_orders', function (Blueprint $table) {
            $table->id();
            $table->string('machine_id', 100);
            $table->string('order_id', 100);
            $table->string('product_code', 100)->default('');
            $table->string('product_name', 255)->default('');
            $table->unsignedInteger('target_qty')->default(0);
            $table->unsignedInteger('remaining_qty')->default(0);
            $table->string('plan_date', 20)->default('');
            $table->string('sheet_name', 100)->default('');
            $table->string('led_ip', 200)->default('');
            $table->string('shift', 5)->default('');
            $table->string('employee_id', 50)->default('');
            // summary counters — written on finish
            $table->unsignedInteger('good_count')->default(0);
            $table->unsignedInteger('ng_count')->default(0);
            $table->decimal('total_good_weight', 12, 4)->default(0);
            $table->decimal('total_ng_weight', 12, 4)->default(0);
            // product details
            $table->string('pe_type', 50)->nullable();
            $table->decimal('size', 10, 2)->nullable();
            $table->decimal('length', 10, 2)->nullable();
            $table->string('brand', 100)->nullable();
            $table->string('color_stripe', 100)->nullable();
            $table->decimal('std_weight', 10, 4)->nullable();
            // lifecycle
            $table->timestamp('started_at')->nullable();
            $table->timestamp('finished_at')->nullable();
            // status: active | paused | finished | cancelled
            $table->string('status', 20)->default('active');
            // GAS sync flag
            $table->string('gas_sync_status', 20)->default('pending');
            $table->unsignedTinyInteger('gas_sync_attempts')->default(0);
            $table->timestamp('gas_synced_at')->nullable();
            $table->timestamps();

            $table->index(['machine_id', 'order_id'], 'idx_orders_machine_order');
            $table->index(['machine_id', 'status', 'started_at'], 'idx_orders_machine_status');
            $table->index(['gas_sync_status', 'gas_sync_attempts'], 'idx_orders_gas_sync');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('production_orders');
    }
};

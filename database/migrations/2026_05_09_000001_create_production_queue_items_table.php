<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('production_queue_items', function (Blueprint $table) {
            $table->id();
            $table->string('machine_id', 100);          // matches existing machineId string convention
            $table->string('order_id', 100);             // เลขใบขอ
            $table->string('product_code', 100)->default('');
            $table->string('product_name', 255)->default('');
            $table->unsignedInteger('target_qty')->default(0);
            $table->unsignedInteger('remaining_qty')->default(0);
            $table->string('plan_date', 20)->default('');
            $table->string('sheet_name', 100)->default('');
            $table->string('led_ip', 200)->default('');
            // product detail fields (from Sheet Product — nullable for legacy items)
            $table->string('pe_type', 50)->nullable();
            $table->decimal('size', 10, 2)->nullable();
            $table->decimal('length', 10, 2)->nullable();
            $table->decimal('pn', 10, 2)->nullable();
            $table->string('brand', 100)->nullable();
            $table->string('color_stripe', 100)->nullable();
            $table->decimal('std_weight', 10, 4)->nullable();
            $table->decimal('min_weight', 10, 4)->nullable();
            $table->decimal('max_weight', 10, 4)->nullable();
            // status: queued | started | cancelled
            $table->string('status', 20)->default('queued');
            $table->string('queue_key', 64)->nullable(); // frontend queueId for dedup
            $table->timestamps();

            $table->index(['machine_id', 'status', 'created_at'], 'idx_queue_machine_status');
            $table->index(['machine_id', 'order_id'], 'idx_queue_machine_order');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('production_queue_items');
    }
};

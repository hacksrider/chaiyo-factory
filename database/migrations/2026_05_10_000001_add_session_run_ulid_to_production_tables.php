<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('production_sessions', function (Blueprint $table) {
            $table->string('session_run_ulid', 26)->nullable()->after('machine_id')
                ->comment('Identifies one Start→Finish/Cancel cycle; regenerated every Start Now');
            $table->index('session_run_ulid', 'idx_session_run_ulid');
        });

        Schema::table('production_weight_events', function (Blueprint $table) {
            $table->string('session_run_ulid', 26)->nullable()->after('machine_id')
                ->comment('FK-style link to sessions.session_run_ulid for this run');
            $table->index(['session_run_ulid', 'machine_id'], 'idx_we_run_machine');
            $table->index(['machine_id', 'session_run_ulid', 'received_at'], 'idx_we_machine_run_time');
        });

        Schema::table('production_orders', function (Blueprint $table) {
            $table->string('session_run_ulid', 26)->nullable()->after('machine_id');
            $table->index(['session_run_ulid', 'machine_id'], 'idx_po_run_machine');
            $table->index(['machine_id', 'order_id', 'session_run_ulid'], 'idx_po_machine_order_run');
        });
    }

    public function down(): void
    {
        Schema::table('production_sessions', function (Blueprint $table) {
            $table->dropIndex('idx_session_run_ulid');
            $table->dropColumn('session_run_ulid');
        });

        Schema::table('production_weight_events', function (Blueprint $table) {
            $table->dropIndex('idx_we_run_machine');
            $table->dropIndex('idx_we_machine_run_time');
            $table->dropColumn('session_run_ulid');
        });

        Schema::table('production_orders', function (Blueprint $table) {
            $table->dropIndex('idx_po_run_machine');
            $table->dropIndex('idx_po_machine_order_run');
            $table->dropColumn('session_run_ulid');
        });
    }
};

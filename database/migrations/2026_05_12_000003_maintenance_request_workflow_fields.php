<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('maintenance_requests', function (Blueprint $table) {
            $table->timestamp('tech_completed_at')->nullable()->after('reviewed_at');
            $table->timestamp('owner_accepted_at')->nullable()->after('tech_completed_at');
        });

        // pending → pending_review; เก็บ approved/rejected ตามเดิม
        DB::table('maintenance_requests')->where('status', 'pending')->update(['status' => 'pending_review']);
    }

    public function down(): void
    {
        DB::table('maintenance_requests')->where('status', 'pending_review')->update(['status' => 'pending']);

        Schema::table('maintenance_requests', function (Blueprint $table) {
            $table->dropColumn(['tech_completed_at', 'owner_accepted_at']);
        });
    }
};

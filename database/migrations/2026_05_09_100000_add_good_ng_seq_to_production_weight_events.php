<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('production_weight_events', function (Blueprint $table) {
            $table->unsignedInteger('good_seq')->nullable()->after('seq');
            $table->unsignedInteger('ng_seq')->nullable()->after('good_seq');
        });
    }

    public function down(): void
    {
        Schema::table('production_weight_events', function (Blueprint $table) {
            $table->dropColumn(['good_seq', 'ng_seq']);
        });
    }
};

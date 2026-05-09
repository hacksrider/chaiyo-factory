<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('problems', function (Blueprint $table) {
            $table->string('title_mm')->nullable()->after('title');
            $table->text('description_mm')->nullable()->after('description');
            $table->text('solution_text_mm')->nullable()->after('solution_text');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('problems', function (Blueprint $table) {
            $table->dropColumn(['title_mm', 'description_mm', 'solution_text_mm']);
        });
    }
};

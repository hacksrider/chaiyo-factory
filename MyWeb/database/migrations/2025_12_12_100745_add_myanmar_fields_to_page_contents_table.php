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
        Schema::table('page_contents', function (Blueprint $table) {
            $table->string('title_mm')->nullable()->after('title');
            $table->text('content_mm')->nullable()->after('content');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('page_contents', function (Blueprint $table) {
            $table->dropColumn(['title_mm', 'content_mm']);
        });
    }
};

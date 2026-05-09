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
        Schema::create('machine_zone_problems', function (Blueprint $table) {
            $table->id();
            $table->foreignId('machine_zone_id')->constrained()->onDelete('cascade');
            $table->string('title');
            $table->string('slug')->unique();
            $table->text('description');
            $table->string('video_path')->nullable(); // วิดีโอปัญหา
            $table->text('solution_text')->nullable(); // วิธีแก้ไข (ข้อความ)
            $table->string('solution_video_path')->nullable(); // วิดีโอวิธีแก้ไข
            $table->integer('views')->default(0);
            $table->boolean('is_active')->default(true);
            $table->integer('order')->default(0);
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('machine_zone_problems');
    }
};

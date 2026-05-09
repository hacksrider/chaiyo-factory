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
        Schema::create('machines', function (Blueprint $table) {
            $table->id();
            $table->string('name'); // ชื่อเครื่องจักร เช่น EM-01, EM-02
            $table->string('code')->unique(); // รหัสเครื่องจักร เช่น EM-01
            $table->text('description')->nullable();
            $table->string('layout_image')->nullable(); // รูปแผนผังเครื่องจักร
            $table->integer('order')->default(0);
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('machines');
    }
};

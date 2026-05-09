<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        // Update existing records with order = 0 or order < 1 to have proper order values
        $aiGems = DB::table('ai_gems')
            ->where('order', '<', 1)
            ->orderBy('id', 'asc')
            ->get();
        
        $order = 1;
        foreach ($aiGems as $gem) {
            DB::table('ai_gems')
                ->where('id', $gem->id)
                ->update(['order' => $order]);
            $order++;
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        // This migration cannot be fully reversed as we don't know the original order values
        // But we can set all orders to 0 if needed
        // DB::table('ai_gems')->update(['order' => 0]);
    }
};

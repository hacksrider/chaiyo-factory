<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Fix: ALTER production_sessions.ts จาก INT → BIGINT UNSIGNED
 *
 * ปัญหา: ts เก็บ Unix timestamp หน่วย milliseconds (เช่น 1782572600800)
 * ซึ่งมีค่า ~1.78 ล้านล้าน — เกิน INT/INT UNSIGNED (max ~2.1 พันล้าน / ~4.3 พันล้าน)
 * Migration ต้นฉบับระบุ unsignedBigInteger แต่ถ้า production DB สร้างจาก schema เก่า
 * หรือ migrate ก่อนที่ migration จะถูกแก้ไข จะทำให้ column เป็น INT → overflow error.
 *
 * MySQL 5.7 มี bug: รายงาน column name ที่ error ผิด (เช่น แสดง remaining_qty แทน ts)
 * ทำให้วินิจฉัยยาก.
 */
return new class extends Migration
{
    public function up(): void
    {
        // ใช้ raw ALTER TABLE เพื่อไม่ต้องพึ่ง doctrine/dbal
        // MODIFY ให้ ts เป็น BIGINT UNSIGNED NOT NULL DEFAULT 0 ตลอด (idempotent)
        if (Schema::hasTable('production_sessions') && Schema::hasColumn('production_sessions', 'ts')) {
            DB::statement('ALTER TABLE production_sessions MODIFY COLUMN ts BIGINT UNSIGNED NOT NULL DEFAULT 0');
        }
    }

    public function down(): void
    {
        // rollback: คืนเป็น INT UNSIGNED (อาจสูญเสียค่าที่ > INT_MAX)
        if (Schema::hasTable('production_sessions') && Schema::hasColumn('production_sessions', 'ts')) {
            DB::statement('ALTER TABLE production_sessions MODIFY COLUMN ts INT UNSIGNED NOT NULL DEFAULT 0');
        }
    }
};

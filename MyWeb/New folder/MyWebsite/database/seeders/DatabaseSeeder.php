<?php

namespace Database\Seeders;

use App\Models\User;
use App\Models\Category;
use App\Models\PageContent;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

class DatabaseSeeder extends Seeder
{
    /**
     * Seed the application's database.
     */
    public function run(): void
    {
        // Create admin user
        User::firstOrCreate(
            ['username' => 'admin'],
            [
                'name' => 'Admin',
                'username' => 'admin',
                'password' => Hash::make('password'),
                'role' => 'admin',
            ]
        );

        // Create sample categories
        $categories = [
            ['name' => 'ระบบคอมพิวเตอร์', 'description' => 'ปัญหาที่เกี่ยวข้องกับคอมพิวเตอร์', 'order' => 1],
            ['name' => 'ซอฟต์แวร์', 'description' => 'ปัญหาที่เกี่ยวข้องกับซอฟต์แวร์', 'order' => 2],
            ['name' => 'เครือข่าย', 'description' => 'ปัญหาที่เกี่ยวข้องกับเครือข่าย', 'order' => 3],
            ['name' => 'อื่นๆ', 'description' => 'ปัญหาอื่นๆ', 'order' => 4],
        ];

        foreach ($categories as $categoryData) {
            $slug = Str::slug($categoryData['name']);
            Category::updateOrCreate(
                ['slug' => $slug],
                array_merge($categoryData, [
                    'slug' => $slug,
                    'is_active' => true,
                ])
            );
        }

        // // Create sample page content
        // PageContent::firstOrCreate(
        //     ['page_key' => 'home'],
        //     [
        //         'title' => 'ยินดีต้อนรับสู่ระบบรวบรวมปัญหา',
        //         'content' => '<p>ระบบนี้เป็นระบบรวบรวมปัญหาต่างๆ ให้กับพนักงานในบริษัท</p><p>คุณสามารถค้นหาปัญหาที่ต้องการและดูวิดีโอปัญหาได้</p>',
        //     ]
        // );
    }
}

<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Category;
use App\Models\PageContent;
use App\Models\Problem;
use Illuminate\Http\Request;

class PublicController extends Controller
{
    public function home()
    {
        try {
            $categories = Category::where('is_active', true)
                ->orderBy('order', 'asc')
                ->withCount(['problems' => function ($query) {
                    $query->where('is_active', true);
                }])
                ->get();

            $recentProblems = Problem::with('category')
                ->where('is_active', true)
                ->orderBy('created_at', 'desc')
                ->limit(6)
                ->get();

            $popularProblems = Problem::with('category')
                ->where('is_active', true)
                ->orderBy('views', 'desc')
                ->limit(6)
                ->get();

            $homeContent = PageContent::where('page_key', 'home')->first();

            return response()->json([
                'categories' => $categories ?? [],
                'recent_problems' => $recentProblems ?? [],
                'popular_problems' => $popularProblems ?? [],
                'home_content' => $homeContent,
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'categories' => [],
                'recent_problems' => [],
                'popular_problems' => [],
                'home_content' => null,
                'error' => $e->getMessage(),
            ], 500);
        }
    }

    public function getPageContent($key)
    {
        $content = PageContent::where('page_key', $key)->first();
        
        if (!$content) {
            return response()->json(['message' => 'Page content not found'], 404);
        }

        return response()->json($content);
    }
}

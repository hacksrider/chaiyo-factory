<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Category;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class CategoryController extends Controller
{
    public function index()
    {
        $categories = Category::where('is_active', true)
            ->orderBy('order', 'asc')
            ->orderBy('name', 'asc')
            ->get();

        return response()->json($categories);
    }

    public function show($id)
    {
        $category = Category::findOrFail($id);
        return response()->json($category);
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'name_mm' => 'nullable|string|max:255',
            'description' => 'nullable|string',
            'description_mm' => 'nullable|string',
            'order' => 'nullable|integer',
            'is_active' => 'nullable|boolean',
        ]);
        
        // Convert string "1"/"0" to boolean if needed
        if (isset($validated['is_active']) && is_string($validated['is_active'])) {
            $validated['is_active'] = filter_var($validated['is_active'], FILTER_VALIDATE_BOOLEAN);
        }

        $category = new Category();
        $category->name = $validated['name'];
        $category->name_mm = $validated['name_mm'] ?? null;
        $category->slug = Str::slug($validated['name']) . '-' . time();
        $category->description = $validated['description'] ?? null;
        $category->description_mm = $validated['description_mm'] ?? null;
        $category->order = $validated['order'] ?? 0;
        $category->is_active = $validated['is_active'] ?? true;
        $category->save();

        return response()->json($category, 201);
    }

    public function update(Request $request, $id)
    {
        $category = Category::findOrFail($id);

        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'name_mm' => 'nullable|string|max:255',
            'description' => 'nullable|string',
            'description_mm' => 'nullable|string',
            'order' => 'nullable|integer',
            'is_active' => 'nullable|boolean',
        ]);
        
        // Convert string "1"/"0" to boolean if needed
        if (isset($validated['is_active']) && is_string($validated['is_active'])) {
            $validated['is_active'] = filter_var($validated['is_active'], FILTER_VALIDATE_BOOLEAN);
        }

        $category->name = $validated['name'];
        $category->name_mm = $validated['name_mm'] ?? null;
        $category->description = $validated['description'] ?? null;
        $category->description_mm = $validated['description_mm'] ?? null;
        $category->order = $validated['order'] ?? $category->order;
        $category->is_active = $validated['is_active'] ?? $category->is_active;
        $category->save();

        return response()->json($category);
    }

    public function destroy($id)
    {
        $category = Category::findOrFail($id);
        $category->delete();

        return response()->json(['message' => 'Category deleted successfully']);
    }

    public function all()
    {
        // For admin - get all categories including inactive
        $categories = Category::orderBy('order', 'asc')
            ->orderBy('name', 'asc')
            ->get();

        return response()->json($categories);
    }
}

<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\PageContent;
use Illuminate\Http\Request;

class PageContentController extends Controller
{
    public function index()
    {
        $contents = PageContent::all();
        return response()->json($contents);
    }

    public function show($key)
    {
        $content = PageContent::where('page_key', $key)->first();
        
        if (!$content) {
            return response()->json(['message' => 'Page content not found'], 404);
        }

        return response()->json($content);
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'page_key' => 'required|string|unique:page_contents,page_key',
            'title' => 'required|string|max:255',
            'content' => 'required|string',
        ]);

        $content = PageContent::create($validated);

        return response()->json($content, 201);
    }

    public function update(Request $request, $id)
    {
        $content = PageContent::findOrFail($id);

        $validated = $request->validate([
            'page_key' => 'required|string|unique:page_contents,page_key,' . $id,
            'title' => 'required|string|max:255',
            'content' => 'required|string',
        ]);

        $content->update($validated);

        return response()->json($content);
    }

    public function updateByKey(Request $request, $key)
    {
        $content = PageContent::where('page_key', $key)->first();

        if (!$content) {
            return response()->json(['message' => 'Page content not found'], 404);
        }

        $validated = $request->validate([
            'title' => 'required|string|max:255',
            'content' => 'required|string',
        ]);

        $content->update($validated);

        return response()->json($content);
    }

    public function destroy($id)
    {
        $content = PageContent::findOrFail($id);
        $content->delete();

        return response()->json(['message' => 'Page content deleted successfully']);
    }
}

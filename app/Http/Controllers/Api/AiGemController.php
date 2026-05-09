<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AiGem;
use Illuminate\Http\Request;

class AiGemController extends Controller
{
    public function index()
    {
        $aiGems = AiGem::where('is_active', true)
            ->orderBy('order', 'asc')
            ->orderBy('name', 'asc')
            ->get();

        return response()->json($aiGems);
    }

    public function all()
    {
        // For admin - get all AI gems including inactive
        $aiGems = AiGem::orderBy('order', 'asc')
            ->orderBy('name', 'asc')
            ->get();

        return response()->json($aiGems);
    }

    public function show($id)
    {
        $aiGem = AiGem::findOrFail($id);
        return response()->json($aiGem);
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'gem_url' => 'required|url|max:500',
            'order' => 'nullable|integer',
            'is_active' => 'nullable|boolean',
        ]);

        // Convert string "1"/"0" to boolean if needed
        if (isset($validated['is_active']) && is_string($validated['is_active'])) {
            $validated['is_active'] = filter_var($validated['is_active'], FILTER_VALIDATE_BOOLEAN);
        }

        // If order is not provided, set it to max order + 1
        if (!isset($validated['order'])) {
            $maxOrder = AiGem::max('order') ?? 0;
            $validated['order'] = $maxOrder + 1;
        }

        $newOrder = $validated['order'] >= 1 ? $validated['order'] : 1;

        // Shift down all AI gems with order >= newOrder
        AiGem::where('order', '>=', $newOrder)
            ->increment('order');

        $aiGem = AiGem::create([
            'name' => $validated['name'],
            'gem_url' => $validated['gem_url'],
            'order' => $newOrder,
            'is_active' => $validated['is_active'] ?? true,
        ]);

        return response()->json($aiGem, 201);
    }

    public function update(Request $request, $id)
    {
        $aiGem = AiGem::findOrFail($id);
        $oldOrder = $aiGem->order;

        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'gem_url' => 'required|url|max:500',
            'order' => 'nullable|integer',
            'is_active' => 'nullable|boolean',
        ]);

        // Convert string "1"/"0" to boolean if needed
        if (isset($validated['is_active']) && is_string($validated['is_active'])) {
            $validated['is_active'] = filter_var($validated['is_active'], FILTER_VALIDATE_BOOLEAN);
        }

        // Ensure order is at least 1
        $newOrder = isset($validated['order']) && $validated['order'] >= 1 
            ? $validated['order'] 
            : ($oldOrder >= 1 ? $oldOrder : 1);

        // Only shift if order is actually changing
        // Insert-style reordering logic
        if ($newOrder != $oldOrder) {
            if ($newOrder > $oldOrder) {
                // Moving to a later position: shift items between oldOrder and newOrder UP (decrement)
                // to make room at the target position
                // Example: A(1) -> A(3) with B(2), C(3), D(4), E(5)
                // Shift B(2) and C(3) UP: B(1), C(2)
                // A goes to 3
                // Result: B(1), C(2), A(3), D(4), E(5)
                AiGem::where('order', '>', $oldOrder)
                    ->where('order', '<=', $newOrder)
                    ->where('id', '!=', $id)
                    ->decrement('order');
            } else {
                // Moving to an earlier position: shift items at newOrder and above (but below oldOrder) DOWN (increment)
                // Example: D(4) -> D(2) with A(1), B(2), C(3), E(5)
                // Shift B(2) and C(3) DOWN: B(3), C(4)
                // D goes to 2
                // Result: A(1), D(2), B(3), C(4), E(5)
                AiGem::where('order', '>=', $newOrder)
                    ->where('order', '<', $oldOrder)
                    ->where('id', '!=', $id)
                    ->increment('order');
            }
        }

        $aiGem->update([
            'name' => $validated['name'],
            'gem_url' => $validated['gem_url'],
            'order' => $newOrder,
            'is_active' => $validated['is_active'] ?? $aiGem->is_active,
        ]);

        return response()->json($aiGem);
    }

    public function destroy($id)
    {
        $aiGem = AiGem::findOrFail($id);
        $aiGem->delete();

        return response()->json(['message' => 'AI Gem deleted successfully']);
    }
}

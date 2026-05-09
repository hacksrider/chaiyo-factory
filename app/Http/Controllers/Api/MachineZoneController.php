<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\MachineZone;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

class MachineZoneController extends Controller
{
    public function index($machineId)
    {
        $zones = MachineZone::where('machine_id', $machineId)
            ->where('is_active', true)
            ->orderBy('order', 'asc')
            ->orderBy('name', 'asc')
            ->get();

        return response()->json($zones);
    }

    public function show($id)
    {
        $zone = MachineZone::with('machine')->findOrFail($id);
        // Ensure machine_id is included
        if (!$zone->machine_id && $zone->machine) {
            $zone->machine_id = $zone->machine->id;
        }
        return response()->json($zone);
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'machine_id' => 'required|exists:machines,id',
            'name' => 'required|string|max:255',
            'name_mm' => 'nullable|string|max:255',
            'code' => 'nullable|string|max:255',
            'description' => 'nullable|string',
            'description_mm' => 'nullable|string',
            'layout_image' => 'nullable|image|mimes:jpeg,png,jpg,gif,webp|max:10240',
            'order' => 'nullable|integer',
            'is_active' => 'nullable|boolean',
        ]);

        $zone = new MachineZone();
        $zone->machine_id = $validated['machine_id'];
        $zone->name = $validated['name'];
        $zone->name_mm = $validated['name_mm'] ?? null;
        $zone->code = $validated['code'] ?? null;
        $zone->description = $validated['description'] ?? null;
        $zone->description_mm = $validated['description_mm'] ?? null;
        $zone->order = $validated['order'] ?? 0;
        $zone->is_active = $validated['is_active'] ?? true;

        if ($request->hasFile('layout_image')) {
            $imagePath = $request->file('layout_image')->store('machines/zones', 'public');
            $zone->layout_image = $imagePath;
        }

        $zone->save();

        return response()->json($zone, 201);
    }

    public function update(Request $request, $id)
    {
        $zone = MachineZone::findOrFail($id);

        $rules = [
            'name' => 'required|string|max:255',
            'name_mm' => 'nullable|string|max:255',
            'code' => 'nullable|string|max:255',
            'description' => 'nullable|string',
            'description_mm' => 'nullable|string',
            'order' => 'nullable|integer',
            'is_active' => 'nullable|boolean',
        ];

        // Only validate layout_image if it's actually a file
        if ($request->hasFile('layout_image')) {
            $rules['layout_image'] = 'image|mimes:jpeg,png,jpg,gif,webp|max:10240';
        }

        $validated = $request->validate($rules);

        $zone->name = $validated['name'];
        $zone->name_mm = $validated['name_mm'] ?? null;
        $zone->code = $validated['code'] ?? null;
        $zone->description = $validated['description'] ?? null;
        $zone->description_mm = $validated['description_mm'] ?? null;
        $zone->order = $validated['order'] ?? $zone->order;
        $zone->is_active = $validated['is_active'] ?? $zone->is_active;

        // Handle layout image removal
        if ($request->has('remove_layout_image') && $request->remove_layout_image == '1') {
            if ($zone->layout_image) {
                Storage::disk('public')->delete($zone->layout_image);
            }
            $zone->layout_image = null;
        }

        if ($request->hasFile('layout_image')) {
            if ($zone->layout_image) {
                Storage::disk('public')->delete($zone->layout_image);
            }
            $imagePath = $request->file('layout_image')->store('machines/zones', 'public');
            $zone->layout_image = $imagePath;
        }

        $zone->save();

        return response()->json($zone);
    }

    public function destroy($id)
    {
        $zone = MachineZone::findOrFail($id);

        if ($zone->layout_image) {
            Storage::disk('public')->delete($zone->layout_image);
        }

        $zone->delete();

        return response()->json(['message' => 'Zone deleted successfully']);
    }

    public function all($machineId)
    {
        $zones = MachineZone::where('machine_id', $machineId)
            ->orderBy('order', 'asc')
            ->orderBy('name', 'asc')
            ->get();

        return response()->json($zones);
    }
}

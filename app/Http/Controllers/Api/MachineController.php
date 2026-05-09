<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Machine;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class MachineController extends Controller
{
    public function index()
    {
        $machines = Machine::where('is_active', true)
            ->orderBy('order', 'asc')
            ->orderBy('name', 'asc')
            ->get();

        return response()->json($machines);
    }

    public function show($id)
    {
        $machine = Machine::with(['zones' => function ($query) {
            $query->where('is_active', true)->orderBy('order', 'asc');
        }])->findOrFail($id);

        return response()->json($machine);
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'name_mm' => 'nullable|string|max:255',
            'code' => 'required|string|max:255|unique:machines',
            'description' => 'nullable|string',
            'description_mm' => 'nullable|string',
            'layout_image' => 'nullable|image|mimes:jpeg,png,jpg,gif,webp|max:10240',
            'order' => 'nullable|integer',
            'is_active' => 'nullable|boolean',
        ]);

        $machine = new Machine();
        $machine->name = $validated['name'];
        $machine->name_mm = $validated['name_mm'] ?? null;
        $machine->code = $validated['code'];
        $machine->description = $validated['description'] ?? null;
        $machine->description_mm = $validated['description_mm'] ?? null;
        $machine->order = $validated['order'] ?? 0;
        $machine->is_active = $validated['is_active'] ?? true;

        if ($request->hasFile('layout_image')) {
            $imagePath = $request->file('layout_image')->store('machines/layouts', 'public');
            $machine->layout_image = $imagePath;
        }

        $machine->save();

        return response()->json($machine, 201);
    }

    public function update(Request $request, $id)
    {
        $machine = Machine::findOrFail($id);

        $rules = [
            'name' => 'required|string|max:255',
            'name_mm' => 'nullable|string|max:255',
            'code' => 'required|string|max:255|unique:machines,code,' . $id,
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

        $machine->name = $validated['name'];
        $machine->name_mm = $validated['name_mm'] ?? null;
        $machine->code = $validated['code'];
        $machine->description = $validated['description'] ?? null;
        $machine->description_mm = $validated['description_mm'] ?? null;
        $machine->order = $validated['order'] ?? $machine->order;
        $machine->is_active = $validated['is_active'] ?? $machine->is_active;

        // Handle layout image removal
        if ($request->has('remove_layout_image') && $request->remove_layout_image == '1') {
            if ($machine->layout_image) {
                Storage::disk('public')->delete($machine->layout_image);
            }
            $machine->layout_image = null;
        }

        if ($request->hasFile('layout_image')) {
            if ($machine->layout_image) {
                Storage::disk('public')->delete($machine->layout_image);
            }
            $imagePath = $request->file('layout_image')->store('machines/layouts', 'public');
            $machine->layout_image = $imagePath;
        }

        $machine->save();

        return response()->json($machine);
    }

    public function destroy($id)
    {
        $machine = Machine::findOrFail($id);

        if ($machine->layout_image) {
            Storage::disk('public')->delete($machine->layout_image);
        }

        $machine->delete();

        return response()->json(['message' => 'Machine deleted successfully']);
    }

    public function all()
    {
        $machines = Machine::orderBy('order', 'asc')
            ->orderBy('name', 'asc')
            ->get();

        return response()->json($machines);
    }
}

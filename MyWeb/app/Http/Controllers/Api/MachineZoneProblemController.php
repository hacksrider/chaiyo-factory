<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\MachineZoneProblem;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Str;

class MachineZoneProblemController extends Controller
{
    public function index(Request $request, $zoneId)
    {
        $query = MachineZoneProblem::where('machine_zone_id', $zoneId)
            ->where('is_active', true)
            ->orderBy('order', 'asc')
            ->orderBy('created_at', 'desc');

        // Search
        if ($request->has('search')) {
            $search = $request->search;
            $query->where(function ($q) use ($search) {
                $q->where('title', 'like', "%{$search}%")
                  ->orWhere('description', 'like', "%{$search}%");
            });
        }

        $problems = $query->get();

        return response()->json($problems);
    }

    public function show($id)
    {
        $problem = MachineZoneProblem::with('zone.machine')->findOrFail($id);
        
        // Increment views
        $problem->incrementViews();

        return response()->json($problem);
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'machine_zone_id' => 'required|exists:machine_zones,id',
            'title' => 'required|string|max:255',
            'title_mm' => 'nullable|string|max:255',
            'description' => 'required|string',
            'description_mm' => 'nullable|string',
            'video' => 'nullable|file|mimes:mp4,avi,mov,wmv,flv,webm|max:102400',
            'solution_text' => 'nullable|string',
            'solution_text_mm' => 'nullable|string',
            'solution_video' => 'nullable|file|mimes:mp4,avi,mov,wmv,flv,webm|max:102400',
            'is_active' => 'nullable|boolean',
            'order' => 'nullable|integer',
        ]);

        $problem = new MachineZoneProblem();
        $problem->machine_zone_id = $validated['machine_zone_id'];
        $problem->title = $validated['title'];
        $problem->title_mm = $validated['title_mm'] ?? null;
        $problem->slug = Str::slug($validated['title']) . '-' . time();
        $problem->description = $validated['description'];
        $problem->description_mm = $validated['description_mm'] ?? null;
        $problem->solution_text = $validated['solution_text'] ?? null;
        $problem->solution_text_mm = $validated['solution_text_mm'] ?? null;
        $problem->is_active = $validated['is_active'] ?? true;
        $problem->order = $validated['order'] ?? 0;

        // Upload problem video
        if ($request->hasFile('video')) {
            $videoPath = $request->file('video')->store('videos/machine-zone-problems', 'public');
            $problem->video_path = $videoPath;
        }

        // Upload solution video
        if ($request->hasFile('solution_video')) {
            $solutionVideoPath = $request->file('solution_video')->store('videos/machine-zone-solutions', 'public');
            $problem->solution_video_path = $solutionVideoPath;
        }

        $problem->save();

        return response()->json($problem->load('zone'), 201);
    }

    public function update(Request $request, $id)
    {
        $problem = MachineZoneProblem::findOrFail($id);

        $rules = [
            'title' => 'required|string|max:255',
            'title_mm' => 'nullable|string|max:255',
            'description' => 'required|string',
            'description_mm' => 'nullable|string',
            'solution_text' => 'nullable|string',
            'solution_text_mm' => 'nullable|string',
            'is_active' => 'nullable|boolean',
            'order' => 'nullable|integer',
        ];

        // Only validate video if it's actually a file
        if ($request->hasFile('video')) {
            $rules['video'] = 'file|mimes:mp4,avi,mov,wmv,flv,webm|max:102400';
        }

        // Only validate solution_video if it's actually a file
        if ($request->hasFile('solution_video')) {
            $rules['solution_video'] = 'file|mimes:mp4,avi,mov,wmv,flv,webm|max:102400';
        }

        $validated = $request->validate($rules);

        $problem->title = $validated['title'];
        $problem->title_mm = $validated['title_mm'] ?? null;
        $problem->description = $validated['description'] ?? null;
        $problem->description_mm = $validated['description_mm'] ?? null;
        $problem->solution_text = $validated['solution_text'] ?? null;
        $problem->solution_text_mm = $validated['solution_text_mm'] ?? null;
        $problem->is_active = $validated['is_active'] ?? $problem->is_active;
        $problem->order = $validated['order'] ?? $problem->order;
        $problem->updated_by = Auth::id();

        // Handle video removal
        if ($request->has('remove_video') && $request->remove_video == '1') {
            if ($problem->video_path) {
                Storage::disk('public')->delete($problem->video_path);
            }
            $problem->video_path = null;
        }

        // Update problem video
        if ($request->hasFile('video')) {
            if ($problem->video_path) {
                Storage::disk('public')->delete($problem->video_path);
            }
            $videoPath = $request->file('video')->store('videos/machine-zone-problems', 'public');
            $problem->video_path = $videoPath;
        }

        // Handle solution video removal
        if ($request->has('remove_solution_video') && $request->remove_solution_video == '1') {
            if ($problem->solution_video_path) {
                Storage::disk('public')->delete($problem->solution_video_path);
            }
            $problem->solution_video_path = null;
        }

        // Update solution video
        if ($request->hasFile('solution_video')) {
            if ($problem->solution_video_path) {
                Storage::disk('public')->delete($problem->solution_video_path);
            }
            $solutionVideoPath = $request->file('solution_video')->store('videos/machine-zone-solutions', 'public');
            $problem->solution_video_path = $solutionVideoPath;
        }

        $problem->save();

        return response()->json($problem->load('zone'));
    }

    public function destroy($id)
    {
        $problem = MachineZoneProblem::findOrFail($id);

        // Delete videos
        if ($problem->video_path) {
            Storage::disk('public')->delete($problem->video_path);
        }
        if ($problem->solution_video_path) {
            Storage::disk('public')->delete($problem->solution_video_path);
        }

        $problem->delete();

        return response()->json(['message' => 'Problem deleted successfully']);
    }

    public function all(Request $request, $zoneId)
    {
        $query = MachineZoneProblem::where('machine_zone_id', $zoneId)
            ->orderBy('order', 'asc')
            ->orderBy('created_at', 'desc');

        if ($request->has('search')) {
            $search = $request->search;
            $query->where(function ($q) use ($search) {
                $q->where('title', 'like', "%{$search}%")
                  ->orWhere('description', 'like', "%{$search}%");
            });
        }

        $problems = $query->get();

        return response()->json($problems);
    }
}

<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Problem;
use App\Models\Category;
use App\Models\MachineZoneProblem;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Str;

class ProblemController extends Controller
{
    public function index(Request $request)
    {
        // Check if category is machine category
        $isMachineCategory = false;
        if ($request->has('category_id')) {
            $category = Category::find($request->category_id);
            if ($category) {
                $categoryName = strtolower($category->name);
                $categorySlug = strtolower($category->slug ?? '');
                $isMachineCategory = str_contains($categoryName, 'เครื่องจักร') || 
                                   str_contains($categorySlug, 'machine') ||
                                   str_contains($categoryName, 'machine');
            }
        }

        if ($isMachineCategory) {
            // Get all machine zone problems
            $query = MachineZoneProblem::with(['zone.machine'])
                ->where('is_active', true)
                ->orderBy('order', 'asc')
                ->orderBy('created_at', 'desc');

            // Search
            if ($request->has('search')) {
                $search = $request->search;
                $query->where(function ($q) use ($search) {
                    $q->where('title', 'like', "%{$search}%")
                      ->orWhere('description', 'like', "%{$search}%")
                      ->orWhereHas('zone.machine', function ($machineQuery) use ($search) {
                          $machineQuery->where('name', 'like', "%{$search}%")
                                       ->orWhere('code', 'like', "%{$search}%");
                      })
                      ->orWhereHas('zone', function ($zoneQuery) use ($search) {
                          $zoneQuery->where('name', 'like', "%{$search}%")
                                   ->orWhere('code', 'like', "%{$search}%");
                      });
                });
            }

            $machineProblems = $query->get();

            // Transform machine zone problems to match problem structure
            $transformedProblems = $machineProblems->map(function ($problem) use ($category) {
                return [
                    'id' => $problem->id,
                    'is_machine_zone_problem' => true, // Flag to identify machine zone problems
                    'title' => $problem->title,
                    'description' => $problem->description,
                    'video_path' => $problem->video_path,
                    'solution_text' => $problem->solution_text,
                    'solution_video_path' => $problem->solution_video_path,
                    'views' => $problem->views,
                    'is_active' => $problem->is_active,
                    'order' => $problem->order,
                    'created_at' => $problem->created_at,
                    'category' => $category,
                    'machine_zone_id' => $problem->machine_zone_id,
                    'zone' => $problem->zone,
                    'machine' => $problem->zone->machine ?? null,
                ];
            });

            // Paginate manually
            $page = $request->get('page', 1);
            $perPage = 12;
            $total = $transformedProblems->count();
            $items = $transformedProblems->slice(($page - 1) * $perPage, $perPage)->values();

            return response()->json([
                'data' => $items,
                'current_page' => (int) $page,
                'per_page' => $perPage,
                'total' => $total,
                'last_page' => ceil($total / $perPage),
            ]);
        }

        // Normal problems
        $query = Problem::with('category')
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

        // Category filter
        if ($request->has('category_id')) {
            $query->where('category_id', $request->category_id);
        }

        $problems = $query->get();

        // If no category filter, also get machine zone problems
        if (!$request->has('category_id')) {
            $machineQuery = MachineZoneProblem::with(['zone.machine'])
                ->where('is_active', true)
                ->orderBy('order', 'asc')
                ->orderBy('created_at', 'desc');

            // Search for machine problems too
            if ($request->has('search')) {
                $search = $request->search;
                $machineQuery->where(function ($q) use ($search) {
                    $q->where('title', 'like', "%{$search}%")
                      ->orWhere('description', 'like', "%{$search}%")
                      ->orWhereHas('zone.machine', function ($machineQuery) use ($search) {
                          $machineQuery->where('name', 'like', "%{$search}%")
                                       ->orWhere('code', 'like', "%{$search}%");
                      })
                      ->orWhereHas('zone', function ($zoneQuery) use ($search) {
                          $zoneQuery->where('name', 'like', "%{$search}%")
                                   ->orWhere('code', 'like', "%{$search}%");
                      });
                });
            }

            $machineProblems = $machineQuery->get();

            // Find machine category
            $machineCategory = Category::where(function ($q) {
                $q->whereRaw('LOWER(name) LIKE ?', ['%เครื่องจักร%'])
                  ->orWhereRaw('LOWER(slug) LIKE ?', ['%machine%'])
                  ->orWhereRaw('LOWER(name) LIKE ?', ['%machine%']);
            })->first();

            // Transform machine zone problems
            $transformedMachineProblems = $machineProblems->map(function ($problem) use ($machineCategory) {
                return [
                    'id' => $problem->id,
                    'is_machine_zone_problem' => true,
                    'title' => $problem->title,
                    'description' => $problem->description,
                    'video_path' => $problem->video_path,
                    'solution_text' => $problem->solution_text,
                    'solution_video_path' => $problem->solution_video_path,
                    'views' => $problem->views,
                    'is_active' => $problem->is_active,
                    'order' => $problem->order,
                    'created_at' => $problem->created_at,
                    'category' => $machineCategory,
                    'machine_zone_id' => $problem->machine_zone_id,
                    'zone' => $problem->zone,
                    'machine' => $problem->zone->machine ?? null,
                ];
            });

            // Merge problems
            $allProblems = $problems->concat($transformedMachineProblems);
        } else {
            $allProblems = $problems;
        }

        // Sort by created_at desc (convert to timestamp for proper sorting)
        $allProblems = $allProblems->sortByDesc(function ($problem) {
            return strtotime($problem['created_at']);
        })->values();

        // Paginate manually
        $page = $request->get('page', 1);
        $perPage = 12;
        $total = $allProblems->count();
        $items = $allProblems->slice(($page - 1) * $perPage, $perPage)->values();

        return response()->json([
            'data' => $items,
            'current_page' => (int) $page,
            'per_page' => $perPage,
            'total' => $total,
            'last_page' => ceil($total / $perPage),
        ]);
    }

    public function show($id)
    {
        $problem = Problem::with('category')->findOrFail($id);
        
        // Increment views
        $problem->incrementViews();

        return response()->json($problem);
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'title' => 'required|string|max:255',
            'title_mm' => 'nullable|string|max:255',
            'description' => 'required|string',
            'description_mm' => 'nullable|string',
            'category_id' => 'nullable|exists:categories,id',
            'video' => 'nullable|file|mimes:mp4,avi,mov,wmv,flv,webm|max:102400', // 100MB max
            'solution_text' => 'nullable|string',
            'solution_text_mm' => 'nullable|string',
            'solution_video' => 'nullable|file|mimes:mp4,avi,mov,wmv,flv,webm|max:102400',
            'is_active' => 'nullable|boolean',
            'order' => 'nullable|integer',
        ]);
        
        // Convert string "1"/"0" to boolean if needed
        if (isset($validated['is_active']) && is_string($validated['is_active'])) {
            $validated['is_active'] = filter_var($validated['is_active'], FILTER_VALIDATE_BOOLEAN);
        }

        $problem = new Problem();
        $problem->title = $validated['title'];
        $problem->title_mm = $validated['title_mm'] ?? null;
        $problem->slug = Str::slug($validated['title']) . '-' . time();
        $problem->description = $validated['description'];
        $problem->description_mm = $validated['description_mm'] ?? null;
        $problem->category_id = $validated['category_id'] ?? null;
        $problem->solution_text = $validated['solution_text'] ?? null;
        $problem->solution_text_mm = $validated['solution_text_mm'] ?? null;
        $problem->is_active = $validated['is_active'] ?? true;
        $problem->order = $validated['order'] ?? 0;

        // Upload problem video
        if ($request->hasFile('video')) {
            $videoPath = $request->file('video')->store('videos/problems', 'public');
            $problem->video_path = $videoPath;
        }

        // Upload solution video
        if ($request->hasFile('solution_video')) {
            $solutionVideoPath = $request->file('solution_video')->store('videos/solutions', 'public');
            $problem->solution_video_path = $solutionVideoPath;
        }

        $problem->save();

        return response()->json($problem->load('category'), 201);
    }

    public function update(Request $request, $id)
    {
        $problem = Problem::findOrFail($id);

        $rules = [
            'title' => 'required|string|max:255',
            'title_mm' => 'nullable|string|max:255',
            'description' => 'required|string',
            'description_mm' => 'nullable|string',
            'category_id' => 'nullable|exists:categories,id',
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
        
        // Convert string "1"/"0" to boolean if needed
        if (isset($validated['is_active']) && is_string($validated['is_active'])) {
            $validated['is_active'] = filter_var($validated['is_active'], FILTER_VALIDATE_BOOLEAN);
        }

        $problem->title = $validated['title'];
        $problem->title_mm = $validated['title_mm'] ?? null;
        $problem->description = $validated['description'];
        $problem->description_mm = $validated['description_mm'] ?? null;
        $problem->category_id = $validated['category_id'] ?? null;
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
            // Delete old video
            if ($problem->video_path) {
                Storage::disk('public')->delete($problem->video_path);
            }
            $videoPath = $request->file('video')->store('videos/problems', 'public');
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
            // Delete old video
            if ($problem->solution_video_path) {
                Storage::disk('public')->delete($problem->solution_video_path);
            }
            $solutionVideoPath = $request->file('solution_video')->store('videos/solutions', 'public');
            $problem->solution_video_path = $solutionVideoPath;
        }

        $problem->save();

        return response()->json($problem->load('category'));
    }

    public function destroy($id)
    {
        $problem = Problem::findOrFail($id);

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

    public function all(Request $request)
    {
        // For admin - get all problems including inactive
        $query = Problem::with('category')->orderBy('order', 'asc')->orderBy('created_at', 'desc');

        if ($request->has('search')) {
            $search = $request->search;
            $query->where(function ($q) use ($search) {
                $q->where('title', 'like', "%{$search}%")
                  ->orWhere('description', 'like', "%{$search}%");
            });
        }

        if ($request->has('category_id')) {
            $query->where('category_id', $request->category_id);
        }

        $problems = $query->get();

        // Also get machine zone problems
        $machineQuery = MachineZoneProblem::with(['zone.machine', 'updatedBy'])
            ->orderBy('order', 'asc')
            ->orderBy('created_at', 'desc');

        // Search for machine problems too
        if ($request->has('search')) {
            $search = $request->search;
            $machineQuery->where(function ($q) use ($search) {
                $q->where('title', 'like', "%{$search}%")
                  ->orWhere('description', 'like', "%{$search}%")
                  ->orWhereHas('zone.machine', function ($machineQuery) use ($search) {
                      $machineQuery->where('name', 'like', "%{$search}%")
                                   ->orWhere('code', 'like', "%{$search}%");
                  })
                  ->orWhereHas('zone', function ($zoneQuery) use ($search) {
                      $zoneQuery->where('name', 'like', "%{$search}%")
                               ->orWhere('code', 'like', "%{$search}%");
                  });
            });
        }

        // Find machine category
        $machineCategory = Category::where(function ($q) {
            $q->whereRaw('LOWER(name) LIKE ?', ['%เครื่องจักร%'])
              ->orWhereRaw('LOWER(slug) LIKE ?', ['%machine%'])
              ->orWhereRaw('LOWER(name) LIKE ?', ['%machine%']);
        })->first();

        $machineProblems = $machineQuery->get();

        // Transform machine zone problems to match problem structure
        $transformedMachineProblems = $machineProblems->map(function ($problem) use ($machineCategory) {
            return [
                'id' => $problem->id,
                'is_machine_zone_problem' => true,
                'title' => $problem->title,
                'title_mm' => $problem->title_mm,
                'description' => $problem->description,
                'description_mm' => $problem->description_mm,
                'video_path' => $problem->video_path,
                'solution_text' => $problem->solution_text,
                'solution_text_mm' => $problem->solution_text_mm,
                'solution_video_path' => $problem->solution_video_path,
                'views' => $problem->views,
                'is_active' => $problem->is_active,
                'order' => $problem->order,
                'created_at' => $problem->created_at,
                'updated_at' => $problem->updated_at,
                'category' => $machineCategory,
                'category_id' => $machineCategory?->id,
                'machine_zone_id' => $problem->machine_zone_id,
                'zone' => $problem->zone,
                'machine' => $problem->zone->machine ?? null,
                'updated_by_user' => $problem->updatedBy ? [
                    'id' => $problem->updatedBy->id,
                    'name' => $problem->updatedBy->name,
                    'username' => $problem->updatedBy->username,
                ] : null,
            ];
        });

        // Merge problems
        $allProblems = $problems->concat($transformedMachineProblems);

        // Sort by created_at desc
        $allProblems = $allProblems->sortByDesc(function ($problem) {
            return strtotime($problem['created_at'] ?? $problem->created_at);
        })->values();

        // Paginate manually
        $page = $request->get('page', 1);
        $perPage = 12;
        $total = $allProblems->count();
        $items = $allProblems->slice(($page - 1) * $perPage, $perPage)->values();

        return response()->json([
            'data' => $items,
            'current_page' => (int) $page,
            'per_page' => $perPage,
            'total' => $total,
            'last_page' => ceil($total / $perPage),
        ]);
    }
}

<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Copies ?token= from the query string into the Authorization Bearer header so
 * EventSource/SSE URLs can authenticate without custom headers.
 */
class AttachSanctumTokenFromQuery
{
    public function handle(Request $request, Closure $next): Response
    {
        if (! $request->bearerToken() && $request->filled('token')) {
            $request->headers->set('Authorization', 'Bearer '.$request->query('token'));
        }

        return $next($request);
    }
}

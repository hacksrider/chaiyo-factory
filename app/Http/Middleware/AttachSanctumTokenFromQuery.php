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
        if (! $request->bearerToken()) {
            $token = $this->resolveQueryToken($request);
            if ($token !== null && $token !== '') {
                $request->headers->set('Authorization', 'Bearer '.$token);
            }
        }

        return $next($request);
    }

    /**
     * Sanctum tokens are "{id}|{secret}" — some proxies mishandle "|" in query strings.
     * Prefer base64url param `t`; keep legacy `token` for older frontends.
     */
    private function resolveQueryToken(Request $request): ?string
    {
        if ($request->filled('t')) {
            $raw = (string) $request->query('t');
            $decoded = base64_decode(strtr($raw, '-_', '+/'), true);
            if ($decoded !== false && $decoded !== '') {
                return $decoded;
            }
        }

        if ($request->filled('token')) {
            return (string) $request->query('token');
        }

        return null;
    }
}

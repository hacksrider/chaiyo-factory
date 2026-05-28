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
            // Frontend sends base64url without "=" padding. PHP's base64_decode(strict)
            // can fail when padding is missing, so we normalize + pad to a multiple of 4.
            $b64 = strtr($raw, '-_', '+/');
            $padLen = (4 - (strlen($b64) % 4)) % 4;
            if ($padLen > 0) {
                $b64 .= str_repeat('=', $padLen);
            }
            $decoded = base64_decode($b64, true);
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

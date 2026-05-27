<?php

use Illuminate\Auth\AuthenticationException;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->trustProxies(at: '*');

        // SPA login lives at /admin/login (React Router), not route('login').
        $middleware->redirectGuestsTo('/admin/login');

        $middleware->api(prepend: [
            \Laravel\Sanctum\Http\Middleware\EnsureFrontendRequestsAreStateful::class,
        ]);

        // Production Monitor routes are a server-side proxy to Google Apps Script
        // and do not require user authentication or CSRF protection.
        $middleware->validateCsrfTokens(except: [
            'api/production-monitor/*',
        ]);

        $middleware->alias([
            'admin' => \App\Http\Middleware\EnsureUserIsAdmin::class,
            'sanctum.query' => \App\Http\Middleware\AttachSanctumTokenFromQuery::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        // SSE/EventSource uses Accept: text/event-stream — not expectsJson().
        // API routes must return 401 JSON, never redirect (avoids Route [login] errors + reconnect storms).
        $exceptions->shouldRenderJsonWhen(function (Request $request, \Throwable $e) {
            if ($request->is('api/*')) {
                return true;
            }

            return $request->expectsJson();
        });

        $exceptions->render(function (AuthenticationException $e, Request $request) {
            if (! $request->is('api/*') && ! $request->expectsJson()) {
                return null;
            }

            return response()->json(['message' => $e->getMessage() ?: 'Unauthenticated.'], 401);
        });
    })->create();

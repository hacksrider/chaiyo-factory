import { defineConfig } from 'vite';
import laravel from 'laravel-vite-plugin';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [
        laravel({
            input: ['resources/css/app.css', 'resources/js/app.jsx'],
            refresh: true,
        }),
        react(),
    ],
    server: {
        // ให้เปิดจากเครื่องอื่นใน LAN ได้ (แก้ public/hot ที่เดิมเป็น [::1])
        host: '0.0.0.0',
        port: 5173,
        strictPort: true,
        cors: true,
        origin: process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173',
        hmr: {
            host: process.env.VITE_HMR_HOST || 'localhost',
            clientPort: 5173,
        },
        watch: {
            ignored: ['**/storage/framework/views/**'],
        },
    },
});

import path from "path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
export default defineConfig({
    plugins: [
        react(),
        tailwindcss(),
        VitePWA({
            registerType: "prompt",
            injectRegister: null, // регистрируем вручную в main.tsx (для показа промпта обновления)
            includeAssets: [
                "favicon.svg",
                "favicon-16.png",
                "favicon-32.png",
                "apple-touch-icon.png",
            ],
            manifest: {
                name: "STEALTHNET",
                short_name: "STEALTHNET",
                description: "Личный кабинет и админка STEALTHNET — VPN на базе Remnawave",
                lang: "ru",
                start_url: "/cabinet",
                scope: "/",
                display: "standalone",
                orientation: "portrait",
                background_color: "#0f172a",
                theme_color: "#0f172a",
                categories: ["productivity", "utilities"],
                icons: [
                    { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
                    { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
                    { src: "/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
                ],
                shortcuts: [
                    {
                        name: "Кабинет",
                        short_name: "Кабинет",
                        description: "Личный кабинет: тарифы, подписки, подключения",
                        url: "/cabinet",
                        icons: [{ src: "/icon-192.png", sizes: "192x192" }],
                    },
                    {
                        name: "Админка",
                        short_name: "Админ",
                        description: "Управление клиентами и тарифами",
                        url: "/admin",
                        icons: [{ src: "/icon-192.png", sizes: "192x192" }],
                    },
                ],
            },
            workbox: {
                // SPA-роутинг: любой не-API путь отдаём index.html из кеша
                navigateFallback: "/index.html",
                navigateFallbackDenylist: [
                    /^\/api\//,
                    /^\/assets\/.*\.(png|jpg|jpeg|svg|webp|ico)$/,
                ],
                maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
                skipWaiting: false, // ждём подтверждения от пользователя на обновление
                clientsClaim: true,
                cleanupOutdatedCaches: true,
                runtimeCaching: [
                    {
                        // Не кешируем API — всегда идём в сеть
                        urlPattern: /\/api\/.*/i,
                        handler: "NetworkOnly",
                    },
                    {
                        // Google-шрифты
                        urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
                        handler: "CacheFirst",
                        options: {
                            cacheName: "google-fonts",
                            expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
                            cacheableResponse: { statuses: [0, 200] },
                        },
                    },
                    {
                        // Картинки/логотипы
                        urlPattern: /\.(?:png|jpg|jpeg|svg|webp|gif|ico)$/i,
                        handler: "StaleWhileRevalidate",
                        options: {
                            cacheName: "images",
                            expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 },
                        },
                    },
                ],
            },
            devOptions: {
                enabled: false,
            },
        }),
    ],
    build: {
        rollupOptions: {
            output: {
                manualChunks(id) {
                    if (id.includes("node_modules/leaflet") || id.includes("node_modules/react-leaflet") || id.includes("node_modules/@react-leaflet")) return "leaflet";
                    if (id.includes("node_modules/recharts") || id.includes("node_modules/d3-")) return "recharts";
                    if (id.includes("node_modules/react-force-graph")) return "force-graph";
                    if (id.includes("node_modules/framer-motion")) return "framer";
                },
            },
        },
    },
    resolve: {
        alias: { "@": path.resolve(__dirname, "./src") },
    },
    server: {
        port: 5173,
        proxy: {
            "/api": { target: "http://localhost:5001", changeOrigin: true },
        },
    },
});

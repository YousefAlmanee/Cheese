import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["pg", "web-push"],
  experimental: {
    // Keep rendered pages in the client router cache so Back/Forward is instant instead of re-fetching.
    staleTimes: { dynamic: 60, static: 300 },
    // Warm dynamic routes on hover/touch so the next tap feels immediate.
    dynamicOnHover: true,
  },
  async headers() {
    return [
      // The service worker must never be served from a stale cache, or reminders stop working after an update.
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }, { key: "Service-Worker-Allowed", value: "/" }] },
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default config;

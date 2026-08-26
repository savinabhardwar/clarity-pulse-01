import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

interface SitemapEntry {
  path: string;
  changefreq?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority?: string;
}

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      // BASE_URL comes from the incoming request's origin rather than a
      // hardcoded constant -- a relative <loc> is invalid per the sitemap
      // spec and gets ignored by search engines, and hardcoding would
      // break anyway across the Lovable preview domain, the Netlify
      // deploy URL, and any future custom domain.
      GET: async ({ request }) => {
        const baseUrl = new URL(request.url).origin;
        const entries: SitemapEntry[] = [
          { path: "/", changefreq: "daily", priority: "1.0" },
          { path: "/resource-planning", changefreq: "daily", priority: "0.8" },
          { path: "/projects", changefreq: "daily", priority: "0.9" },
          { path: "/people", changefreq: "daily", priority: "0.8" },
          { path: "/team-health", changefreq: "daily", priority: "0.7" },
        ];

        const urls = entries.map((e) =>
          [
            `  <url>`,
            `    <loc>${baseUrl}${e.path}</loc>`,
            e.changefreq ? `    <changefreq>${e.changefreq}</changefreq>` : null,
            e.priority ? `    <priority>${e.priority}</priority>` : null,
            `  </url>`,
          ]
            .filter(Boolean)
            .join("\n"),
        );

        const xml = [
          `<?xml version="1.0" encoding="UTF-8"?>`,
          `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
          ...urls,
          `</urlset>`,
        ].join("\n");

        return new Response(xml, {
          headers: { "Content-Type": "application/xml", "Cache-Control": "public, max-age=3600" },
        });
      },
    },
  },
});

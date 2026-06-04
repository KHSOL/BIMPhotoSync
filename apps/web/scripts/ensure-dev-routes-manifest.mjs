import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const appDir = path.resolve("app");
const nextDir = path.resolve(".next");
const manifestPath = path.join(nextDir, "routes-manifest.json");

function routeFromPageFile(filePath) {
  const relative = path.relative(appDir, filePath).replaceAll(path.sep, "/");
  const withoutPage = relative.replace(/\/page\.(tsx|ts|jsx|js)$/, "");
  const route = withoutPage === "page.tsx" || withoutPage === "page.ts" || withoutPage === "page.jsx" || withoutPage === "page.js" ? "/" : `/${withoutPage}`;
  return route.replace(/\/+/g, "/");
}

function walkPages(dir, pages = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const current = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkPages(current, pages);
      continue;
    }
    if (/^page\.(tsx|ts|jsx|js)$/.test(entry.name)) {
      pages.push(routeFromPageFile(current));
    }
  }
  return pages;
}

function escapeRegex(route) {
  return route.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&");
}

function routeRegex(route) {
  if (route === "/") return "^/(?:/)?$";
  return `^${escapeRegex(route)}(?:/)?$`;
}

const staticRoutes = walkPages(appDir)
  .sort()
  .map((route) => ({
    page: route,
    regex: routeRegex(route),
    routeKeys: {},
    namedRegex: routeRegex(route)
  }));

const manifest = {
  version: 3,
  pages404: true,
  caseSensitive: false,
  basePath: "",
  redirects: [],
  headers: [],
  rewrites: {
    beforeFiles: [],
    afterFiles: [],
    fallback: []
  },
  dynamicRoutes: [],
  staticRoutes,
  dataRoutes: [],
  rsc: {
    header: "rsc",
    varyHeader: "rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch",
    prefetchHeader: "next-router-prefetch",
    didPostponeHeader: "x-nextjs-postponed",
    contentTypeHeader: "text/x-component",
    suffix: ".rsc",
    prefetchSuffix: ".prefetch.rsc",
    prefetchSegmentHeader: "next-router-segment-prefetch",
    prefetchSegmentSuffix: ".segment.rsc",
    prefetchSegmentDirSuffix: ".segments"
  },
  rewriteHeaders: {
    pathHeader: "x-nextjs-rewritten-path",
    queryHeader: "x-nextjs-rewritten-query"
  },
  skipMiddlewareUrlNormalize: false
};

mkdirSync(nextDir, { recursive: true });

if (!existsSync(manifestPath)) {
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

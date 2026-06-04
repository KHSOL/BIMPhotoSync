import path from "node:path";
import { fileURLToPath } from "node:url";

const webDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(webDir, "../..");

const nextConfig = {
  outputFileTracingRoot: repoRoot,
  turbopack: {
    root: repoRoot
  }
};

export default nextConfig;

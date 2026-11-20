import { defineConfig } from "vite";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";

// vite.config.ts 는 Node 에서 실행된다. @types/node 없이도 동작하도록 필요한 부분만 선언한다.
declare const process: { env: Record<string, string | undefined> };

/**
 * GitHub Pages 서브패스 배포용 base.
 * - 로컬 개발·미리보기: 기본값 "/"
 * - 배포 빌드: `npm run build:pages` (= vite build --base=/trade-timemachine/)
 *   또는 `VITE_BASE_PATH=/trade-timemachine/ npm run build`
 */
const base = (process.env.VITE_BASE_PATH ?? "/").trim() || "/";

/**
 * v2.3.3 — index.html 의 CSP 메타는 배포 산출물의 정책이다.
 * `vite dev` 는 HMR·React Refresh 프리앰블을 **인라인 스크립트**로 넣기 때문에 `script-src 'self'`
 * 아래에서는 앱이 뜨지 않는다. 그래서 개발 서버에서만 이 메타 한 줄을 걷어낸다(빌드에는 그대로 남는다).
 */
const stripCspInDev = (): Plugin => ({
  name: "ttm-strip-csp-in-dev",
  apply: "serve",
  transformIndexHtml(html) {
    return html.replace(/[ \t]*<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>\n/, "");
  },
});

export default defineConfig({
  base,
  plugins: [react(), stripCspInDev()],
  build: {
    outDir: "dist",
    target: "es2020",
  },
  server: {
    port: 4180,
    strictPort: true,
  },
  preview: {
    port: 4180,
    strictPort: true,
  },
});

import { defineConfig } from "vite";
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

export default defineConfig({
  base,
  plugins: [react()],
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

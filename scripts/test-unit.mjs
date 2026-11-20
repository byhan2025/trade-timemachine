#!/usr/bin/env node
/**
 * 단위 테스트 러너: tests/entry.ts 를 esbuild로 번들한 뒤 node --test 로 실행한다.
 * 추가 패키지 설치 없이(esbuild는 vite 의존성) TypeScript 소스를 그대로 검증한다.
 *
 *   npm test
 */
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, "..");
const outfile = resolve(appDir, "tests/.build/lib.mjs");

mkdirSync(dirname(outfile), { recursive: true });
await build({
  entryPoints: [resolve(appDir, "tests/entry.ts")],
  outfile,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  logLevel: "warning",
  // App.tsx 의 import.meta.env.BASE_URL 은 Vite 가 넣는 값이다. node 에서 그대로 돌리려면 정의해 준다
  // (v2.3.3 — App 을 서버 렌더해 탭 패널 DOM 을 검사한다).
  define: { "import.meta.env.BASE_URL": '"/"' },
  // react 를 번들에 넣으면 react-dom/server 와 React 인스턴스가 갈라져 훅(useState)이 깨진다.
  // 두 패키지는 런타임에 node_modules 에서 같은 인스턴스를 쓰게 둔다.
  external: ["react", "react-dom", "react-dom/server", "react/jsx-runtime"],
});

const result = spawnSync(
  process.execPath,
  ["--test", "tests/*.test.mjs"],
  { cwd: appDir, stdio: "inherit", shell: true }
);
process.exit(result.status ?? 1);

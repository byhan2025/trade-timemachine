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
});

const result = spawnSync(
  process.execPath,
  ["--test", "tests/*.test.mjs"],
  { cwd: appDir, stdio: "inherit", shell: true }
);
process.exit(result.status ?? 1);

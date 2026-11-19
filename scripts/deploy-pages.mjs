#!/usr/bin/env node
/**
 * GitHub Pages 배포 — dist/ 를 gh-pages 브랜치로 올린다 (서브패스 /trade-timemachine/ 대응).
 *
 *   npm run deploy:pages
 *   npm run deploy:pages -- --dry-run      # 커밋·푸시 없이 검사만
 *
 * 동작
 * 1. dist/ 가 최신 서브패스 빌드인지 확인(index.html 이 /trade-timemachine/assets/ 를 가리키는지)
 * 2. 임시 git worktree 를 gh-pages 브랜치에 붙이고 dist/ 내용만 남긴다
 * 3. 커밋 후 origin gh-pages 로 푸시한다 (원래 작업 트리·다른 브랜치는 건드리지 않는다)
 *
 * gh-pages 같은 외부 패키지 없이 git 만으로 동작하도록 만들었다.
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, "..");
const distDir = join(appDir, "dist");
const tmpDir = join(appDir, ".gh-pages");
const SUBPATH = "/trade-timemachine/";
const dryRun = process.argv.includes("--dry-run");

const git = (args, opts = {}) =>
  execFileSync("git", args, { cwd: appDir, stdio: opts.quiet ? "pipe" : "inherit", encoding: "utf8" });

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

/* 1. 빌드 산출물 검사 ---------------------------------------------------- */
if (!existsSync(join(distDir, "index.html"))) {
  fail("dist/index.html 이 없습니다. 먼저 `npm run build:pages` 를 실행하세요.");
}
const html = readFileSync(join(distDir, "index.html"), "utf8");
if (!html.includes(`${SUBPATH}assets/`) && !html.includes(`${SUBPATH}samples/`)) {
  fail(
    `dist/index.html 이 ${SUBPATH} 서브패스 빌드가 아닙니다.\n` +
      "  `npm run deploy:pages` 는 build:pages 를 먼저 실행하므로, 직접 배포할 때는 `npm run build:pages` 를 쓰세요."
  );
}
if (!existsSync(join(distDir, "samples/index.json"))) {
  fail("dist/samples/index.json 이 없습니다. 내장 5종목 데이터가 빠졌습니다.");
}

/* 2. 원격 확인 ----------------------------------------------------------- */
let remoteUrl = "";
try {
  remoteUrl = git(["remote", "get-url", "origin"], { quiet: true }).trim();
} catch {
  fail("origin 원격이 없습니다. `git remote add origin https://github.com/byhan2025/trade-timemachine.git`");
}
console.log(`저장소: ${remoteUrl}`);
console.log(`배포 대상: gh-pages 브랜치 · 공개 경로 ${SUBPATH}`);

if (dryRun) {
  console.log("\n(dry-run) 검사만 마쳤습니다. 실제 커밋·푸시는 하지 않았습니다.");
  process.exit(0);
}

/* 3. gh-pages 브랜치 준비 ------------------------------------------------ */
git(["fetch", "origin", "--prune"], { quiet: true });
let hasRemoteBranch = true;
try {
  git(["rev-parse", "--verify", "refs/remotes/origin/gh-pages"], { quiet: true });
} catch {
  hasRemoteBranch = false;
}

rmSync(tmpDir, { recursive: true, force: true });
if (hasRemoteBranch) {
  git(["worktree", "add", "-B", "gh-pages", tmpDir, "origin/gh-pages"]);
} else {
  console.log("origin/gh-pages 가 없어 새 브랜치를 만듭니다.");
  git(["worktree", "add", "--detach", tmpDir, "HEAD"]);
  git(["-C", tmpDir, "checkout", "--orphan", "gh-pages"]);
}

/* 4. gh-pages 에는 dist 산출물만 올린다 ---------------------------------- */
for (const entry of readdirSync(tmpDir)) {
  if (entry === ".git") continue;
  rmSync(join(tmpDir, entry), { recursive: true, force: true });
}
cpSync(distDir, tmpDir, { recursive: true });
writeFileSync(join(tmpDir, ".nojekyll"), "");

const stamp = new Date().toISOString().replace("T", " ").slice(0, 19);
git(["-C", tmpDir, "add", "-A"]);
let changed = true;
try {
  git(["-C", tmpDir, "diff", "--cached", "--quiet"], { quiet: true });
  changed = false;
} catch {
  changed = true;
}
if (!changed) {
  console.log("변경된 산출물이 없어 커밋을 건너뜁니다.");
} else {
  git(["-C", tmpDir, "commit", "-m", `deploy: GitHub Pages ${stamp} UTC`]);
}
git(["-C", tmpDir, "push", "origin", "HEAD:gh-pages", "--force"]);

/* 5. 정리 ---------------------------------------------------------------- */
git(["worktree", "remove", "--force", tmpDir]);
rmSync(tmpDir, { recursive: true, force: true });

console.log("\n✔ gh-pages 푸시 완료");
console.log("  Pages 반영까지 수십 초 걸릴 수 있습니다.");
console.log("  https://byhan2025.github.io/trade-timemachine/");

#!/usr/bin/env node
// 由 node_modules/esbuild-wasm 產生 Apps Script 用的 Esbuild.gs。
// 升級 esbuild：npm i -D esbuild-wasm@<版本> && npm run vendor，再把 Esbuild.gs 貼到 Apps Script。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkgDir = path.dirname(require.resolve('esbuild-wasm/package.json'));
const { version } = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
const src = fs.readFileSync(path.join(pkgDir, 'lib/browser.min.js'), 'utf8').trim();

// 原本的 UMD 結尾在 Apps Script 會把 exports 掛到錯的物件上，改成直接回傳
const footer = /\}\)\(typeof module==="object"\?module:\{set exports\(x\)\{\(typeof self!=="undefined"\?self:this\)\.esbuild=x\}\}\);?$/;
if (!src.startsWith('(module=>{') || !footer.test(src)) throw new Error('browser.min.js 格式不符，請檢查 esbuild-wasm 版本');
const body = src.replace(footer, '})({set exports(x){exported=x}});');

const out = `/**
 * esbuild-wasm ${version} 的 JavaScript API（lib/browser.min.js）
 * 由 tools/vendor-esbuild.mjs 產生，請勿手動修改。
 *
 * esbuild — Copyright (c) 2020 Evan Wallace — MIT License — https://github.com/evanw/esbuild
 *
 * 整段包在函式裡：Apps Script 每次執行（包含每個網頁請求）都會載入所有 .gs 檔，
 * 這樣只有建置時才會真正執行，也不會因為缺少 TextEncoder 而在載入時出錯。
 * 對應的 esbuild.wasm 由 installEsbuild() 下載到 Google Drive。
 */
const ESBUILD_VERSION = '${version}';

function esbuildModule_() {
  let exported;
  ${body}
  return exported;
}
`;
fs.writeFileSync(new URL('../Esbuild.gs', import.meta.url), out);
console.log(`Esbuild.gs ← esbuild-wasm ${version} (${(out.length / 1024).toFixed(1)} KB)`);

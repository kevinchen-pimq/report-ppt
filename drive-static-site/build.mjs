#!/usr/bin/env node
/**
 * 用 esbuild 打包網站後再上傳到 Drive。
 *
 *   node build.mjs <來源資料夾> <輸出資料夾> [--watch] [--dev]
 *
 * - HTML 裡引用的本地 <script src> 與 <link rel="stylesheet"> 會被當成進入點打包成單一檔案：
 *   ES module 的 import、npm 套件、TypeScript / JSX 都可以用（Apps Script 的沙盒 iframe
 *   沒辦法用相對路徑載入其他模組，所以 import 一定要先打包）。
 * - .ts / .tsx / .jsx 進入點輸出成 .js，HTML 裡的路徑會一起改掉。
 * - 被打包進去的模組不會再複製到輸出資料夾，其他檔案（HTML、圖片、字型、JSON…）原樣複製。
 * - 輸出資料夾可以直接指到「Google 雲端硬碟電腦版」同步的資料夾，存檔就會自動上傳。
 */
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const [srcArg, outArg] = args.filter((a) => !a.startsWith('--'));
if (!srcArg || !outArg) {
  console.error('用法：node build.mjs <來源資料夾> <輸出資料夾> [--watch] [--dev]');
  process.exit(1);
}
const SRC = path.resolve(srcArg);
const OUT = path.resolve(outArg);
const DEV = flags.has('--dev');
if (OUT === SRC || OUT.startsWith(SRC + path.sep)) {
  console.error('輸出資料夾不能在來源資料夾裡面');
  process.exit(1);
}

const TAG_ATTRS = '((?:[^>"\']|"[^"]*"|\'[^\']*\')*)';
const SCRIPT_RE = new RegExp('<script\\b' + TAG_ATTRS + '>', 'gi');
const LINK_RE = new RegExp('<link\\b' + TAG_ATTRS + '>', 'gi');
const SOURCE_ONLY_EXT = /\.(tsx?|jsx|mts|cts)$/i; // 這些副檔名只在原始碼裡，不複製
const IMAGE_FONT_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.bmp', '.ico', '.svg',
  '.woff', '.woff2', '.ttf', '.otf', '.eot'];

function getAttr(attrs, name) {
  const m = attrs.match(new RegExp('(?:^|\\s)' + name + '(?:\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s"\'>]+)))?', 'i'));
  return m ? (m[1] ?? m[2] ?? m[3] ?? '') : null;
}

const isLocal = (u) => !!u && !/^(#|[a-z][a-z0-9+.\-]*:|\/\/)/i.test(u.trim());

/** HTML 裡的引用 → 來源檔案絕對路徑（不存在回傳 null） */
function resolveRef(htmlFile, ref) {
  const clean = decodeURI(ref.trim().replace(/[?#].*$/, ''));
  const abs = clean.startsWith('/') ? path.join(SRC, clean) : path.resolve(path.dirname(htmlFile), clean);
  return abs.startsWith(SRC + path.sep) && fs.existsSync(abs) && fs.statSync(abs).isFile() ? abs : null;
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    if (d.name.startsWith('.') || d.name === 'node_modules') return [];
    const p = path.join(dir, d.name);
    return d.isDirectory() ? walk(p) : [p];
  });
}

/** 進入點對應的輸出相對路徑：js/app.ts → js/app.js */
function outRel(abs, kind) {
  const rel = path.relative(SRC, abs);
  return kind === 'css' ? rel.replace(/\.[^./\\]+$/, '.css') : rel.replace(/\.[^./\\]+$/, '.js');
}

function scanEntries(htmlFiles) {
  const entries = new Map(); // abs → { kind: 'js' | 'css', module: boolean }
  for (const html of htmlFiles) {
    const text = fs.readFileSync(html, 'utf8');
    for (const [, attrs] of text.matchAll(SCRIPT_RE)) {
      const src = getAttr(attrs, 'src');
      const abs = isLocal(src) && resolveRef(html, src);
      if (!abs) continue;
      const isModule = (getAttr(attrs, 'type') || '').toLowerCase() === 'module';
      const prev = entries.get(abs);
      if (prev && prev.module !== isModule) console.warn(`⚠ ${path.relative(SRC, abs)} 同時被當成 module 和一般 script 引用，以 module 打包`);
      entries.set(abs, { kind: 'js', module: isModule || (prev && prev.module) || false });
    }
    for (const [, attrs] of text.matchAll(LINK_RE)) {
      const rel = (getAttr(attrs, 'rel') || '').toLowerCase().split(/\s+/);
      const href = getAttr(attrs, 'href');
      const abs = rel.includes('stylesheet') && isLocal(href) && resolveRef(html, href);
      if (abs) entries.set(abs, { kind: 'css', module: false });
    }
  }
  return entries;
}

/** 把 HTML 裡指向 .ts/.tsx/.jsx/.mjs 進入點的路徑改成輸出後的 .js */
function rewriteHtml(html, text, entries) {
  return text.replace(SCRIPT_RE, (tag, attrs) => {
    const src = getAttr(attrs, 'src');
    const abs = isLocal(src) && resolveRef(html, src);
    if (!abs || !entries.has(abs)) return tag;
    const out = outRel(abs, 'js');
    if (out === path.relative(SRC, abs)) return tag;
    const newSrc = src.replace(/\.[^./?#]+(?=([?#].*)?$)/, '.js');
    return tag.replace(src, newSrc);
  });
}

async function build() {
  const t0 = Date.now();
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  const files = walk(SRC);
  const htmlFiles = files.filter((f) => /\.html?$/i.test(f));
  const entries = scanEntries(htmlFiles);
  const pick = (fn) => [...entries].filter(([, e]) => fn(e)).map(([abs]) => abs);

  const common = {
    bundle: true,
    outdir: OUT,
    outbase: SRC,
    minify: !DEV,
    sourcemap: DEV ? 'inline' : false,
    target: ['es2020', 'chrome100', 'firefox100', 'safari15'],
    metafile: true,
    logLevel: 'warning',
    legalComments: 'none',
  };
  // JS 裡 import 的圖片 / 字型直接變成 data URI（沙盒裡無法用相對路徑載入）
  const jsLoaders = Object.fromEntries(IMAGE_FONT_EXT.map((e) => [e, 'dataurl']));
  // CSS 的 url() 保留路徑（輸出到原本的位置），交給 Apps Script 決定內嵌或用縮圖網址
  const cssLoaders = Object.fromEntries(IMAGE_FONT_EXT.map((e) => [e, 'file']));

  const jobs = [];
  const classic = pick((e) => e.kind === 'js' && !e.module);
  const modules = pick((e) => e.kind === 'js' && e.module);
  const styles = pick((e) => e.kind === 'css');
  const define = { 'process.env.NODE_ENV': JSON.stringify(DEV ? 'development' : 'production') };
  if (classic.length) jobs.push(esbuild.build({ ...common, entryPoints: classic, format: 'iife', loader: jsLoaders, define }));
  if (modules.length) jobs.push(esbuild.build({ ...common, entryPoints: modules, format: 'esm', loader: jsLoaders, define }));
  if (styles.length) jobs.push(esbuild.build({ ...common, entryPoints: styles, loader: cssLoaders, assetNames: '[dir]/[name]' }));
  const results = await Promise.all(jobs);

  // 被打包進進入點的模組不需要上傳
  const bundled = new Set();
  for (const r of results) {
    for (const input of Object.keys(r.metafile.inputs)) bundled.add(path.resolve(input));
  }

  let copied = 0;
  for (const file of files) {
    if (entries.has(file)) continue;
    const isCode = /\.(m?js|css)$/i.test(file) || SOURCE_ONLY_EXT.test(file);
    if (isCode && bundled.has(file)) continue;
    if (SOURCE_ONLY_EXT.test(file)) continue;
    const dest = path.join(OUT, path.relative(SRC, file));
    if (fs.existsSync(dest)) continue; // esbuild 已經輸出（CSS 引用的圖片 / 字型）
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (/\.html?$/i.test(file)) fs.writeFileSync(dest, rewriteHtml(file, fs.readFileSync(file, 'utf8'), entries));
    else fs.copyFileSync(file, dest);
    copied++;
  }

  for (const r of results) {
    for (const [out, info] of Object.entries(r.metafile.outputs)) {
      if (info.entryPoint) console.log(`  ${path.relative(OUT, path.resolve(out)).padEnd(32)} ${(info.bytes / 1024).toFixed(1)} KB`);
    }
  }
  console.log(`✔ 打包 ${entries.size} 個進入點、複製 ${copied} 個檔案 → ${path.relative(process.cwd(), OUT) || '.'}（${Date.now() - t0} ms）`);
}

async function safeBuild() {
  try {
    await build();
  } catch (err) {
    if (!err.errors) console.error(err);
    if (!flags.has('--watch')) process.exit(1);
  }
}

await safeBuild();

if (flags.has('--watch')) {
  let timer = null;
  fs.watch(SRC, { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(safeBuild, 150);
  });
  console.log(`監看 ${path.relative(process.cwd(), SRC)} 中，存檔會自動重新打包…`);
}

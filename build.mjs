import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';

const { version } = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));

await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/bangumi-preference-rating.js',
  bundle: true,
  format: 'iife',
  target: 'es2022',
  loader: { '.css': 'text' },
  banner: { js: `// ==UserScript==
// @name         个性化评分
// @namespace    bangumi-preference-rating
// @version      ${version}
// @description  按类别比较条目，保存本地偏好评分
// @grant        none
// @match        *://bgm.tv/*
// @match        *://bangumi.tv/*
// @match        *://chii.in/*
// ==/UserScript==` },
});

import { build } from 'esbuild';

await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/bangumi-preference-rating.js',
  bundle: true,
  format: 'iife',
  target: 'es2022',
  loader: { '.css': 'text' },
  banner: { js: `// ==UserScript==
// @name         Bangumi 偏好评分
// @namespace    bangumi-preference-rating
// @version      0.1.0
// @description  按类别比较条目，保存本地偏好评分
// @grant        none
// @match        *://bgm.tv/*
// @match        *://bangumi.tv/*
// @match        *://chii.in/*
// ==/UserScript==` },
});

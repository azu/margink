// Build Margink as a userscript (.output/margink.user.js) for Tampermonkey,
// Violentmonkey, and similar managers. The metadata block tells the manager
// to check the latest GitHub release for updates.
import { build } from "esbuild";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const latest = "https://github.com/azu/margink/releases/latest/download/margink.user.js";
const header = `// ==UserScript==
// @name         Margink
// @namespace    https://github.com/azu/margink
// @version      ${pkg.version}
// @description  ${pkg.description}
// @homepageURL  https://github.com/azu/margink
// @supportURL   https://github.com/azu/margink/issues
// @match        https://github.com/*
// @grant        none
// @run-at       document-idle
// @updateURL    ${latest}
// @downloadURL  ${latest}
// ==/UserScript==
`;

const result = await build({
  entryPoints: ["src/userscript.ts"],
  bundle: true,
  format: "iife",
  target: "es2022",
  charset: "utf8",
  legalComments: "none",
  write: false,
});
mkdirSync(".output", { recursive: true });
writeFileSync(".output/margink.user.js", header + "\n" + result.outputFiles[0].text);
console.log(`.output/margink.user.js (${pkg.version})`);

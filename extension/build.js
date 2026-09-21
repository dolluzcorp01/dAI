#!/usr/bin/env node
/**
 * Package the extension for loading or for the Chrome Web Store.
 *
 *   node build.js            check only
 *   node build.js --zip      also write dist/kody-extension-<version>.zip
 *
 * There is no bundler on purpose. Every file is plain ES modules that Chrome
 * loads directly, so what you review is what ships. A bundler would also be a
 * place for a remote dependency to hide, and the CSP forbids remote code.
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = __dirname;
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
const problems = [];
const warnings = [];

const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

/* every file the manifest names must be present */
const referenced = new Set();
const need = (rel) => {
  referenced.add(rel);
  if (!exists(rel)) problems.push(`manifest names a missing file: ${rel}`);
};

need(manifest.background.service_worker);
need(manifest.action.default_popup);
need(manifest.side_panel.default_path);
Object.values(manifest.icons).forEach(need);
Object.values(manifest.action.default_icon || {}).forEach(need);
manifest.content_scripts.forEach(cs => {
  (cs.js || []).forEach(need);
  (cs.css || []).forEach(need);
});
(manifest.web_accessible_resources || []).forEach(w => w.resources.forEach(need));

/* nothing in the shipped tree may load remote code */
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
  const full = path.join(dir, e.name);
  if (e.isDirectory()) return e.name === "dist" || e.name === "node_modules" ? [] : walk(full);
  return [full];
});

for (const full of walk(path.join(ROOT, "src"))) {
  const rel = path.relative(ROOT, full);
  const src = read(rel);
  if (/\beval\s*\(|new\s+Function\s*\(/.test(src)) problems.push(`${rel} uses eval or new Function`);
  if (/importScripts\s*\(/.test(src)) problems.push(`${rel} uses importScripts`);
  if (/src=["']https?:\/\//.test(src)) problems.push(`${rel} references a remote script or style`);
  if (rel.endsWith(".html")) {
    const inline = src.match(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/gi) || [];
    if (inline.length > 0) problems.push(`${rel} has inline script, which the CSP blocks`);
    if (/\son\w+=/.test(src)) problems.push(`${rel} has an inline event handler`);
  }
}

/* the content script must never touch a token */
const bubble = read(manifest.content_scripts[0].js[0]);
if (/kody_access|kody_refresh|accessToken|refreshToken/.test(bubble)) {
  problems.push("the content script references a token, which the page could read");
}

/* store requirements that are easy to forget */
if (!/^\d+(\.\d+){0,3}$/.test(manifest.version)) problems.push("version must be one to four numbers");
if ((manifest.description || "").length > 132) problems.push("description must be 132 characters or fewer");
if (!manifest.icons["128"]) problems.push("a 128px icon is required by the store");
if (manifest.permissions.includes("<all_urls>")) problems.push("<all_urls> will fail review");
if ((manifest.host_permissions || []).some(h => h === "<all_urls>" || h === "*://*/*")) {
  warnings.push("broad host permissions slow store review");
}
if (!manifest.content_security_policy || !manifest.content_security_policy.extension_pages) {
  warnings.push("no explicit extension_pages CSP; Chrome's default is used");
}

/* report */
console.log(`Kody extension ${manifest.version}`);
console.log(`  files referenced by the manifest: ${referenced.size}`);
warnings.forEach(w => console.log(`  warning: ${w}`));

if (problems.length > 0) {
  console.error("\nFAILED");
  problems.forEach(p => console.error(`  ${p}`));
  process.exit(1);
}
console.log("  checks: passed");

if (process.argv.includes("--zip")) {
  const dist = path.join(ROOT, "dist");
  fs.mkdirSync(dist, { recursive: true });
  const out = path.join(dist, `kody-extension-${manifest.version}.zip`);
  if (fs.existsSync(out)) fs.unlinkSync(out);
  // Store rules: the zip contains the manifest at its root, not a folder.
  execSync(`cd "${ROOT}" && zip -r -q "${out}" manifest.json src icons -x "*.DS_Store"`);
  const size = fs.statSync(out).size;
  console.log(`  wrote ${path.relative(process.cwd(), out)} (${Math.round(size / 1024)} KB)`);
}

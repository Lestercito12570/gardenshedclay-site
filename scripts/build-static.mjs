// Build a static-only directory for Cloudflare Workers assets.
// Do not publish server source, order/customer data, schemas, or repository metadata.
import { cpSync, mkdirSync, readdirSync, statSync, copyFileSync, rmSync } from "node:fs";
import { extname, join } from "node:path";
const root = process.cwd();
const out = join(root, "dist");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const folders = ["assets", "journal", "js", "newsletters", "product-images", "public"];
for (const folder of folders) {
  const src = join(root, folder);
  try { if (statSync(src).isDirectory()) cpSync(src, join(out, folder), { recursive: true }); }
  catch (err) { if (err.code !== "ENOENT") throw err; }
}
const allowedExtensions = new Set([".html", ".css", ".js", ".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg", ".ico", ".xml", ".txt"]);
for (const entry of readdirSync(root, { withFileTypes: true })) {
  if (entry.isFile() && allowedExtensions.has(extname(entry.name).toLowerCase())) {
    copyFileSync(join(root, entry.name), join(out, entry.name));
  }
}
console.log("Prepared public website assets in dist/");

// Gera os PNGs do PWA a partir de icons/*.svg (Chromium do Playwright do e2e).
//   cd e2e && node build-icons.mjs
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const icons = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "icons");
const jobs = [
    ["icon.svg", "icon-192.png", 192], ["icon.svg", "icon-512.png", 512],
    ["icon-maskable.svg", "icon-maskable-512.png", 512], ["icon-maskable.svg", "apple-touch-icon.png", 180],
];
const browser = await chromium.launch();
for (const [src, out, size] of jobs) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    const svg = fs.readFileSync(path.join(icons, src), "utf8");
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`);
    await page.screenshot({ path: path.join(icons, out), omitBackground: true });
    await page.close();
}
await browser.close();
console.log("ícones gerados em icons/");

#!/usr/bin/env node
/**
 * Uses Playwright to capture a screenshot of a webpage with options for
 * transparent background, viewport size, zoom, and lossy compression.
 * The output can be PNG or WebP.
 *
 * Run with: npx @coldino/browser-snapper [options] <url> <output>
 */

import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { parseArgs } from "util";
import sharp from 'sharp';

type Parsed = {
  transparent: boolean;
  size?: string;
  "lossy-quality"?: string;
  wait?: string;
  zoom?: string;
  css?: string;
  help?: boolean;
  _: string[];
};

function showUsageAndExit(code = 0): never {
  console.log(`
Usage: browser-snapper [options] <url> <output>

Options:
  -t, --transparent         Make background transparent
  -s, --size WIDTHxHEIGHT   Viewport size, e.g. 1280x800
  -l, --lossy-quality N     Quality for lossy compression (0-100) [lossless by default]
  -w, --wait N              Wait N seconds after load event before screenshotting
  -z, --zoom N              Page zoom factor (e.g. 2 for 200%)
  -c, --css CSS             Remove background from the specified CSS selector(s) (e.g. ".main" or "main,#screen")
  -h, --help                Show this help

Examples:
  browser-snapper -t -s 1280x720 https://example.com out.png
  browser-snapper -w 10 -s 375x812 https://example.com phone.webp -l 80
`);
  process.exit(code);
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    options: {
      transparent: { type: "boolean", short: "t" },
      size: { type: "string", short: "s" },
      "lossy-quality": { type: "string", short: "l" },
      wait: { type: "string", short: "w" },
      zoom: { type: "string", short: "z" },
      css: { type: "string", short: "c" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  }) as { values: Parsed; positionals: string[] };

  if (values.help) showUsageAndExit(0);

  const positional = positionals;
  if (positional.length < 2) showUsageAndExit(2);

  const url = String(positional[0]);
  const outPath = String(positional[1]);
  const transparent = !!values.transparent;
  const extraCss = values.css ? String(values.css) : undefined;
  const sizeArg = values.size;

  // parse wait time
  let waitSeconds = 0;
  if (values.wait) {
    waitSeconds = parseFloat(String(values.wait));
    if (isNaN(waitSeconds) || waitSeconds < 0) {
      console.error("Invalid wait time. Must be a non-negative number.");
      process.exit(2);
    }
  }

  // parse zoom factor
  let zoomFactor = 1;
  if (values.zoom) {
    zoomFactor = parseFloat(String(values.zoom));
    if (isNaN(zoomFactor) || zoomFactor <= 0) {
      console.error("Invalid zoom factor. Must be a positive number.");
      process.exit(2);
    }
  }

  // parse lossy quality if provided
  let lossyQuality: number | undefined = undefined;
  if (values["lossy-quality"] !== undefined) {
    lossyQuality = parseInt(String(values["lossy-quality"]), 10);
    if (isNaN(lossyQuality) || lossyQuality < 0 || lossyQuality > 100) {
      console.error("Invalid lossy quality. Must be an integer between 0 and 100.");
      process.exit(2);
    }
  }

  // parse size
  let width = 1280;
  let height = 800;
  if (sizeArg) {
    const m = /^(\d+)x(\d+)$/.exec(String(sizeArg));
    if (!m || m.length !== 3) {
      console.error("Invalid size. Use WIDTHxHEIGHT, e.g. 1280x800");
      process.exit(2);
    }
    width = parseInt(m[1]!, 10);
    height = parseInt(m[2]!, 10);
  }

  // check output extension
  const ext = path.extname(outPath).toLowerCase();
  if (![".png", ".webp"].includes(ext)) {
    console.error("Output must be .png or .webp");
    process.exit(2);
  }

  // check if browser is not installed
  const exe = chromium.executablePath();
  if (!fs.existsSync(exe)) {
    console.log("Playwright Chromium is NOT installed and will be downloaded now. This may take a moment...");
  }

  console.log('Launching browser...');
  const browser = await chromium.launch({
    headless: false,
    args: ["--disable-gpu"]
  });

  console.log('Opening page with viewport', width, 'x', height, '...')
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: zoomFactor,
  });

  const page = await context.newPage();

  // Transparent background at compositor level
  const cssOverride = `
:root, html, body,
:root::before, :root::after,
html::before, html::after,
body::before, body::after {
  background: transparent !important;
  background-color: transparent !important;
  background-image: none !important;
  box-shadow: none !important;
}
` + extraCss ? `${extraCss} {
  background: transparent !important;
  background-color: transparent !important;
  background-image: none !important;
  box-shadow: none !important;
}
` : '';

  if (transparent) {
    console.log('Forcing transparent background...')
    await page.addInitScript(() => {
      document.documentElement.setAttribute("data-browser-force", "1");
    });

    await page.addInitScript((css) => {
      const style = document.createElement("style");
      style.textContent = css;
      style.setAttribute("data-browser-style", "1");
      document.documentElement.prepend(style);
    }, cssOverride);
  }

  console.log('Navigating to', url, '...')
  await page.goto(url, { waitUntil: "networkidle" }); // was "load"

  if (transparent) {
    // Re-inject after load for SPAs
    await page.evaluate((css) => {
      document.documentElement.setAttribute("data-browser-force", "1");
      if (!document.querySelector("style[data-browser-style]")) {
        const s = document.createElement("style");
        s.textContent = css;
        s.setAttribute("data-browser-style", "1");
        document.documentElement.prepend(s);
      }
    }, cssOverride);
  }

  // await page.waitForLoadState("networkidle");

  if (waitSeconds > 0) {
    console.log(`Waiting ${waitSeconds} seconds...`);
    await page.waitForTimeout(waitSeconds * 1000);
  }

  // Playwright can output PNG or WebP directly, but WebP is lossless unless you use sharp.
  console.log('Capturing screenshot...')
  const pngBuffer = await page.screenshot({
    type: "png",
    omitBackground: transparent,
    scale: zoomFactor > 1 ? "device" : "css",
  });

  console.log('Saving image...')
  let outBuffer: sharp.Sharp | undefined = undefined;
  if (ext === ".png") {
    if (lossyQuality !== undefined) {
      outBuffer = await sharp(pngBuffer).png({ quality: lossyQuality, compressionLevel: 8, adaptiveFiltering: true });
    } else {
      outBuffer = sharp(pngBuffer).png({ compressionLevel: 8, adaptiveFiltering: false });
    }
  } else if (ext === ".webp") {
    // convert to webp via sharp
    outBuffer = await sharp(pngBuffer).webp({ quality: lossyQuality || 80 });
  } else {
    // should never happen due to earlier check
    throw new Error("Unsupported output format: " + ext);
  }

  if (outBuffer) {
    await outBuffer.toFile(outPath);
    const stats = fs.statSync(outPath);
    console.log(`Wrote ${outPath} (${stats.size} bytes)`);
  }

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(99);
});

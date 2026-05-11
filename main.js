#!/usr/bin/env node
// @ts-check

/**
 * Uses Playwright to capture a screenshot of a webpage with options for
 * transparent background, viewport size, zoom, and lossy compression.
 * The output can be PNG or WebP.
 *
 * Run with: npx @coldino/browser-snapper [options] <url> <output>
 */

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright";
import sharp from "sharp";

/**
 * @typedef {{
 *   transparent?: boolean;
 *   visible?: boolean;
 *   size?: string;
 *   "lossy-quality"?: string;
 *   wait?: string;
 *   zoom?: string;
 *   css?: string;
 *   help?: boolean;
 * }} ParsedValues
 */

/**
 * @param {number} [code]
 * @returns {never}
 */
function showUsageAndExit(code = 0) {
    console.log(`
Usage: browser-snapper [options] <url> <output>

Options:
  -t, --transparent         Make background transparent
  -s, --size WIDTHxHEIGHT   Viewport size, e.g. 1280x800
  -v, --visible             Capture with headless mode off to interact with the page (use --wait to delay capture)
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

/**
 * @param {string | undefined} extraCss
 * @returns {string}
 */
function buildCssOverride(extraCss) {
    const baseCss = `
:root, html, body,
:root::before, :root::after,
html::before, html::after,
body::before, body::after {
  background: transparent !important;
  background-color: transparent !important;
  background-image: none !important;
  box-shadow: none !important;
}
`;

    if (!extraCss) {
        return baseCss;
    }

    return `${baseCss}
${extraCss} {
  background: transparent !important;
  background-color: transparent !important;
  background-image: none !important;
  box-shadow: none !important;
}
`;
}

/**
 * @param {Buffer} pngBuffer
 * @param {".png" | ".webp"} ext
 * @param {number | undefined} lossyQuality
 * @returns {Promise<Buffer<ArrayBufferLike>>}
 */
function encodeOutputBuffer(pngBuffer, ext, lossyQuality) {
    if (ext === ".png") {
        if (lossyQuality !== undefined) {
            return sharp(pngBuffer)
                .png({ quality: lossyQuality, compressionLevel: 8, adaptiveFiltering: true })
                .toBuffer();
        }

        return sharp(pngBuffer)
            .png({ compressionLevel: 8, adaptiveFiltering: false })
            .toBuffer();
    }

    return sharp(pngBuffer).webp({ quality: lossyQuality ?? 80 }).toBuffer();
}

/**
 * @returns {Promise<void>}
 */
async function main() {
    const { values, positionals } = parseArgs({
        options: {
            transparent: { type: "boolean", short: "t" },
            visible: { type: "boolean", short: "v" },
            size: { type: "string", short: "s" },
            "lossy-quality": { type: "string", short: "l" },
            wait: { type: "string", short: "w" },
            zoom: { type: "string", short: "z" },
            css: { type: "string", short: "c" },
            help: { type: "boolean", short: "h" },
        },
        allowPositionals: true,
    });

    /** @type {ParsedValues} */
    const parsedValues = values;

    if (parsedValues.help) {
        showUsageAndExit(0);
    }

    if (positionals.length < 2) {
        showUsageAndExit(2);
    }

    const [url, outPath] = positionals;
    if (!url || !outPath) {
        showUsageAndExit(2);
    }

    const transparent = !!parsedValues.transparent;
    const visible = !!parsedValues.visible;
    const extraCss = parsedValues.css ? String(parsedValues.css) : undefined;
    const sizeArg = parsedValues.size;

    let waitSeconds = 0;
    if (parsedValues.wait) {
        waitSeconds = Number.parseFloat(String(parsedValues.wait));
        if (Number.isNaN(waitSeconds) || waitSeconds < 0) {
            console.error("Invalid wait time. Must be a non-negative number.");
            process.exit(2);
        }
    }

    let zoomFactor = 1;
    if (parsedValues.zoom) {
        zoomFactor = Number.parseFloat(String(parsedValues.zoom));
        if (Number.isNaN(zoomFactor) || zoomFactor <= 0) {
            console.error("Invalid zoom factor. Must be a positive number.");
            process.exit(2);
        }
    }

    /** @type {number | undefined} */
    let lossyQuality;
    if (parsedValues["lossy-quality"] !== undefined) {
        lossyQuality = Number.parseInt(String(parsedValues["lossy-quality"]), 10);
        if (Number.isNaN(lossyQuality) || lossyQuality < 0 || lossyQuality > 100) {
            console.error("Invalid lossy quality. Must be an integer between 0 and 100.");
            process.exit(2);
        }
    }

    let width = 1280;
    let height = 800;
    if (sizeArg) {
        const match = /^(\d+)x(\d+)$/.exec(String(sizeArg));
        if (!match) {
            console.error("Invalid size. Use WIDTHxHEIGHT, e.g. 1280x800");
            process.exit(2);
        }

        width = Number.parseInt(match[1], 10);
        height = Number.parseInt(match[2], 10);
    }

    const ext = path.extname(outPath).toLowerCase();
    if (ext !== ".png" && ext !== ".webp") {
        console.error("Output must be .png or .webp");
        process.exit(2);
    }

    const exe = chromium.executablePath();
    if (!fs.existsSync(exe)) {
        console.log("Playwright Chromium is NOT installed and will be downloaded now. This may take a moment...");
    }

    console.log("Launching browser...");
    const browser = await chromium.launch({
        headless: !visible,
        args: ["--disable-gpu"],
    });

    console.log("Opening page with viewport", width, "x", height, "...");
    const context = await browser.newContext({
        viewport: { width, height },
        deviceScaleFactor: zoomFactor,
    });

    const page = await context.newPage();
    const cssOverride = buildCssOverride(extraCss);

    if (transparent) {
        console.log("Forcing transparent background...");
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

    console.log("Navigating to", url, "...");
    await page.goto(url, { waitUntil: "networkidle" });

    if (transparent) {
        await page.evaluate((css) => {
            document.documentElement.setAttribute("data-browser-force", "1");
            if (!document.querySelector("style[data-browser-style]")) {
                const style = document.createElement("style");
                style.textContent = css;
                style.setAttribute("data-browser-style", "1");
                document.documentElement.prepend(style);
            }
        }, cssOverride);
    }

    if (waitSeconds > 0) {
        console.log(`Waiting ${waitSeconds} seconds...`);
        await page.waitForTimeout(waitSeconds * 1000);
    }

    console.log("Capturing screenshot...");
    const pngBuffer = await page.screenshot({
        type: "png",
        omitBackground: transparent,
        scale: zoomFactor > 1 ? "device" : "css",
    });

    console.log("Saving image...");
    const outBuffer = await encodeOutputBuffer(pngBuffer, ext, lossyQuality);
    await fs.promises.writeFile(outPath, outBuffer);

    const stats = fs.statSync(outPath);
    console.log(`Wrote ${outPath} (${stats.size} bytes)`);

    await browser.close();
}

main().catch((err) => {
    console.error(err);
    process.exit(99);
});

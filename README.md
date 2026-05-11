# browser-snapper

A command-line tool for taking transparent screenshots of web pages using Playwright. It supports both lossless PNG and lossy WebP formats, as well as custom viewport sizes, zoom levels, and CSS-based background removal.

## Direct Run

```bash
npx @coldino/browser-snapper [options] <url> <output-path>
pnpx @coldino/browser-snapper [options] <url> <output-path>
```

## Installation

```bash
npm install -g @coldino/browser-snapper
```

## Usage

```bash
Usage: browser-snapper [options] <url> <output>

Options:
  -t, --transparent         Make background transparent
  -v, --visible             Capture with headless mode off to interact with the page (use --wait to delay capture)
  -s, --size WIDTHxHEIGHT   Viewport size, e.g. 1280x800
  -l, --lossy-quality N     Quality for lossy compression (0-100) [lossless by default]
  -w, --wait N              Wait N seconds after load event before screenshotting
  -z, --zoom N              Page zoom factor (e.g. 2 for 200%)
  -c, --css CSS             Remove background from the specified CSS selector(s) (e.g. ".main" or "main,#screen")
  -h, --help                Show this help
```

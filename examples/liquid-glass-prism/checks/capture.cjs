// Render WebGL previews of the Liquid Glass Prism study with headless Chromium (Playwright).
//
//   node checks/capture.cjs <port> <jobs.json> <output-dir>
//
// Serve the study folder first, e.g. `python3 -m http.server <port>` from it.
// jobs.json: [{ "name": "file-stem", "draw": { preset, overrides, mesh, time, ... } }]
// Each job writes <name>.png and <name>.png.json (draw options + renderer info).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const [port, jobsFile, outDir] = process.argv.slice(2);
  const jobs = JSON.parse(fs.readFileSync(jobsFile, 'utf8'));
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${port}/checks/preview/index.html?harness=1`);
  await page.evaluate(() => window.previewReady);
  const renderer = await page.evaluate(() => {
    const gl = document.getElementById('view').getContext('webgl2');
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    return { renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
             floatTargets: window.preview.floatTargets, size: window.preview.size };
  });
  for (const job of jobs) {
    await page.evaluate((d) => window.preview.draw(d), job.draw);
    const file = path.join(outDir, job.name + '.png');
    await page.locator('#view').screenshot({ path: file });
    fs.writeFileSync(file + '.json', JSON.stringify({
      kind: 'WebGL2 preview of the delivered GLSL (not a TouchDesigner capture)',
      draw: job.draw, ...renderer, date: new Date().toISOString() }, null, 2) + '\n');
    console.log('wrote', file);
  }
  await browser.close();
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
})();

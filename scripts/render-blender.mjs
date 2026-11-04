// Renders the AIGROW specimen with Blender (Cycles) and writes the social-card images.
//
//   npm run render:blender [-- key=value ...]
//
//   BLENDER_PATH   Blender executable (default: Blender 5.2 under Program Files)
//   KEEP_PNG=1     keep the full-resolution render (its folder is printed) instead of deleting it
//   key=value      passed on to scripts/blender/render_specimen.py (az=30, sun_el=38, gpu=0 ...)
//
// Needs scripts/out/layers.json (npm run specimen). Writes src/app/{opengraph,twitter}-image.jpg + .alt.txt.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const blender = process.env.BLENDER_PATH || 'C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe'
const script = path.join(root, 'scripts', 'blender', 'render_specimen.py')
const extra = process.argv.slice(2).filter((a) => a.includes('='))

// A laptop GPU held down by the OEM power plan (here 5 W of 50 W, 300 MHz) renders slower than the CPU alone
// and drags a GPU+CPU render down with it: leave it out unless gpu=1 is passed.
const smi = spawnSync('nvidia-smi', ['--query-gpu=enforced.power.limit,power.default_limit', '--format=csv,noheader,nounits'], { encoding: 'utf8' })
const [limit, base] = (smi.stdout ?? '').trim().split(',').map(Number)
if (limit > 0 && base > 0 && limit < base / 2 && !extra.some((a) => a.startsWith('gpu='))) {
  console.log(`GPU is power-capped to ${limit} W of ${base} W: rendering on the CPU (pass gpu=1 to force the GPU)`)
  extra.push('gpu=0')
}

const SUPERSAMPLE = 2 // render at 2x and downscale: cleaner thin edges than the denoiser alone
const ALT =
  'A laser-cut stack of twelve white card terraces rising to the black AIGROW wordmark on a grey board, with a dashed blue line marking the next planned layer.'
const outputs = [{ files: ['opengraph-image', 'twitter-image'], width: 1200, height: 630, samples: 64 }]

for (const p of [blender, script, path.join(root, 'scripts', 'out', 'layers.json')]) {
  if (!fs.existsSync(p)) {
    console.error(`missing ${p}${p === blender ? ' (set BLENDER_PATH)' : p.endsWith('layers.json') ? ' (run npm run specimen)' : ''}`)
    process.exit(1)
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aigrow-render-'))
for (const o of outputs) {
  const png = path.join(tmp, `${o.files[0]}.png`)
  const started = Date.now()
  const run = spawnSync(
    blender,
    ['-b', '--factory-startup', '--python', script, '--', png, String(o.width * SUPERSAMPLE), String(o.height * SUPERSAMPLE), String(o.samples), ...extra],
    { stdio: 'inherit' },
  )
  if (run.status !== 0 || !fs.existsSync(png)) {
    console.error(`Blender failed (exit ${run.status}) for ${o.files[0]}`)
    process.exit(1)
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(0)
  const jpg = await sharp(png)
    .resize(o.width, o.height, { kernel: 'lanczos3' })
    .jpeg({ quality: 92, mozjpeg: true, chromaSubsampling: '4:4:4' }) // q92 keeps the thin charred wall lines clean (~115 KB)
    .toBuffer()
  for (const name of o.files) {
    fs.writeFileSync(path.join(root, 'src', 'app', `${name}.jpg`), jpg)
    fs.writeFileSync(path.join(root, 'src', 'app', `${name}.alt.txt`), ALT)
    console.log(`${name}.jpg  ${o.width}x${o.height}  ${(jpg.length / 1024).toFixed(0)} KB  (render ${seconds}s)`)
  }
}
if (process.env.KEEP_PNG) console.log(`full-resolution render kept in ${tmp}`)
else fs.rmSync(tmp, { recursive: true, force: true })

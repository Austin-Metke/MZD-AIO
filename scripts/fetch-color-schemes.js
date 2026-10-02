'use strict'
/**
 * Puts the color scheme pack used by the "Custom Infotainment Colors" tweak
 * into color-schemes/, which electron-builder ships next to the app
 * (extraResources), so the app never downloads it at runtime.
 *
 * Runs on npm install and skips when the pack is already in place.
 * Set COLOR_SCHEMES_ZIP=/path/to/color-schemes.zip to use a local copy
 * instead of downloading. Either way the checksum must match.
 */
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { extract } = require('../app/lib/fs-utils')

// Upstream "Color Schemes" release asset (2017)
const URL = 'https://github.com/Trevelopment/MZD-AIO/releases/download/colors/color-schemes.zip'
const SHA256 = '379d386908a165d70c0185f3b294ec47a823c80174f5cbfbff30e6f5057f7b49'

const dest = path.join(__dirname, '..', 'color-schemes')
const marker = path.join(dest, '.sha256')

async function readPack () {
  if (process.env.COLOR_SCHEMES_ZIP) {
    console.log(`color-schemes: using ${process.env.COLOR_SCHEMES_ZIP}`)
    return fs.readFileSync(process.env.COLOR_SCHEMES_ZIP)
  }
  console.log(`color-schemes: downloading ${URL}`)
  const res = await fetch(URL)
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

async function main () {
  if (fs.existsSync(marker) && fs.readFileSync(marker, 'utf8').trim() === SHA256) {
    console.log('color-schemes: already in place')
    return
  }
  const data = await readPack()
  const hash = crypto.createHash('sha256').update(data).digest('hex')
  if (hash !== SHA256) throw new Error(`checksum mismatch: expected ${SHA256}, got ${hash}`)

  const zip = path.join(os.tmpdir(), `color-schemes-${process.pid}.zip`)
  fs.writeFileSync(zip, data)
  try {
    fs.rmSync(dest, { recursive: true, force: true })
    await new Promise((resolve, reject) => extract(zip, { dir: dest }, (err) => err ? reject(err) : resolve()))
  } finally {
    fs.rmSync(zip, { force: true })
  }
  fs.writeFileSync(marker, SHA256 + '\n')
  console.log(`color-schemes: ready in ${dest}`)
}

main().catch((err) => {
  console.error(`color-schemes: ${err.message}`)
  process.exit(1)
})

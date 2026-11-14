// Renders build/icon.svg into the icons the app and its installers use:
//   build/icon.png (1024), build/icon.ico (Windows), build/icon.icns (macOS), resources/icon.png (512).
// Run with `bun run icons` (it runs under Electron, which draws the SVG; no other tools needed).
const { app, BrowserWindow, nativeImage } = require('electron')
const { readFileSync, writeFileSync } = require('fs')
const { join } = require('path')

const root = join(__dirname, '..')
const SIZE = 1024

/** A .ico file holding PNG images (Windows Vista and later read these). */
function ico(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  let offset = 6 + 16 * images.length
  const entries = images.map(({ size, png }) => {
    const entry = Buffer.alloc(16)
    entry.writeUInt8(size >= 256 ? 0 : size, 0)
    entry.writeUInt8(size >= 256 ? 0 : size, 1)
    entry.writeUInt16LE(1, 4)
    entry.writeUInt16LE(32, 6)
    entry.writeUInt32LE(png.length, 8)
    entry.writeUInt32LE(offset, 12)
    offset += png.length
    return entry
  })
  return Buffer.concat([header, ...entries, ...images.map((image) => image.png)])
}

/** A .icns file holding PNG images under the types macOS expects for each size. */
function icns(images) {
  const types = {
    16: 'icp4',
    32: 'icp5',
    64: 'icp6',
    128: 'ic07',
    256: 'ic08',
    512: 'ic09',
    1024: 'ic10'
  }
  const chunks = images.map(({ size, png }) => {
    const head = Buffer.alloc(8)
    head.write(types[size], 0, 'ascii')
    head.writeUInt32BE(png.length + 8, 4)
    return Buffer.concat([head, png])
  })
  const body = Buffer.concat(chunks)
  const head = Buffer.alloc(8)
  head.write('icns', 0, 'ascii')
  head.writeUInt32BE(body.length + 8, 4)
  return Buffer.concat([head, body])
}

app.whenReady().then(async () => {
  // The page draws the SVG onto a canvas of the full size, so the result doesn't depend on the
  // window's size or the screen's scale.
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
  await window.loadURL('about:blank')
  const svg = readFileSync(join(root, 'build', 'icon.svg'), 'utf8')
  const source = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
  const dataUrl = await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = ${SIZE}
      canvas.getContext('2d').drawImage(image, 0, 0, ${SIZE}, ${SIZE})
      resolve(canvas.toDataURL('image/png'))
    }
    image.onerror = () => reject(new Error('the SVG did not load'))
    image.src = ${JSON.stringify(source)}
  })`)
  const full = nativeImage.createFromDataURL(dataUrl)
  const at = (size) => ({
    size,
    png: full.resize({ width: size, height: size, quality: 'best' }).toPNG()
  })

  writeFileSync(join(root, 'build', 'icon.png'), full.toPNG())
  writeFileSync(join(root, 'resources', 'icon.png'), at(512).png)
  writeFileSync(join(root, 'build', 'icon.ico'), ico([16, 24, 32, 48, 64, 128, 256].map(at)))
  writeFileSync(join(root, 'build', 'icon.icns'), icns([16, 32, 64, 128, 256, 512, 1024].map(at)))
  console.log('icons written')
  app.quit()
})

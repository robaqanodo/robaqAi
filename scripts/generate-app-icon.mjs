import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'

// Original procedural R.AI orb icon: opaque, square, 1024px; iOS applies the mask.
const size = 1024
const raw = Buffer.alloc((size * 3 + 1) * size)
for (let y = 0; y < size; y++) {
  const row = y * (size * 3 + 1)
  for (let x = 0; x < size; x++) {
    const dx = (x - 512) / 330, dy = (y - 512) / 330
    const distance = Math.hypot(dx, dy)
    const glow = 24 * Math.exp(-Math.pow(distance / 1.16, 6))
    let value = 6 + glow
    if (distance < 1) {
      value = 185 + 44 * (1 - distance) - 25 * dy - 17 * dx
      if (Math.hypot(dx + 0.03, dy + 0.03) < 0.66) value += 15
      if (Math.hypot(dx - 0.02, dy + 0.06) < 0.31) value = 250
    }
    const index = row + 1 + x * 3
    raw[index] = Math.min(255, value)
    raw[index + 1] = Math.min(255, value)
    raw[index + 2] = Math.min(255, value + 5)
  }
}
function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const tag = Buffer.from(type)
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([tag, data])))
  return Buffer.concat([length, tag, data, crc])
}
const header = Buffer.alloc(13)
header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4)
header[8] = 8; header[9] = 2
writeFileSync('ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png', Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
  chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
]))

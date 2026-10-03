import { encode } from 'uqr'

export function QrMark({ value, label }: { value: string; label: string }) {
  const qr = encode(value, { ecc: 'M', border: 2 })
  const cells: { x: number; y: number }[] = []
  for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++) if (qr.data[y][x]) cells.push({ x, y })
  return <svg className="qr-mark" viewBox={`0 0 ${qr.size} ${qr.size}`} role="img" aria-label={label} shapeRendering="crispEdges">
    <rect width={qr.size} height={qr.size} fill="#ffffff" />
    {cells.map(cell => <rect key={`${cell.x}-${cell.y}`} x={cell.x} y={cell.y} width={1} height={1} fill="#141418" />)}
  </svg>
}

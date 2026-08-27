/**
 * Code 128 encoder (§8).
 *
 * Written rather than pulled in: the encoding is about eighty lines, and an
 * artifact-free SVG we control beats a dependency whose rendering we would
 * have to verify against a real scanner anyway.
 *
 * Code 128 Subset B covers ASCII 32-126, which is every character a SKU in
 * the PREFIX-NNNN convention can contain. Subsets A and C are not implemented
 * — C would compress digit pairs and shorten the symbol, but the added
 * complexity is not worth it at SKU length.
 */

/**
 * Bar/space widths for values 0-106. Index is the code value.
 *
 * Structurally invariant, and checked by scripts/verify-barcode.mjs: values
 * 0-105 are six modules summing to 11; STOP (106) is seven summing to 13.
 * A transcription slip here does not throw — it prints a label that scans as
 * a different SKU, which is the worst failure this system could ship.
 */
const PATTERNS: readonly string[] = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312',
  '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222',
  '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131',
  '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321',
  '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121',
  '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321',
  '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224',
  '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114',
  '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112',
  '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113',
  '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412',
  '211214', '211232', '2331112',
]

const START_B = 104
const STOP = 106

export class Code128Error extends Error {}

/**
 * Returns bar widths as a flat array, alternating bar and space, starting
 * with a bar. Each number is a multiple of the narrow-module width.
 */
export function encodeCode128B(value: string): number[] {
  if (value.length === 0) {
    throw new Code128Error('Cannot encode an empty value')
  }

  const codes: number[] = [START_B]

  for (const char of value) {
    const point = char.codePointAt(0)!
    if (point < 32 || point > 126) {
      throw new Code128Error(
        `Character "${char}" cannot be encoded in Code 128 subset B (ASCII 32-126 only)`,
      )
    }
    codes.push(point - 32)
  }

  // Checksum: start value plus each symbol weighted by position, mod 103.
  // A scanner recomputes this and rejects the read if it disagrees, which is
  // what makes a smudged label fail loudly rather than scan as a wrong SKU.
  let checksum = START_B
  for (let i = 1; i < codes.length; i++) {
    checksum += codes[i] * i
  }
  codes.push(checksum % 103)
  codes.push(STOP)

  const widths: number[] = []
  for (const code of codes) {
    for (const digit of PATTERNS[code]) {
      widths.push(Number(digit))
    }
  }

  return widths
}

export interface BarcodeSvgOptions {
  /** Width of one narrow module, in user units. */
  moduleWidth?: number
  height?: number
  /** Print the encoded text beneath the symbol. */
  showText?: boolean
}

/**
 * Renders the symbol as a self-contained SVG string.
 *
 * The quiet zone is not decoration: Code 128 requires at least 10 modules of
 * blank space either side, and a label printed without it reads intermittently
 * in a way that looks like a broken scanner rather than a broken label.
 */
export function code128Svg(value: string, options: BarcodeSvgOptions = {}): string {
  const moduleWidth = options.moduleWidth ?? 2
  const height = options.height ?? 60
  const showText = options.showText ?? true

  const widths = encodeCode128B(value)
  const quietZone = 10 * moduleWidth
  const symbolWidth = widths.reduce((sum, w) => sum + w, 0) * moduleWidth
  const totalWidth = symbolWidth + quietZone * 2
  const textHeight = showText ? 14 : 0
  const totalHeight = height + textHeight

  const bars: string[] = []
  let x = quietZone
  let isBar = true

  for (const width of widths) {
    const w = width * moduleWidth
    if (isBar) {
      bars.push(`<rect x="${x.toFixed(2)}" y="0" width="${w.toFixed(2)}" height="${height}"/>`)
    }
    x += w
    isBar = !isBar
  }

  const text = showText
    ? `<text x="${(totalWidth / 2).toFixed(2)}" y="${totalHeight - 2}" font-family="monospace" font-size="12" text-anchor="middle" fill="#000">${escapeXml(value)}</text>`
    : ''

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth.toFixed(2)}" height="${totalHeight}" viewBox="0 0 ${totalWidth.toFixed(2)} ${totalHeight}" shape-rendering="crispEdges">`,
    // White ground, always. A transparent barcode on a dark background is
    // unreadable — scanners detect contrast, not shape.
    `<rect width="100%" height="100%" fill="#fff"/>`,
    `<g fill="#000">${bars.join('')}</g>`,
    text,
    `</svg>`,
  ].join('')
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

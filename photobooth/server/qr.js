import QRCode from 'qrcode';

// Error correction "M" survives a smudged print or a slightly off-focus phone camera; "H" would make the code denser.
const LEVEL = 'M';

/** SVG text, for showing the code on the kiosk screen (always crisp at any size). */
export function qrSvg(url, { margin = 2, dark = '#000000', light = '#ffffff' } = {}) {
  return QRCode.toString(url, { type: 'svg', margin, errorCorrectionLevel: LEVEL, color: { dark, light } });
}

/** PNG bytes at exactly `size` x `size` pixels (module count is rounded to whole pixels), for printing on a layout. */
export function qrPng(url, { size = 300, margin = 2 } = {}) {
  return QRCode.toBuffer(url, { type: 'png', width: size, margin, errorCorrectionLevel: LEVEL, color: { dark: '#000000', light: '#ffffff' } });
}

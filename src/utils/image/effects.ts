import { processImage } from './native.js';

function imgType(buf: Buffer): string {
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'gif';
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46) return 'webp';
  return 'png';
}

// Simple pass-through effects (no extra options)
export const blur       = (buf: Buffer) => processImage('blur',      {},                 buf, imgType(buf));
export const sharpen    = (buf: Buffer) => processImage('blur',      { sharp: true },    buf, imgType(buf));
export const invert     = (buf: Buffer) => processImage('invert',    {},                 buf, imgType(buf));
export const deepfry    = (buf: Buffer) => processImage('deepfry',   {},                 buf, imgType(buf));
export const swirl      = (buf: Buffer) => processImage('swirl',     {},                 buf, imgType(buf));
export const wall       = (buf: Buffer) => processImage('wall',      {},                 buf, imgType(buf));
export const circle     = (buf: Buffer) => processImage('circle',    {},                 buf, imgType(buf));
export const crop       = (buf: Buffer) => processImage('crop',      {},                 buf, imgType(buf));
export const tile       = (buf: Buffer) => processImage('tile',      {},                 buf, imgType(buf));
export const bounce     = (buf: Buffer) => processImage('bounce',    {},                 buf, imgType(buf));
export const reverse    = (buf: Buffer) => processImage('reverse',   {},                 buf, imgType(buf));
export const soos       = (buf: Buffer) => processImage('reverse',   { soos: true },     buf, imgType(buf));
export const makeGif    = (buf: Buffer) => processImage('togif',     {},                 buf, imgType(buf));
export const uncaption  = (buf: Buffer, tolerance = 0.95) => processImage('uncaption', { tolerance }, buf, imgType(buf));
export const gamexplain = (buf: Buffer) => processImage('gamexplain',{},                 buf, imgType(buf));
export const scott      = (buf: Buffer) => processImage('scott',     {},                 buf, imgType(buf));
export const globe      = (buf: Buffer) => processImage('globe',     {},                 buf, imgType(buf));
export const squish     = (buf: Buffer) => processImage('squish',    {},                 buf, imgType(buf));

// Effects with options
export const grayscale = (buf: Buffer) => processImage('colors', { color: 'grayscale' },              buf, imgType(buf));
export const sepia     = (buf: Buffer) => processImage('colors', { color: 'sepia' },                  buf, imgType(buf));
export const hue       = (buf: Buffer, shift = 180) => processImage('colors', { color: 'hueshift', shift }, buf, imgType(buf));
export const flip      = (buf: Buffer) => processImage('flip',   { flop: false },                     buf, imgType(buf));
export const flop      = (buf: Buffer) => processImage('flip',   { flop: true },                      buf, imgType(buf));
export const wide      = (buf: Buffer) => processImage('resize', { stretch: false, wide: true,  amount: 0 }, buf, imgType(buf));
export const stretch   = (buf: Buffer) => processImage('resize', { stretch: true,  wide: false, amount: 0 }, buf, imgType(buf));
export const pixelate  = (buf: Buffer, amount = 16) => processImage('resize', { stretch: false, wide: false, amount }, buf, imgType(buf));
export const jpeg      = (buf: Buffer, quality = 1) => processImage('jpeg',   { quality },             buf, imgType(buf));
export const magik     = (buf: Buffer) => processImage('magik',  {},                                   buf, imgType(buf));
export const rotate    = (buf: Buffer, angle = 90) => processImage('spin', { angle },                  buf, imgType(buf));

// Animated speed/freeze effects
export const speed   = (buf: Buffer) => processImage('speed',  { slow: false  }, buf, imgType(buf));
export const slow    = (buf: Buffer) => processImage('speed',  { slow: true   }, buf, imgType(buf));
export const freeze  = (buf: Buffer) => processImage('freeze', { loop: false  }, buf, imgType(buf));
export const unfreeze = (buf: Buffer) => processImage('freeze', { loop: true  }, buf, imgType(buf));

// Animated slide/spin effects
export const spin  = (buf: Buffer) => processImage('spin',  {},                           buf, imgType(buf));
export const slide = (buf: Buffer) => processImage('slide', {},                           buf, imgType(buf));
export const fade  = (buf: Buffer) => processImage('fade',  {},                           buf, imgType(buf));

// Mirror variants
export const haah = (buf: Buffer) => processImage('mirror', { vertical: false, first: true  }, buf, imgType(buf));
export const hooh = (buf: Buffer) => processImage('mirror', { vertical: false, first: false }, buf, imgType(buf));
export const waaw = (buf: Buffer) => processImage('mirror', { vertical: true,  first: false }, buf, imgType(buf));
export const woow = (buf: Buffer) => processImage('mirror', { vertical: true,  first: true  }, buf, imgType(buf));

// Distort displacement effects (uses asset maps in assets/images/)
export const explode = (buf: Buffer) => processImage('distort', { mapName: 'linearexplode' }, buf, imgType(buf));
export const implode = (buf: Buffer) => processImage('distort', { mapName: 'linearimplode' }, buf, imgType(buf));

// Flag overlay
export const flag = (buf: Buffer, overlay: string) => processImage('flag', { overlay }, buf, imgType(buf));

// Generic watermark — `water` is relative to basePath, e.g. 'assets/images/9gag.png'
export const watermark = (buf: Buffer, water: string, gravity = 6) =>
  processImage('watermark', { water, gravity }, buf, imgType(buf));

// Speechbubble: watermark with speechbubble.png overlaid (flipY so it hangs from top)
export const speechbubble = (buf: Buffer) =>
  processImage('watermark', { water: 'assets/images/speechbubble.png', gravity: 2, resize: true, yscale: 0.2 }, buf, imgType(buf));

// Vignette overlay
export const vignette = (buf: Buffer) =>
  processImage('watermark', { water: 'assets/images/vignette.png', gravity: 0, alpha: true }, buf, imgType(buf));

// Text-only generative (no input image)
export const sonic    = (text: string) => processImage('sonic',    { text });
export const homebrew = (caption: string) => processImage('homebrew', { caption });

// QR code (requires WITH_ZXING=ON at build time)
export const qrCreate = (text: string) => processImage('qrCreate', { text });
export const qrRead   = (buf: Buffer)  => processImage('qrread',   {},        buf, imgType(buf));

// Text + image
export const spotify  = (buf: Buffer, caption: string) => processImage('spotify',   { caption }, buf, imgType(buf));
export const reddit   = (buf: Buffer, caption: string) => processImage('reddit',    { caption }, buf, imgType(buf));
export const whisper  = (buf: Buffer, caption: string) => processImage('whisper',   { caption }, buf, imgType(buf));
export const snapchat = (buf: Buffer, caption: string, pos?: number) =>
  processImage('snapchat',   { caption, ...(pos !== undefined ? { pos } : {}) }, buf, imgType(buf));
export const caption  = (buf: Buffer, text: string, font?: string) =>
  processImage('caption',    { caption: text, ...(font ? { font } : {}) }, buf, imgType(buf));
export const caption2 = (buf: Buffer, text: string, top = false, font?: string) =>
  processImage('captionTwo', { caption: text, top, ...(font ? { font } : {}) }, buf, imgType(buf));
export const meme     = (buf: Buffer, topText: string, bottomText: string, font?: string) =>
  processImage('meme',       { topText, bottomText, ...(font ? { font } : {}) }, buf, imgType(buf));
export const motivate = (buf: Buffer, topText: string, bottomText: string, font?: string) =>
  processImage('motivate',   { topText, bottomText, ...(font ? { font } : {}) }, buf, imgType(buf));
export const uncanny  = (buf: Buffer, cap1: string, cap2: string, imgPath: string, font?: string) =>
  processImage('uncanny',    { caption: cap1, caption2: cap2, path: imgPath, ...(font ? { font } : {}) }, buf, imgType(buf));

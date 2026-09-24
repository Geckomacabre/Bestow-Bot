import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const _require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// basePath is the project root — C++ appends "assets/fonts/" and "assets/images/" to it
export const ASSETS_DIR = path.resolve(__dirname, '../../..') + path.sep;

let addon: any = null;

function getAddon() {
  if (!addon) {
    try {
      addon = _require(path.resolve(__dirname, '../../../build/Release/esmbmedia.node'));
      addon.init();
    } catch {
      throw new Error(
        'Native image addon not built. Run: bun run build:native\n' +
        'Requires: libvips, fontconfig, cmake-js\n' +
        '  Ubuntu/Debian: apt install libvips-dev libfontconfig1-dev\n' +
        '  Then: bun add -D cmake-js && bun run build:native'
      );
    }
  }
  return addon;
}

export interface NativeResult {
  data: Buffer;
  type: string;
}

export async function processImage(
  command: string,
  options: Record<string, unknown>,
  buffer?: Buffer,
  inputType = 'png'
): Promise<NativeResult> {
  const a = getAddon();
  const input: Record<string, unknown> = { type: inputType };
  if (buffer) input.data = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const result = await a.process('image', command, { ...options, basePath: ASSETS_DIR }, input);
  return { data: Buffer.from(result.data as ArrayBuffer), type: result.type as string };
}

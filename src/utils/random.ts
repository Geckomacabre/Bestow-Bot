const buf = new Uint32Array(1);

/** Returns a float in [0, 1) using cryptographic randomness */
export function rand(): number {
  crypto.getRandomValues(buf);
  return buf[0] / 0x1_0000_0000;
}

/** Returns a random integer in [min, max] inclusive */
export function randInt(min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}

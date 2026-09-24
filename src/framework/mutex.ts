/**
 * Keyed async mutex. Bun's SQLite driver does not isolate transactions from other
 * queries on the same connection, so any read-then-write flow (a game round, a
 * business purchase, a trade) must serialise on the user it touches.
 */
const tails = new Map<string, Promise<unknown>>();

export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = tails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>(res => { release = res; });
  const tail = prev.then(() => gate);
  tails.set(key, tail);
  try {
    await prev.catch(() => {});
    return await fn();
  } finally {
    release();
    if (tails.get(key) === tail) tails.delete(key);
  }
}

/** Lock several keys in a stable order to avoid deadlocks (e.g. both sides of a trade). */
export async function withLocks<T>(keys: string[], fn: () => Promise<T>): Promise<T> {
  const sorted = [...new Set(keys)].sort();
  const run = (i: number): Promise<T> => (i >= sorted.length ? fn() : withLock(sorted[i]!, () => run(i + 1)));
  return run(0);
}

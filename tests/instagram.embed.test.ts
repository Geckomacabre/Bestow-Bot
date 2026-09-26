import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { initDb } from '../src/utils/db';
import { DEFAULT_EMBED_HOST, embedLink, embedMode, instagramRef, instagramShortcode } from '../src/lookups/instaloader';
import { fakeInteraction, textOf } from './fakeInteraction';

const commands = (await import('../src/handlers/commandHandler')).default;
beforeAll(async () => { await initDb(); });

const KEYS = ['INSTAGRAM_REPOST', 'INSTAGRAM_EMBED_HOST'] as const;
const saved = Object.fromEntries(KEYS.map(k => [k, Bun.env[k]]));
afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete Bun.env[k]; else Bun.env[k] = saved[k]; } });
const set = (k: (typeof KEYS)[number], v: string | undefined) => { if (v === undefined) delete Bun.env[k]; else Bun.env[k] = v; };

describe('the embed link', () => {
  test('is the post\'s own kind and shortcode on the embed service', () => {
    expect(embedLink({ kind: 'reel', code: 'Ddt8lJ0BcD9' })).toBe('https://www.d.oginstagram.com/reel/Ddt8lJ0BcD9');
    expect(embedLink({ kind: 'p', code: 'DW1nTDiDvnF' })).toBe('https://www.d.oginstagram.com/p/DW1nTDiDvnF');
    expect(DEFAULT_EMBED_HOST).toBe('www.d.oginstagram.com');
  });

  test('links are read into their kind: reels and reel are one, and a username in the path is ignored', () => {
    expect(instagramRef('https://www.instagram.com/reel/Ddt8lJ0BcD9/?igsh=abc')).toEqual({ kind: 'reel', code: 'Ddt8lJ0BcD9' });
    expect(instagramRef('https://www.instagram.com/reels/Ddt8lJ0BcD9/')).toEqual({ kind: 'reel', code: 'Ddt8lJ0BcD9' });
    expect(instagramRef('https://instagram.com/p/DW1nTDiDvnF')).toEqual({ kind: 'p', code: 'DW1nTDiDvnF' });
    expect(instagramRef('https://www.instagram.com/nasa/reel/Ddt8lJ0BcD9/')).toEqual({ kind: 'reel', code: 'Ddt8lJ0BcD9' });
    expect(instagramRef('https://www.instagram.com/tv/Abc123/')).toEqual({ kind: 'tv', code: 'Abc123' });
    expect(instagramShortcode('https://www.instagram.com/reel/Ddt8lJ0BcD9/')).toBe('Ddt8lJ0BcD9');
    expect(instagramRef('https://www.instagram.com/nasa/')).toBeNull();
  });

  test('the service can be changed with INSTAGRAM_EMBED_HOST, but only to a plain host name', () => {
    set('INSTAGRAM_EMBED_HOST', 'd.example.org');
    expect(embedLink({ kind: 'reel', code: 'abc123' })).toBe('https://d.example.org/reel/abc123');
    for (const bad of ['evil.com/x?', 'a b.com', 'https://x.com', 'x.com:8080', '-x.com', 'x.com/', '']) {
      set('INSTAGRAM_EMBED_HOST', bad);
      expect(embedLink({ kind: 'reel', code: 'abc123' }), bad).toBe('https://www.d.oginstagram.com/reel/abc123');
    }
  });

  test('embed is the default mode, and INSTAGRAM_REPOST=card turns the repost card back on', () => {
    set('INSTAGRAM_REPOST', undefined); expect(embedMode()).toBe(true);
    set('INSTAGRAM_REPOST', 'embed'); expect(embedMode()).toBe(true);
    set('INSTAGRAM_REPOST', 'anything else'); expect(embedMode()).toBe(true);
    set('INSTAGRAM_REPOST', ' Card '); expect(embedMode()).toBe(false);
  });
});

describe('/instagram repost', () => {
  const run = async (url: string) => {
    const fi = fakeInteraction({ guildId: null, sub: 'repost', options: { url } });
    await commands.get('instagram')!.run!(fi.interaction);
    return fi;
  };

  test('answers with just the embed link — no download, no upload, nothing that can be slow', async () => {
    set('INSTAGRAM_REPOST', undefined);
    const fi = await run('https://www.instagram.com/reel/Ddt8lJ0BcD9/?igsh=abc');
    expect(fi.sent).toHaveLength(1);
    expect(fi.sent[0].content).toBe('https://www.d.oginstagram.com/reel/Ddt8lJ0BcD9');
    expect(fi.sent[0].files).toBeUndefined(); expect(fi.sent[0].allowedMentions).toEqual({ parse: [] });
  });

  test('keeps a post a post, and a reel a reel', async () => {
    expect((await run('https://www.instagram.com/p/DW1nTDiDvnF/')).sent[0].content).toBe('https://www.d.oginstagram.com/p/DW1nTDiDvnF');
    expect((await run('https://www.instagram.com/reels/Ddt8lJ0BcD9/')).sent[0].content).toBe('https://www.d.oginstagram.com/reel/Ddt8lJ0BcD9');
  });

  test('a link that is not a post or reel is explained, and no link is made', async () => {
    for (const bad of ['https://www.instagram.com/nasa/', 'https://example.com/reel/abc123/', 'https://www.instagram.com.evil.com/reel/abc123/', 'hello']) {
      const fi = await run(bad);
      expect(textOf(fi.sent[0]), bad).toContain('Send an Instagram post or reel link'); expect(textOf(fi.sent[0])).not.toContain('oginstagram');
    }
  });
});

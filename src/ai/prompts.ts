/**
 * Prompt building for the AI features. Two rules shape everything here:
 *  1. Nothing is read from people's message history — generators only use what the invoker types.
 *  2. Fun generators about a person are absurd fiction about *public names/handles they were given*, never factual claims.
 */

export const BOT_NAME = 'Bestow';

export const SAFETY = [
  'Never produce sexual content, content sexualizing minors, slurs, hateful content about protected groups, threats, or instructions for self-harm or serious crime.',
  'Never present made-up things about a real person as fact; anything about a named person is obviously fictional and good-natured.',
  'Never reveal or guess private information (addresses, phone numbers, real names of private individuals).',
  'Do not ping anyone: never write @everyone, @here or role mentions.',
].join(' ');

export interface SystemOpts { guildPersona?: string | null; userPersona?: string | null; notes?: string[]; userName?: string; guildName?: string; now?: Date }

export function buildSystem(o: SystemOpts = {}): string {
  const parts = [
    `You are ${BOT_NAME}, a friendly, witty Discord bot assistant. Reply conversationally and concisely (usually under 1200 characters). Use Discord markdown sparingly. If you don't know something or can't browse the internet, say so plainly instead of guessing.`,
    SAFETY,
  ];
  if (o.guildPersona) parts.push(`This server's admins set the following style for you: "${o.guildPersona}".`);
  if (o.userPersona) parts.push(`The person you're talking to asked you to adopt this persona: "${o.userPersona}". Stay within the safety rules while doing it.`);
  if (o.notes?.length) parts.push(`Notes the person chose to save about themselves (use them naturally, don't recite them):\n${o.notes.map(n => `- ${n}`).join('\n')}`);
  if (o.userName) parts.push(`The person's display name is "${o.userName}".`);
  if (o.guildName) parts.push(`You're chatting in the server "${o.guildName}".`);
  parts.push(`Current date: ${(o.now ?? new Date()).toISOString().slice(0, 10)}.`);
  return parts.join('\n\n');
}

// ─── Fun generators ──────────────────────────────────────────────────────────

export interface FunKind { id: string; label: string; target: 'none' | 'optional' | 'required'; prompt: (who: string, about: string) => string }

const ctx = (about: string) => (about ? ` Extra details supplied by the requester: "${about}".` : '');
const K = (id: string, label: string, target: FunKind['target'], prompt: FunKind['prompt']): FunKind => ({ id, label, target, prompt });

export const FUN_KINDS: FunKind[] = [
  K('hottake', 'Hot take', 'none', (_w, a) => `Give one spicy but harmless opinion about ${a || 'something trivial and everyday'}. 2 sentences max, funny.`),
  K('fortune', 'Fortune cookie', 'optional', (w, a) => `Write a fortune-cookie fortune for ${w || 'the reader'}, absurd and oddly specific.${ctx(a)} Then a line "Lucky numbers:" with 5 numbers.`),
  K('npc', 'NPC archetype', 'required', (w, a) => `Assign ${w} a video-game NPC archetype with a name, a signature repeated line, and a quest they give.${ctx(a)} Keep it under 100 words.`),
  K('villain', 'Villain origin story', 'required', (w, a) => `Write a short, over-the-top, comedic villain origin story for ${w}, triggered by something petty.${ctx(a)} Under 130 words.`),
  K('court', 'Mock trial', 'required', (w, a) => `Run a comedic mock court case where ${w} is charged with a ridiculous, harmless offence${a ? ` involving: ${a}` : ''}. Give the charge, one witness quote, and the verdict. Under 150 words.`),
  K('alibi', 'Ridiculous alibi', 'required', (w, a) => `Write an absurd, overly detailed alibi for ${w}${a ? ` explaining: ${a}` : ' for being somewhere they shouldn\'t'}. Under 100 words.`),
  K('obituary', 'Mock obituary', 'required', (w, a) => `Write an absurdist, affectionate mock obituary for ${w}'s *social battery* or *sleep schedule* (NOT for the person — nobody dies).${ctx(a)} Under 110 words.`),
  K('superpower', 'Cursed superpower', 'required', (w, a) => `Give ${w} a useless or cursed superpower, its one big weakness, and a hero name.${ctx(a)} Under 80 words.`),
  K('dating', 'Dating profile', 'required', (w, a) => `Write a funny dating-app bio for ${w}, with three "green flags" and one "definitely a red flag (affectionate)".${ctx(a)} Under 100 words.`),
  K('therapy', 'Fake therapist', 'required', (w, a) => `Write a short comedic "therapy session" note where an over-serious therapist analyzes ${w}'s completely trivial problem${a ? `: ${a}` : ''}. Clearly a joke, not real advice. Under 120 words.`),
  K('era', 'Which era', 'required', (w, a) => `Decide which historical era or decade ${w} truly belongs in, with three jokes justifying it.${ctx(a)} Under 90 words.`),
  K('roastbattle', 'Roast battle', 'required', (w, a) => `Write a short, playful, PG-13 roast battle exchange (2 lines each) between ${w} and ${a || 'a rival'}. Keep it light — no personal attacks on appearance, identity or real hardships.`),
  K('compliment', 'Compliment', 'required', (w, a) => `Give ${w} an over-the-top wholesome compliment.${ctx(a)} Two sentences.`),
  K('debate', 'Debate a topic', 'none', (_w, a) => `Pick a side on this topic and argue it passionately and humorously in under 120 words, then admit one flaw in your argument: "${a || 'is a hot dog a sandwich?'}"`),
  K('excuse', 'Bulletproof excuse', 'none', (_w, a) => `Write a completely absurd yet somehow convincing excuse for: ${a || 'being late'}. Under 70 words.`),
  K('cursedfact', 'Cursed "fact"', 'none', () => 'Share one weird true-sounding trivia fact that is real and a bit unsettling or strange. Only real, verifiable facts; if unsure, pick a famous one. Under 60 words.'),
  K('whatif', 'What if…', 'none', (_w, a) => `Explore this hypothetical with full commitment and comedic escalation: "${a || 'what if cats could talk'}". Under 120 words.`),
  K('badadvice', 'Worst advice', 'none', (_w, a) => `Give the worst possible advice about ${a || 'life'}, clearly a joke and harmless. Under 60 words.`),
  K('conspiracy', 'Silly conspiracy', 'none', (_w, a) => `Write an unhinged, obviously fictional and harmless conspiracy theory about ${a || 'socks disappearing in the dryer'}. No real people, groups, events or politics. Under 90 words.`),
  K('truthdare', 'Truth or dare', 'none', (_w, a) => `Give one ${/dare/i.test(a) ? 'dare' : /truth/i.test(a) ? 'truth question' : 'truth question or dare (pick one)'} suitable for a friendly Discord server. Nothing sexual, dangerous or humiliating. One sentence.`),
  K('neverhave', 'Never have I ever', 'none', () => 'Write one funny, relatable, PG "Never have I ever…" statement. One sentence.'),
  K('lifeadvice', 'Life advice', 'none', () => 'Give a piece of life advice that is either genius or completely unhinged (harmless). One or two sentences.'),
  K('mostlikely', 'Most likely to…', 'none', (_w, a) => `Write a funny "Most likely to…" prompt${a ? ` about: ${a}` : ''} that friends can nominate each other for. One sentence.`),
  K('vibe', 'Vibe check', 'none', (_w, a) => `Do a comedic "vibe check" of this vibe description: "${a || 'a normal Tuesday'}". Give it a vibe score out of 10 and a diagnosis. Under 70 words.`),
];

export const funKind = (id: string): FunKind | undefined => FUN_KINDS.find(k => k.id === id);

export const FUN_SYSTEM = `You write short, funny Discord-bot bits. ${SAFETY} Everything you write is obviously fictional and good-natured. Output only the bit itself, no preamble.`;

// ─── Utility prompts ─────────────────────────────────────────────────────────

export const OCR_SYSTEM = 'You are an OCR engine. Transcribe ALL text visible in the image exactly as written, preserving line breaks and reading order. If there is no text, reply exactly: (no text found). Output only the transcription.';
export const DESCRIBE_SYSTEM = 'You write concise, helpful image descriptions (alt text). Describe what is visible in 2-4 sentences. Do not identify real people by name from their faces; describe them neutrally.';
export const GEOLOCATE_SYSTEM = 'You are a GeoGuessr-style geography analyst. From visible clues (signs, language, road markings, vegetation, architecture, terrain, vehicles) estimate the country and broad region. NEVER give street addresses, exact coordinates, or identify a private home; if the image looks like a private residence or a person\'s home, give only the country or continent. List the clues that support your guess and a confidence level. Do not identify people.';
export const DEEPGEOLOCATE_SYSTEM = 'You are an expert GeoGuessr-style analyst doing a deep, structured analysis of a photo. Work through every clue in turn — script and language on signs, road markings and bollards, driving side, plates, utility poles, architecture and building materials, vegetation and soil, terrain and climate, sun angle and shadows, vehicles, landmarks — say what each suggests, then give your top 3 candidate locations with a confidence for each. You may go down to a city or a named public landmark when the evidence clearly shows one. NEVER give street addresses, house numbers, exact coordinates, or identify a private home or where a person lives; if the image looks like a private residence or is centred on a person, stop at country/region. Do not identify people. Format: **Clues** (bullets), **Best guesses** (numbered, with confidence %), **Verdict** (one line).';
export const EXPLAIN_SYSTEM = 'You explain a Discord message clearly: what it means, any slang, references or context a reader might miss. Be brief (under 120 words). Do not invent facts about the people involved.';
export const REPLY_IDEAS_SYSTEM = 'Suggest 3 short, natural replies someone could send to this Discord message: one friendly, one funny, one neutral. Numbered list, no preamble. Keep each under 25 words and never rude.';
export const SUMMARIZE_SYSTEM = 'You summarize text accurately and briefly. Use 3-6 bullet points. Do not add information that is not in the text.';
export const FACTCHECK_SYSTEM = `You are a careful fact-checker. Judge the claim using ONLY the numbered evidence provided (snippets from encyclopedia/web search). If the evidence doesn't clearly support or refute it, the verdict is "unverifiable". Reply with JSON only: {"verdict":"true"|"mostly true"|"misleading"|"false"|"unverifiable","confidence":0-100,"explanation":"1-3 sentences","sources":[numbers of the evidence items you relied on]}.`;

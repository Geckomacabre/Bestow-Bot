# Bestow

A multipurpose Discord bot: an economy with real depth, media editing, free text-to-speech and singing, AI tools, game/dev lookups, moderation, tickets, levels and more — with **no tracking, no data selling, and a `/privacy` command that shows, exports and erases exactly what it stores about you**.

Built with TypeScript, [Bun](https://bun.sh) and [discord.js](https://discord.js.org). Derived from TMCBot (GPL-3.0-or-later); the AI ideas come from an earlier llmcord-based bot. See [COMMANDS.md](COMMANDS.md) for every command (generated from the code, so it's always accurate).

## What's in it

| Area | Highlights |
|---|---|
| 💰 **Economy** (`/eco`, `/wallet`) | Wallet + bank, daily/weekly rewards, work, rob & protection, businesses, labs, investments, quests, trading cards, **companies** with vaults and projects, shop, casino games (blackjack, roulette, crash, slots, plinko, dice…), leaderboards. Fair odds (no hidden house edge) and race-condition-proof balances. |
| 🎬 **Media** (`/media`, `/audio`) | Dozens of image/GIF/video effects (caption, memes, speed, reverse, fisheye, zoom blur…), audio effects, frame extraction, **`/media download`** (YouTube, TikTok, X, Reddit, SoundCloud… via yt-dlp). |
| 🗣️ **TTS & singing** (`/tts`) | Free local voices (Kokoro + Edge fallback), character voices, and **singing voices in the same voice list** — plus optional AI singers via an ACE-Step server you run. Output as an audio file or a Discord **voice message**. |
| 🤖 **AI** (`/ai`, @mention, DMs) | Ask, read text in images, describe, geolocate (region-level), transcribe speech, summarise, fact-check against Wikipedia/your search, comedy bits, personas. Chat by mentioning the bot. **Opt-in memory** that only stores notes you explicitly save. Works with any OpenAI-compatible provider, including local ones. |
| 🔎 **Lookups** | `/roblox`, `/minecraft`, `/github`, `/steam`, `/valorant`, `/fortnite`, `/youtube`, `/crypto` (prices, BTC/ETH wallets, fees), `/net` (DNS, IP, ping, website screenshot). |
| 🧰 **Tools** (`/tools`) | QR generate/scan, colours/palettes/gradients, unit + currency converter, calculator, lyrics, search, paste, tweet preview. |
| 🎉 **Fun** (`/fun`, `/generate`) | Anime action GIFs, ship, rate, rizz, roast, a fictional **`/fun juul`**, bad-translate, ASCII art, markov; fake-message/reply/conversation/tombstone images (watermarked as fake). |
| 🛡️ **Community** | Moderation & cases, automod, anti-phishing/raid guard, tickets, levels & XP, reputation, welcome, autorole, reaction roles, starboard, sticky messages, tags, birthdays, timezones, reminders, counting, stream-VC requests, guessing games, web dashboard. |
| 🔒 **Privacy** (`/privacy`) | Policy, "what do you have on me?", full JSON export, and erase-everything. |

There is deliberately **no music player and no giveaway system**.

## Privacy by design

- Stores IDs, settings, game progress and things you deliberately enter (a reminder, a tag, a birthday). **Never** a log of chat messages, DMs, emails, phone numbers or IP addresses.
- Message content is read in memory only by features that need it (auto-moderation, counting, custom commands, XP counters, @mention chat) and is then discarded.
- The AI never reads channel history. Generators use only what the person types; chat uses only the reply chain it's part of; memory is **off by default** and only holds notes the person saves on purpose.
- `src/privacy/registry.ts` lists every table that identifies a person, and **a test fails if someone adds one without registering it** — so `/privacy export` and `/privacy delete` can't silently miss data. Another test fails if a new free-text column appears that might hold chat content.
- The *Presence* intent is off unless you opt in; there is no telemetry.
- Commands that call outside services send only what you typed into that command (listed in `/privacy policy`).

## Setup

### 1. Create the Discord application (you must do this yourself)
1. <https://discord.com/developers/applications> → **New Application** → name it.
2. **Bot** tab → **Reset Token** → copy it (shown once). Under *Privileged Gateway Intents* enable **Server Members** and **Message Content**. Leave *Presence* off unless you want streaming announcements.
3. Copy the **Application ID** (that's `CLIENT_ID`).
4. Never commit or share the token. If it leaks, reset it immediately.

### 2. Configure
```bash
cp .env.example .env      # then fill in TOKEN and CLIENT_ID (see the comments in the file)
bun install
```
Keep the database (`./data/bestow.db` by default) on a **local disk**. The bot refuses to start with the database inside OneDrive/Dropbox/iCloud, because sync clients corrupt SQLite files.

### 3. Run
```bash
bun run start:production     # or: bun run dev   (auto-restart on changes)
```
Slash commands are registered globally on startup. Invite the bot with `/bot invite`, or build the link from your Client ID. To let people use the fun/lookup/tools commands from their own account in any server or DM, enable **User Install** under the application's *Installation* tab in the Developer Portal.

### Docker
```bash
docker compose up -d --build
```
The image includes ffmpeg and yt-dlp, runs as an unprivileged user, and keeps its database, voice models and uploads on the `bestow-data` volume.

## Optional features

| Feature | What to set up |
|---|---|
| **AI** | `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` (any OpenAI-compatible API: OpenAI, xAI/Grok, Groq, OpenRouter, or local Ollama/LM Studio). `VISION_*` for image understanding, `WHISPER_*` for `/ai transcript`. Limit spend with `AI_USER_LIMIT`, `AI_DAILY_LIMIT`, `AI_DISABLED`. |
| **TTS** | Nothing — the free voices download on first use (~90 MB, cached in `data/models`). |
| **AI singers** | Run an [ACE-Step 1.5](https://github.com/ace-step/ACE-Step-1.5) API server and set `ACESTEP_URL`. Needs a capable GPU; the bundled singing voices work without it. |
| **Web search** | Set `SEARXNG_URL` to your own SearXNG instance; otherwise `/tools search` uses Wikipedia. |
| **/media download** | Needs `yt-dlp` on `PATH` (included in Docker). Some sites (notably YouTube from datacenter IPs) demand a login or bot check — set `YTDLP_COOKIES` to a cookies file if so. |
| **Lookups** | API keys are optional; see `.env.example`. |
| **Web dashboard** | `WEB_PORT`, `WEB_URL`, `DISCORD_CLIENT_SECRET`. Use https in production. |

## Development

```bash
bun run check          # typecheck + command validation + all tests
bun run docs           # regenerate COMMANDS.md (a test fails if it's stale)
bun test               # offline tests
RUN_NET_TEST=1 bun test        # also hit the real third-party APIs and yt-dlp
RUN_TTS_TEST=1 bun test        # also synthesise with the real voice model
```

Notes for contributors:
- **Discord allows 100 top-level slash commands.** Commands are grouped with `defineGroup` (`src/framework/group.ts`): one registered command, many small handler modules. `bun run validate` reports the budget and payload sizes.
- **Money is atomic.** Balances change only through guarded single-statement updates (`adjustBalance`, `stake`/`settleRound`), and read-modify-write flows serialise on a keyed mutex (`src/framework/mutex.ts`). Bun's SQLite driver does **not** isolate transactions on one connection, so don't rely on `db.begin`.
- **Never decode a user-supplied image with `loadImage` directly.** `@napi-rs/canvas` segfaults the whole process on corrupt PNG/JPEG data. Use `safeLoadImage` (`src/framework/imgsafe.ts`), which decodes in a separate ffmpeg process first.
- **User-supplied URLs** go through `getBufferPublic` (blocks private/loopback/link-local addresses, re-checks every redirect).
- Third-party lookups keep parsing (pure, unit-tested against captured responses) separate from fetching (opt-in live tests).

## Known limitations

- Not yet run against live Discord in this repository's history: slash-command registration, voice-message delivery and button flows are covered by tests with a fake interaction, not by a real gateway session. Do a smoke test in a private server first.
- ACE-Step singing is tested against a mock server, not the real model.
- The optional native image addon (`/image …` effects in the legacy `natives/` module) needs libvips and cmake; without it those effects are disabled.
- AI output can be wrong, and comedy generators rely on the provider's own content filtering plus the bot's safety prompt.
- A few decorative renders (rank card and roblox/quote avatars) still decode images from Discord's/Roblox's CDNs directly.

## License

GPL-3.0-or-later. Derived from TMCBot; see [LICENSE](LICENSE).

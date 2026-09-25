# Bestow

A multipurpose Discord bot you install **on your own account** and use anywhere — any server, DM or group chat — without anyone having to add it to a server first. Economy with real depth, giveaways, minigames, media editing, free text-to-speech and singing, AI tools, game and social lookups, and small community tools, with **no tracking, no data selling, and a `/privacy` command that shows, exports and erases exactly what it stores about you**.

Built with TypeScript, [Bun](https://bun.sh) and [discord.js](https://discord.js.org). Derived from TMCBot (GPL-3.0-or-later). Every command is listed in [COMMANDS.md](COMMANDS.md), which is generated from the code so it is always accurate.

> **Status: work in progress.** The goal is to cover the full command list of [Heist](https://heist.lol/commands). Most of the economy, fun, media, utility and lookup commands are in; a good part of the social lookups, Last.fm/Spotify and a few generators are still to come. [`docs/heist-commands.json`](docs/heist-commands.json) is the target list and `bun scripts/parity.ts` prints exactly what is still missing. Anything deliberately not built (harassment, doxxing or account-enumeration tools) is listed with its reason in [`docs/heist-parity.json`](docs/heist-parity.json).

## How it is installed

Bestow is a **user-install** app. Commands are registered globally and work in servers, DMs and group DMs:

- **Add it to your account** and use it anywhere. Nobody needs to be an admin, and it is not tied to one server. Economy, games, media, lookups and tools all work this way.
- **Add it to a server** as well to unlock the things Discord only lets a server-installed bot do: giveaways (which edit a message over hours or days), levels and XP, `/config` server settings, and other features that react to what happens in a channel. Those commands tell you when the bot isn't in the server.

Run `/invite` for both links, or build them from your application id:

```
Your account:  https://discord.com/oauth2/authorize?client_id=<CLIENT_ID>&integration_type=1&scope=applications.commands
A server:      https://discord.com/oauth2/authorize?client_id=<CLIENT_ID>&scope=bot%20applications.commands
```

## What's in it

| Area | Highlights |
|---|---|
| 💰 **Economy** (`/eco`, `/eco-company`) | Wallet card you can restyle (with a live **studio**), bank, daily/monthly/work/hustle/beg/bonus, robbing, businesses, labs, investments, quests, trading cards, **companies** with shared vaults and projects, casino games (blackjack, roulette, crash, slots, plinko, mines, towers…), leaderboards, economy-funded giveaways. Balances change through guarded single-statement updates, so races can't duplicate or lose money. |
| 🎁 **Giveaways** (`/giveaway`, `/eco giveaway`) | Button-entry giveaways that survive restarts, rerolls that never repeat a winner, and coin-funded pots held in escrow (25% tax on payout, refunded if cancelled). |
| 🎮 **Games** (`/games`) | Tic-tac-toe, rock-paper-scissors, head-to-head blackjack, snake and a cookie race — all played with buttons, against a friend or the first person to press Join. |
| 🎬 **Media** (`/media`, `/audio`) | Dozens of image, GIF and video effects, animated makesweet scenes (billboard, flag, Rubik's cube, heart locket…), audio effects, frame extraction, and `/download` (YouTube, TikTok, X, Reddit, SoundCloud… via yt-dlp). |
| 🗣️ **Voice** (`/tts`) | Free local voices (Kokoro with an Edge fallback), character voices, singing voices, optional AI singers through an ACE-Step server you run. Output as a file or a Discord **voice message**. |
| 🤖 **AI** (`/ai`, @mention, DMs) | ChatGPT-style answers with **Reply n/3** conversations, an alternative model (`/ai llama`), image reading, transcripts, fact-checks, geolocation (region level), personas and opt-in memory. Works with any OpenAI-compatible provider, including local ones. Free accounts get **20 requests per hour**; Premium removes the limit. |
| 🔎 **Lookups** | `/roblox`, `/minecraft`, `/github`, `/steam`, `/valorant`, `/fortnite`, `/youtube`, `/crypto`, `/dns`, `/ip`, `/website`, `/x`. |
| 🧰 **Utility** | Translate, lyrics, dictionary, QR codes, colours, converters, calculator, base64, search, paste, weather, quote-image maker. |
| 🎉 **Fun** | Anime action GIFs, ship, ratings, rizz, roast, pet-pet GIFs, emoji mixer, fake-message/reply/conversation images (watermarked as fake), a fictional `/juul`, buttons, and right-click menus (Pet User, Rizz User, Roast User, Quote Message). |
| 🫂 **Community** (`/community`, `/config`, `/server`) | Levels and reputation, birthdays, reminders, roles, free-game tracker, weekly/yearly rewards and the item shop, plus server settings such as counting, starboard, topic rotation and server stats. |
| ✨ **Premium** (`/premium`, `/plus`) | Unlimited AI, plus the commands marked ✨ (wallet-card styling, the monthly reward, and more as they ship). Sold through Discord itself; gift codes and owner grants are supported. |
| 🔒 **Privacy** (`/settings`, `/privacy`) | Policy, "what do you have on me?", a full JSON export, and erase-everything. |

## Premium

Discord handles the payment, so Bestow never sees a card number. Create a subscription SKU (and, for gifts, a consumable SKU) in the Developer Portal under **Monetization** and put the ids in `.env` (`PREMIUM_SKU_ID`, `PREMIUM_GIFT_SKU_ID`). People can then buy it from `/premium buy`; owners listed in `OWNER_IDS` always have it and can `/premium grant` it.

Until a subscription SKU is configured there is nothing to buy, so ✨ commands stay open to everyone. Setting `PREMIUM_SKU_ID` is the switch that turns the gate on.

## Privacy by design

- Stores IDs, settings, game progress and things you deliberately enter (a reminder, a birthday, a wallet style). **Never** a log of chat messages, DMs, emails, phone numbers or IP addresses.
- Message content is read in memory only by the features that need it (counting, XP counters, @mention chat) and is then discarded.
- The AI never reads channel history. Generators use only what the person types; chat uses only the reply chain it belongs to; memory is **off by default** and holds only notes the person saves on purpose. Conversations live in memory for 30 minutes and never touch the disk.
- `src/privacy/registry.ts` lists every table that identifies a person, and **a test fails if someone adds one without registering it**, so `/privacy export` and `/privacy delete` can't silently miss data. Another test fails if a new free-text column appears that might hold chat content.
- The *Presence* intent is off unless you opt in, and there is no telemetry.
- Commands that call outside services send only what you typed into that command (listed in `/privacy policy`).

## Setup

### 1. Create the Discord application (you must do this yourself)
1. <https://discord.com/developers/applications> → **New Application**.
2. **Installation** tab: enable both **User Install** and **Guild Install**.
3. **Bot** tab → **Reset Token** → copy it (shown once). Under *Privileged Gateway Intents* enable **Message Content** and **Server Members**. Leave *Presence* off unless you want streaming announcements.
4. Copy the **Application ID** (that is `CLIENT_ID`).
5. Never commit or share the token or client secret. If either leaks, reset it immediately.

### 2. Configure
```bash
cp .env.example .env      # fill in TOKEN and CLIENT_ID; every other setting is documented in the file
bun install
```
Keep the database (`./data/bestow.db` by default) on a **local disk**. The bot refuses to start with it inside OneDrive, Dropbox or iCloud, because sync clients corrupt SQLite files.

### 3. Run
```bash
bun run start:production     # or: bun run dev   (restarts on changes)
```
Commands are registered globally on every start. Global registration can take a little while to show up in Discord's client.

### Docker
```bash
docker compose up -d --build
```
The image includes ffmpeg and yt-dlp, runs as an unprivileged user in production mode, and keeps its database, voice models and uploads on the `bestow-data` volume. The compose project is named `bestow`. If port 3000 is taken on your machine, publish the dashboard elsewhere with `WEB_PORT=3100 docker compose up -d --build`.

## Optional features

| Feature | What to set up |
|---|---|
| **AI** | `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` (OpenAI, xAI, Groq, OpenRouter, or local Ollama/LM Studio). `LLM_LABEL` sets the name shown in reply footers. `LLAMA_*` configures `/ai llama`. `VISION_*` is for image understanding and `WHISPER_*` for transcripts. Limit spend with `AI_USER_LIMIT` (default 20 an hour), `AI_DAILY_LIMIT` and `AI_DISABLED`. |
| **Premium** | `PREMIUM_SKU_ID`, `PREMIUM_GIFT_SKU_ID`, `PREMIUM_GIFT_DAYS`, `OWNER_IDS`. |
| **Support server** | `SUPPORT_GUILD_ID` and `SUPPORT_INVITE` power `/eco joinbonus`; with `PREMIUM_ROLE_ID` they also enable `/premium syncrole`. |
| **TTS** | Nothing. The free voices download on first use (about 90 MB, cached in `data/models`). |
| **AI singers** | Run an [ACE-Step 1.5](https://github.com/ace-step/ACE-Step-1.5) API server and set `ACESTEP_URL`. Needs a capable GPU; the bundled singing voices work without it. |
| **Web search** | Set `SEARXNG_URL` to your own SearXNG instance; otherwise `/search` falls back to Wikipedia. |
| **/download**, **/soundcloud** | Needs `yt-dlp` on `PATH` (included in Docker). Some sites demand a login or bot check from datacenter IPs; set `YTDLP_COOKIES` to a cookies file if so. |
| **Lookups** | API keys are optional; see `.env.example`. |
| **Web dashboard** | `WEB_PORT`, `WEB_URL`, `DISCORD_CLIENT_SECRET`. Use https in production. |

## Development

```bash
bun run check          # typecheck + command validation + all tests
bun run docs           # regenerate COMMANDS.md (a test fails if it's stale)
bun test               # offline tests
bun scripts/parity.ts  # which Heist commands are still missing
RUN_NET_TEST=1 bun test        # also hit the real third-party APIs and yt-dlp
RUN_TTS_TEST=1 bun test        # also synthesise with the real voice model
```

Notes for contributors:
- **Discord allows 100 top-level slash commands, 25 entries per level and two levels of nesting.** Commands are grouped with `defineGroup` (`src/framework/group.ts`): one registered command, many small handler modules. `bun run validate` reports the budget and payload sizes. Mark a subcommand `premium: true` to make it a ✨ command.
- **Everything works with no server.** In DMs and user installs there is no guild, so per-user data is keyed by user id (economy uses a `global` scope). `tests/dm.test.ts` runs every economy command with no guild.
- **Money is atomic.** Balances change only through guarded single-statement updates, and read-modify-write flows serialise on a keyed mutex (`src/framework/mutex.ts`). Bun's SQLite driver does **not** isolate transactions on one connection, so don't rely on `db.begin`.
- **Never decode a user-supplied image with `loadImage` directly.** `@napi-rs/canvas` segfaults the whole process on corrupt PNG/JPEG data. Use `safeLoadImage` (`src/framework/imgsafe.ts`), which decodes in a separate ffmpeg process first.
- **User-supplied URLs** go through `getBufferPublic` (blocks private, loopback and link-local addresses, and re-checks every redirect).
- Third-party lookups keep parsing (pure, unit-tested against captured responses) separate from fetching (opt-in live tests).
- The Linux image builds the native canvas addon, so run the test suite inside it when you touch anything image-related.

## Known limitations

- Command registration and login are verified against the real gateway, but most button, modal and voice-message flows are covered by tests with fake interactions rather than a live session. Smoke-test in a private server first.
- Commands that need Discord events or long-lived message edits (giveaways, levels, server tools) require the bot to be installed in the server. Elsewhere they say so.
- ACE-Step singing is tested against a mock server, not the real model.
- The optional native image addon (`natives/`) needs libvips and cmake; without it those legacy effects are disabled.
- AI output can be wrong, and the comedy generators rely on the provider's own content filtering plus the bot's safety prompt.
- Some social lookups need a key or a logged-in session that free tiers don't offer (for example Roblox followers, Valorant stats and Last.fm), so they are configured through `.env` when they arrive.

## License

GPL-3.0-or-later. Derived from TMCBot; see [LICENSE](LICENSE).

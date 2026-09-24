# 📖 Bot Command Guide

---

## 💰 Economy

Earn and spend coins in the server economy.

- `/balance [user]` — Check your coin balance (or anyone else's)
- `/daily` — Collect your daily reward *(grows if no one's claimed one in a while — see Drought Bonus)*
- `/work` — Work for a random coin payout *(grows if no one's worked in a while — see Drought Bonus)*
- `/weekly` — Collect your weekly bonus
- `/monthly` — Collect your monthly bonus
- `/yearly` — Collect your yearly bonus
- `/beg` — Beg for a small amount of coins (15-minute cooldown, grows if no one's begged in a while — see Drought Bonus)
- `/pay user: amount:` — Send coins to another member
- `/economy leaderboard` — See who has the most coins on the server

### 🦹 Rob & Protection

- `/rob target:` — Attempt to rob another user (50/50 chance). On success you steal a **random amount** — could be a single coin or their whole wallet. Get fined if caught. **30-min cooldown** after failure, **1-hour cooldown** after success
- `/protection` — Hire mob protection for **5,000 coins** — blocks all robbery attempts for 24 hours. Robbers who try get bounced with no cooldown penalty

### 🏪 Shop

- `/shop browse` — View all shop items
- `/shop buy item:` — Purchase an item with your coins (add the `cooldown` option for Time Skip)

**⏱️ Timed boosts:**
- 🔮 **XP Surge** — 2× XP from all sources for 1 hour (25,000 coins)
- 🍀 **Lucky Charm** — 1.5× gambling winnings for 30 minutes (30,000 coins)
- ⚡ **Hint Rush** — skip the shared hint cooldown in the guessing games, for 15 minutes (15,000 coins)
- 💼 **Overtime Permit** — half `/work` cooldown (30 min) for 4 hours (20,000 coins)
- 🧲 **Coin Magnet** — 1.5× coins from `/work`, `/daily`, and `/beg` for 24 hours (40,000 coins)
- 🎟️ **Loaded Dice** — double your chance in the next daily lottery draw (15,000 coins)

**🎫 One-shots** *(sit in your pocket until they trigger — expire after 7 days)*:
- 🥊 **Goon Squad** — your next failed `/rob` has no cooldown (25,000 coins)
- 🛡️ **Gambling Insurance** — your next lost bet is 50% refunded, any game (30,000 coins)
- 🔁 **Second Chance** — if `/crash` busts below 1.5x, your bet is refunded (40,000 coins)
- 💖 **Extra Life** — your next mistake in the counting game is forgiven instead of resetting the streak (35,000 coins)

**⚡ Instant:**
- ⏩ **Time Skip** — instantly reset your `/daily`, `/work`, or `/beg` cooldown (35,000 coins)
- 📦 **Mystery Box** — 60% coins (2k–8k), 25% a random boost, 10% nothing, 5% a 50k jackpot (10,000 coins)

### 📈 Drought Bonus

`/work`, `/daily`, and `/beg` each watch how long it's been since **anyone in the server** last claimed them — not you personally. The longer it sits unclaimed, the bigger the payout for whoever runs it next: it doubles every 12 hours of drought (past a 6-hour grace period) for `/work`, every 24 hours (past 4 days) for `/daily`, and every 6 hours (past 3 hours) for `/beg` — capped at **1,000,000 coins**. Claiming it resets the timer to zero, so hitting the cap takes real days of nobody touching that command — rare, but it happens. You'll see a 🔥/💰/🎰 note in the response whenever a bonus kicks in.

### 🎰 Daily Lottery

Every day, one random member wins **50,000 coins** automatically! You're entered just by being active in the server (having any XP). Buy 🎟️ **Loaded Dice** to double your chance in the next draw.

---

## 🎰 Gambling

All games are **statistically fair** — no hidden house edge, every game pays out ~100% over time. All gambling games award **bonus XP** on wins (capped at 1,000 XP/day across all games).

- `/flip bet:` — Coin flip. True 50/50 — win doubles your bet
- `/highroll bet:` — Roll 1–100 against the bot. Higher roll wins, ties refund your bet
- `/slots bet:` — 3-reel slot machine. **Pairs pay** (🍒½x 🍋1x 🔔1.5x 💎2x 7️⃣3x) and **triples pay big** (🍒4x 🍋7x 🔔12x 💎25x 7️⃣75x) — you hit something 60% of spins
- `/roulette bet: type:` — Bet on Red/Black, Even/Odd, Low/High (all 2x), or a single number 1–36 (35x). No zero pocket — true odds
- `/crash bet:` — Ride a stock-style multiplier that swings **up and down** each tick. Click **Cash Out** to bank the current value (always at least 1×) — but the price can **crash to 0** at any moment and wipe your bet, and the higher it climbs the likelier that gets. If you time out, you're auto-cashed at the current value
- `/blackjack bet:` — Classic blackjack vs the dealer. Hit, Stand, or Double Down. Blackjack pays 1.5x
- `/poker bet:` — **Jacks or Better** video poker. Pick which cards to hold, draw the rest, and get paid on your hand (Royal Flush = 250x)
- `/scratch bet:` — Buy a scratch card. Click tiles to reveal 9 symbols — match **4+** of a kind to win (🍒1x 🍋2x 🍊3x 🍇6x ⭐12x 💎25x)

---

## ⭐ Levels & XP

Earn XP by chatting, winning games, and getting rep. Level up to earn coins and unlock roles.

- `/rank [user]` — View your rank card showing level, XP, and server rank
- `/level leaderboard` — See the top members by XP on this server

> XP formula per level: `5L² + 50L + 100` — gets harder as you go up.

---

## 🏆 Reputation

Give respect to members you like. Rep counts toward their XP too.

- `/rep give user:` — Give someone a reputation point (+75 XP to them)
- `/rep view [user]` — See how many rep points someone has
- `/rep leaderboard` — Server reputation rankings

---

## 🎉 Giveaways

- Use the **Enter** button on any active giveaway message to enter
- Winners are picked randomly and announced when the timer ends

---

## 🎟️ Tickets

- Click the **Open Ticket** button in the support channel to create a private ticket with staff
- Inside your ticket: use the buttons to **save a transcript**, **rate support** (after closing), or wait for a mod to assist

---

## 🎥 Stream VC — Request to Join

A locked voice channel (like a streamer's private VC). Only members with the **required role** (e.g. Self Promo) can ask, and approvers decide.

- Click the **Request to Join** button on the panel (or run `/streamvc request`) — you need the required role. A notice posts in the request channel with a **Review** button
- An approver clicks **Review** and gets an **ephemeral Approve / Reject** panel (only they see it). On **Approve**, the bot **unlocks the channel for you** and DMs you; on **Reject**, you're notified
- Admins set it up with `/streamvc config set vc: request_channel: required_role:` — setting the VC **auto-locks it** — post the button with `/streamvc config panel`, and choose approvers with `/streamvc config add-approver`

---

## 🎬🎮🎵 Guessing Games

Four channel-based guessing games — 🎬 **Movie**, 📺 **TV Show**, 🎮 **Video Game**, 🎵 **Song** — each set up in its own channel. A still (or, for songs, a **5-second audio clip**) is posted and everyone guesses in chat. Each round has **💡 Hint** and **⏭️ Vote Skip** buttons right under it — the commands below work the same way, just pick whichever's faster.

- **Just type your guess** in the game channel — no command needed
- Bot reacts **❗** if you're close, **‼️** if you're very close
- First to guess correctly wins **+150 XP** (counts toward daily XP cap) — always the full reward, no matter how many hints you used. For songs, the **full 30-second clip** posts as a bonus once someone wins the round
- `/hint` (or the **Hint** button) — Reveal the next clue **publicly**, shared with everyone in the channel (up to 5 per round, 6 for songs). Free, but there's a 60-second cooldown between hints (buy ⚡ **Hint Rush** to skip it for 15 minutes). Movie/TV/game hints: info card → masked title → anagram → extra screenshot → description. Song hints: info (year/genre/duration) → masked title → anagram → **extended snippet** *(a different 10-second clip, later in the track)* → **artist reveal** → **album art**
- `/voteskip` (or the **Vote Skip** button) — Vote to skip the current round (2 votes needed, opens up 5 minutes into the round)

---

## 🎮 Fun & Games

- `/trivia [difficulty] [category]` — Answer a multiple-choice trivia question. Harder difficulties give more XP
- `/wouldyourather` — Get a Would You Rather question — react with 🅰️ or 🅱️
- `/8ball question:` — Ask the magic 8-ball anything
- `/freegames` — Browse current free games on Epic Games, Steam, and GOG

---

## 🖼️ Image Effects

Apply 40+ effects to any image or GIF. Target an image by attaching one to your command, replying to a message, or using **Right-click → Apps → Select Image** first.

- `/image effect: [image]` — Apply an effect to an image

**Available effects include:**
`blur` `sharpen` `invert` `deepfry` `grayscale` `sepia` `flip` `flop` `wide` `stretch` `swirl` `magik` `circle` `crop` `tile` `wall` `bounce` `reverse` `spin` `slide` `fade` `explode` `implode` `vignette` `squish` `globe` `hue` `pixelate` `rotate` `jpeg` `caption` `caption2` `meme` `motivate` `whisper` `spotify` `reddit` `snapchat` `uncanny` `sonic` `homebrew` `watermark` `flag` `speed` `slow` `freeze` `togif`

---

## 🎵 Music

Must be in a voice channel to use.

- `/music play query:` — Play a song or playlist (name, YouTube, Spotify, SoundCloud links)
- `/music nowplaying` — Show the currently playing track
- `/music queue [page]` — View the queue
- `/music skip` — Skip the current track
- `/music pause` — Pause or resume playback
- `/music stop` — Stop music and clear the queue
- `/music volume level:` — Set playback volume (1–200)
- `/music loop mode:` — Loop the current track, the whole queue, or turn off
- `/music shuffle` — Shuffle the queue
- `/music remove position:` — Remove a specific track from the queue
- `/music seek time:` — Jump to a position in the current track (e.g. `1:30`)
- `/music host user:` — Transfer DJ privileges to another user

---

## 🏷️ Tags

Store and share reusable text snippets — great for FAQs, rules, links, etc.

- `/tag get name:` — Post a saved tag
- `/tag create name: content:` — Create a new tag (you own it)
- `/tag edit name: content:` — Edit your own tag
- `/tag delete name:` — Delete your own tag
- `/tag info name:` — See who made a tag and how many times it's been used
- `/tag list` — List all tags in the server

---

## 🎂 Birthday

- `/birthday set month: day:` — Register your birthday with the server
- `/birthday remove` — Remove your birthday
- `/birthday view [user]` — See when someone's birthday is
- `/birthday list` — See upcoming birthdays in the server

---

## 🎭 Self-Assign Roles

- `/roles self name:` — Assign yourself a self-assignable role (if set up by admins)

---

## ⏰ Reminders

- `/reminder set time: message:` — Set a reminder (e.g. `2h`, `30m`, `1d`)
- `/reminder list` — See your active reminders
- `/reminder delete id:` — Cancel a reminder

---

## 🛠️ Utility

- `/ping` — Check the bot's response time and latency
- `/userinfo [user]` — View detailed info about a member
- `/serverinfo` — View server stats (members, roles, boosts, etc.)
- `/avatar [user]` — View someone's full avatar
- `/banner [user]` — View someone's profile banner
- `/define word:` — Look up a word in the dictionary
- `/translate text: [to]` — Translate text to another language
- `/weather city:` — Get current weather for a location
- `/roll [dice]` — Roll dice — supports expressions like `2d6`, `1d20+3`
- `/base64 action: text:` — Encode or decode text in Base64
- `/viewperms [user] [channel]` — View a user's permissions in the server or a specific channel
- `/listroles` — List all roles in the server
- `/makeaquote` — Turn any message into a styled quote card (right-click a message → **Apps → Make it a Quote**)

---
---

# 🔨 Moderator Section

*Paste the section below into your mod-only info channel.*

---

## ⚖️ Moderation Actions

All actions are logged to the modlog channel and stored as cases.

- `/ban user: [reason] [delete_days]` — Permanently ban a member
- `/unban user:` — Unban a member by user ID
- `/kick user: [reason]` — Kick a member from the server
- `/timeout user: duration: [reason]` — Mute a member for a set duration (e.g. `1h`, `7d`)
- `/untimeout user:` — Remove an active timeout early
- `/warn user: reason:` — Issue a formal warning (stored in case log)
- `/purge amount: [user] [contains]` — Bulk delete up to 100 messages; filter by user or keyword
- `/case id:` — Look up a specific mod case by its ID
- `/reason id: reason:` — Update the reason on an existing mod case
- `/warnings user:` — View all warnings on record for a member
- `/report user: reason:` — Members can also use this to report someone to staff

---

## 🚨 Raid Detection

- `/raidguard recent [minutes] [max_age_days]` — List recently joined accounts, newest first (default: last 5 minutes, no age filter) — pulls live, works even right after a restart
- **Automatic alert** — if 5+ accounts under 3 days old join within 60 seconds, a `🚨 Possible Raid Detected` message posts to your modlog with everyone involved, ready to feed into `/ban`
- **Command spam auto-timeout** — 6+ slash commands in 8 seconds (the signature of a raid script) triggers the same 24-hour timeout + message purge as regular spam detection

---

## 🎟️ Ticket Management

These commands work **inside an active ticket channel**.

- `/ticket close [reason]` — Close and archive the ticket
- `/ticket transcript` — Generate and save a full text transcript
- `/ticket add user:` — Add a user to the ticket channel
- `/ticket remove user:` — Remove a user from the ticket channel
- **Claim button** — Click inside the ticket to claim it (removes the support role, assigns to you)
- `/ticket ratings` — View ticket rating stats and breakdown for the server

---

## 🎉 Giveaway Management

- `/giveaway start prize: duration: winners: [channel]` — Start a giveaway (`1h`, `2d`, etc.)
- `/giveaway end id:` — End a giveaway early and pick winners immediately
- `/giveaway reroll id:` — Reroll new winners for an ended giveaway
- `/giveaway list` — See all active giveaways
- `/giveaway entries id:` — See who has entered a giveaway

---

## ⚙️ Configuration (Admin Only)

### Moderation
- `/modconfig modlog [channel]` — Set the channel where all mod actions are logged (omit to clear)
- `/modconfig dm enabled:` — Toggle whether punished users receive a DM about their case
- `/modconfig view` — View current mod settings

### Antiphishing
- `/config antiphishing toggle enabled:` — Enable or disable antiphishing entirely
- `/config antiphishing invites enabled:` — Toggle auto-removal of Discord invite links
- `/config antiphishing lookalike enabled:` — Toggle typosquat domain detection (e.g. `discocd.gift`)
- `/config antiphishing view` — View current antiphishing settings

All on by default. Known phishing domains are always blocked while antiphishing is enabled; removals post an alert to your modlog channel.

### Server Logging
- `/config logs channel [channel]` — Set the fallback log channel (omit to clear)
- `/config logs toggle enabled:` — Enable or disable logging entirely
- `/config logs events [joins] [leaves] [edits] [deletes] [bans] [nicknames] [roles] [commands]` — Toggle individual log types, including **every slash command members use**
- `/config logs ignore channel:` — Stop message logs for one channel
- `/config logs view` — View current log settings

Per-category channels (member/message/voice/server/command) can be set individually from the Web Dashboard.

**Message delete logs** try to show who deleted a message and why (via the Discord audit log) — a moderator/bot deletion shows the deleter and their reason; no match usually just means the author deleted it themselves (Discord doesn't log self-deletes). Also shows attachments and when the message was sent, and bulk deletions (`/purge`, spam auto-purges) now get their own log entry instead of vanishing silently.

**Member leave logs** show how long they'd been a member and every role they held, and distinguish a kick (shows who kicked them + reason) from a voluntary leave.

### 🚨 Spam Detection

Always active, no configuration needed. Auto-punishes (24-hour timeout + purge of the offender's last hour of messages, across every channel including voice-channel text chat) for:
- **Repeated messages** — the same message 4+ times within 10 seconds
- **Flood rate** — 8+ messages in 6 seconds regardless of content (a fast typer sending a few distinct messages won't trigger this)
- **Cross-channel image spam** — images/videos posted in 4+ channels within 30 seconds
- **Cross-channel message/link spam** — the identical message, or the identical link even if the wording around it changes per channel, posted in 3+ channels within 45 seconds — the fingerprint of a hijacked account or scam bot

Manage Messages holders skip the noisier rate/duplicate/image checks, but **not** the cross-channel message/link check — nothing legitimate posts the same thing across several channels, so no role is exempt from that one. This closes a real gap where a compromised staff account could spam scam links across the whole server undetected.

### Birthday System
- `/birthdayconfig channel [channel]` — Set the birthday announcement channel
- `/birthdayconfig toggle` — Enable or disable birthday announcements
- `/birthdayconfig view` — View current birthday config
- `/birthdayconfig delete user:` — Remove a user's birthday from the server

### Levels & XP
- `/levelconfig toggle` — Enable or disable the XP system
- `/levelconfig channel [channel]` — Set where level-up announcements are sent
- `/levelconfig xp min: max:` — Set the XP range awarded per message
- `/levelconfig message text:` — Customize the level-up announcement message
- `/levelconfig announce type:` — Set announcement style (channel, reply, or off)
- `/levelconfig background url:` — Set a custom background image for rank cards
- `/levelconfig roles add role: level:` — Add a role reward at a specific level
- `/levelconfig roles remove role:` — Remove a level role reward
- `/levelconfig roles list` — List all configured level role rewards
- `/levelconfig view` — View all level system settings

### Economy
- `/economyconfig currency name:` — Set the server currency name (e.g. "Gold")
- `/economyconfig starting amount:` — Set how many coins new members start with
- `/economyconfig daily amount:` — Set the `/daily` payout
- `/economyconfig weekly amount:` — Set the `/weekly` payout
- `/economyconfig monthly amount:` — Set the `/monthly` payout
- `/economyconfig yearly amount:` — Set the `/yearly` payout
- `/economyconfig work min: max:` — Set the `/work` payout range
- `/economyconfig view` — View all economy settings

### Reputation
- `/repconfig take user:` — Remove a reputation point from a user

### Roles
- `/rolesconfig self-assign add role:` — Add a self-assignable role
- `/rolesconfig self-assign remove role:` — Remove a self-assignable role
- `/rolesconfig self-assign list` — List self-assignable roles
- `/rolesconfig auto add role: [trigger]` — Add an auto-role on member join
- `/rolesconfig auto remove role:` — Remove an auto-role
- `/rolesconfig auto list` — List auto-roles
- `/rolesconfig voice add role: channel:` — Assign a role while in a voice channel
- `/rolesconfig voice remove role:` — Remove a voice role
- `/rolesconfig voice list` — List voice roles
- `/rolesconfig reaction add role: message: emoji:` — Set up a reaction role
- `/rolesconfig reaction remove` — Remove a reaction role
- `/rolesconfig reaction clear` — Clear all reaction roles from a message
- `/rolesconfig reaction list` — List all reaction roles
- `/rolesconfig bulk roles:` — Assign multiple roles to a member at once

### Verification Gate
- `/verify setup channel: member_role: [unverified_role] [title] [description]` — Post a verification button in a channel; members click it to receive their member role

### Guessing Games
- `/mediaguess setup type: channel:` — Set up a movie, TV show, video game, or song game in a channel (starts the first round immediately). Video game needs `RAWG_API_KEY` set; songs need no key at all.
- `/mediaguess stop` — Stop the game in the current channel and remove its config
- `/mediaguess skip` — Force-skip the current round without needing 2 votes
- `/mediaguess info` — View all four configured channels and their current round status

### Server Features
- `/config` — Configure server-wide features (free games platforms, stat channels, and more)

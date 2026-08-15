# Fight Pool — live, auto-updating standings

A tiny setup that runs from **your laptop** and a **free** host (GitHub Pages).
You enter everyone's picks once. During the event, a script pulls each result
(winner **and** finishing round) straight from ESPN and pushes it live, so your
12 people just watch the standings move at a public link. No server, no API key,
no monthly cost.

## What's in this folder

| File | What it is |
|------|------------|
| `index.html` | The public standings page. Auto-refreshes every 30s. |
| `config.json` | The event: fighters, odds, players, and everyone's picks. **You edit this.** |
| `results.json` | Winners + rounds. **The script writes this — you don't touch it.** |
| `update.mjs` | The scraper. Pulls ESPN results, writes `results.json`, pushes to the site. |
| `sample-espn.json` | A saved ESPN response for offline testing (`--file`). |

---

## One-time setup (about 15 minutes, once ever)

1. **Install the two free tools** on your laptop, if you don't have them:
   - [Node.js](https://nodejs.org) (version 18 or newer) — runs the script.
   - [Git](https://git-scm.com) — pushes updates. (Or install **GitHub Desktop**, which includes it.)

2. **Make a free GitHub account** at github.com if you don't have one.

3. **Create a repository** (call it e.g. `fight-pool`), set it **Public**, and put
   these files in it. Easiest with GitHub Desktop: *File → New repository*, then drag
   these files into the folder it makes, and click **Publish**.

4. **Turn on GitHub Pages:** in the repo on github.com go to **Settings → Pages**,
   set *Source* to **Deploy from a branch**, branch **main**, folder **/(root)**, Save.
   After a minute your public URL appears — it looks like
   `https://YOURNAME.github.io/fight-pool/`. **That's the link you share.**

5. **Let git push without a password:** run `gh auth login` (comes with the GitHub CLI)
   once, or just use GitHub Desktop, which handles this for you.

---

## Before each event

1. **Build the picks.** Open the **setup tool** (`fight-pool.html` — the one that lets
   you type in the card, odds, and each person's picks). When it's filled in, click
   **Export data (JSON)** and save the file as `config.json` here, replacing the old one.

2. **Set the event date.** Open `config.json` and set:
   - `"espnDate"` to the event date as `YYYYMMDD` (e.g. `"20261017"`).
   - `"espnLeague"` stays `"ufc"` (use `"pfl"` or `"bellator"` for those).

3. **Test the name matching** (do this the day before — it's the one thing that can trip up):
   ```
   node update.mjs --dry
   ```
   It prints each fight with the winner it *would* record. Any fight it can't find on
   the ESPN card is listed at the bottom. If a fighter's spelling differs from ESPN,
   add an override in that fight inside `config.json`:
   ```json
   { "a": "Idris", "b": "Morales", "mlA": -500, "mlB": 375, "espnA": "Idiris" }
   ```
   (`espnA` / `espnB` are optional and only needed when a name doesn't match.)

4. **Push the config** so the site has the card and picks (GitHub Desktop → Commit → Push,
   or `git add -A && git commit -m "event setup" && git push`).

---

## On fight night

Run this and leave it going:

```
node update.mjs --loop
```

It checks ESPN every 3 minutes, writes any new results, and pushes them — your site
updates within about a minute each time. Share the GitHub Pages URL and you're done.
Press **Ctrl+C** to stop it when the card's over.

Handy flags:
- `node update.mjs` — run a single update now.
- `node update.mjs --dry` — show what it sees without writing or pushing.
- `node update.mjs --date 20261017` — override the date for one run.
- `node update.mjs --every 120` — loop every 120 seconds instead of 180.
- `node update.mjs --file sample-espn.json --dry` — test parsing offline.

---

## Good to know

- **Scoring:** a win is worth **3 × the fighter's multiplier**. A finish adds a **round
  bonus (also × multiplier)** that starts at 3 for a round-1 finish and tapers linearly to
  0 at the final bell — so it's round-count aware: a 3-round fight pays **3 / 2 / 1**
  (R1/R2/R3); a 5-round title fight pays **3 / 2.4 / 1.8 / 1.2 / 0.6** (R1–R5). Decisions
  score 0. The scraper reads scheduled rounds straight from ESPN (`format.regulation.periods`
  — 5 for a title/main event, else 3), so title fights are detected automatically. Tune
  `winMode` and `maxBonus` in `config.json`.
- **Name matching is fuzzy** (it caught "Idris" vs ESPN's "Idiris" automatically) but the
  `--dry` check + `espnA`/`espnB` overrides are your safety net for oddball spellings.
- **Be gentle on ESPN:** the 3-minute default is polite; don't hammer it with a tiny
  interval. This uses ESPN's public (undocumented) feed — fine for a personal pool.
- **No GitHub?** You can still run everything locally and open `index.html` yourself, but
  other people won't see it without a host. GitHub Pages is the free way to make it public.

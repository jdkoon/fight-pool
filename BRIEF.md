# FIGHT POOL — PROJECT BRIEF (context handoff)

Read this first in any new chat to get fully caught up. Account memory is OFF, so this
file IS the memory. Owner: John.

## What this is
An odds-weighted fantasy fight pool for **UFC 330 (Aug 15, 2026)**. People submit fight
picks via a Google Form; a public web scoreboard shows who picked whom and live,
odds-weighted standings that update from ESPN during the event.

## Links & IDs
- **Live scoreboard:** https://jdkoon.github.io/fight-pool/
- **Pick form (share this):** https://docs.google.com/forms/d/e/1FAIpQLSeWmsz5VWLvSilIsHYnuDQ9wzpX37rREQBvfBMxmuZPmdiVoA/viewform
- **GitHub repo (source of truth):** https://github.com/jdkoon/fight-pool  (public)
- **Form edit ID:** 1gU6PvtwleFcpSW9Z81lPJtKXxkT-Z3d1yJMUm_YMnus
- **Responses sheet ID:** 1cBzOkAuZ9h2---_QR-y8K6oYSaeMrlzxEKGFAIsq_-M
- **Apps Script project ID (holds the lock trigger):** 1SY2WlTeCaQxk5-EQ3BjSMkB22iJUnOrCifHRrs-i9UDZ6Q7pqgIP0Yk2

## Accounts (owner's; NO passwords are ever stored)
- GitHub: **jdkoon**
- Google: **jdkoon66@gmail.com**

## Architecture (how it all fits)
- Static site on **GitHub Pages** (`index.html`) reads two files from the repo:
  - `config.json` — event, roster, the 12 fights (fighter names + American moneylines + scheduled rounds), scoring settings, `lockISO`, `formUrl`.
  - `results.json` — winner + finishing round per fight (auto-filled from ESPN).
- `update.mjs` — Node scraper: pulls ESPN MMA results, fuzzy-matches fighters to the card, writes `results.json`.
- `.github/workflows/update.yml` — GitHub Action that runs `update.mjs` on a schedule and commits results (no laptop needed; uses the repo's built-in token).
- `fight-pool.html` — standalone setup tool (enter card/odds/picks, export config.json).
- Picks come from the Google Form → responses sheet. Picks are NOT auto-synced to the
  scoreboard; a person (Claude) converts responses → `config.json` picks and pushes.

## Scoring (verified against John's original spreadsheet)
- multiplier = 1 / (2 × impliedProbability) from American moneyline. ml 0 ⇒ multiplier 1.0.
- **Win** = 3 × multiplier.
- **Round-finish bonus** = maxBonus(3) × (N − r + 1)/N × multiplier, where N = scheduled
  rounds (5 for title/main-event fights, else 3), r = finishing round. Decision / going the
  distance = 0 bonus. (3-round: 3/2/1; 5-round: 3/2.4/1.8/1.2/0.6.)
- Underdogs pay more; early finishes pay more; both weighted by the same multiplier.

## The 5 PM lock
- An Apps Script **time-based trigger** (in the Apps Script project above) runs function
  `lockForm` at **2026-08-15T17:00:00-04:00** (5:00 PM ET) → sets the form to stop
  accepting responses. Verified as active.
- Belt-and-suspenders: when converting picks, only count responses with a Timestamp
  **before 5:00 PM ET**; keep each person's LATEST pre-deadline submission (drop dupes).

## Roster (10 people)
Tyler, Ian, Bobby, Logan, Nick, John, Diaz, Ben, Matt, Gerry.
(Form "Who are you?" is a dropdown of exactly these 10.)

## The card (config.json fight order; A vs B, mlA/mlB, rounds)
1. Islam Makhachev (-350) vs Ian Machado Garry (+275) — 5R (title)
2. Mackenzie Dern (-220) vs Gillian Robertson (+180) — 5R (title)
3. Jalin Turner (-160) vs Kaue Fernandes (+135) — 3R
4. Mansur Abdul-Malik (-650) vs Dustin Stoltzfus (+475) — 3R
5. Edson Barboza (+425) vs Esteban Ribovics (-575) — 3R
6. Chidi Njokuani (+235) vs Joel Alvarez (-300) — 3R
7. Charles Johnson (-120) vs Eduardo Chapolin (+100) — 3R  [real odds locked in 8/15]
8. Donte Johnson (-340) vs Eric McConico (+195) — 3R
9. Vicente Luque (+100) vs Tresean Gore (-120) — 3R
10. Rafael Tobias (+240) vs Lucas Fernando (-300) — 3R
11. Neil Magny (+110) vs Ramiz Brahimaj (-130) — 3R
12. Jeremiah Wells (+600) vs Myktybek Orolbai (-900) — 3R

## Status / TODO (as of 8/15, pre-event — everything DONE)
- [x] Scoreboard hosted, mobile, styled.
- [x] Google Form built + published + responses sheet linked. **Form is now CLOSED** (not accepting responses).
- [x] **Picks are LOCKED & LOADED** — all 10 players' picks in config.json. Hard lock via `config.locked=true` (site shows "PICKS ARE LOCKED" regardless of clock). `lockISO` still 2026-08-15T17:00:00-04:00 for reference. Apps Script 5PM trigger left armed (redundant now; harmless).
- [x] **GitHub Action live-results updater** confirmed green and running every 5 min. `update.mjs` now writes/commits ONLY when a fight result actually changes (no idle churn / no wasted Pages rebuilds).
- [x] Charles Johnson/Chapolin real odds locked: -120 / +100.

### ⚠️ MANUAL PICK OVERRIDES (NOT on the Google Form — re-apply if you ever rebuild picks from the sheet!)
- **Tyler → fight index 7 (Donte Johnson vs McConico) = "a" (Donte Johnson)** — Tyler left this blank on the form; texted it in.
- **Matt → fight index 3 (Abdul-Malik vs Stoltzfus) = "a" (Mansur Abdul-Malik)** — changed from his form pick (Stoltzfus) by text.
If you re-run any responses→config converter, these two get wiped back to form values — set them again.

## Humor / features on the scoreboard (index.html, all state-driven & auto-updating every 30s)
- KPI label "Bozos" (was Degenerates). Leader tile: "TBD, chumps" pre-scoring / "Logjam (n)" on tie / champ name.
- **10-tier rank titles** ladder per row: 👑 Undisputed Champ → … → 🤡 You're Dogshit (rank 10); 🧊 Stone Cold Zero for winless.
- **🧊 Cooler of the Night** tile (auto-roasts last place).
- **📢 Live From the Cage** feed — one line per resolved fight (UPSET + draw call-outs, who nailed/missed).
- **🎙️ Ringside Mic** announcer above the leaderboard — narrates hype→breakdown→final crowning.
- **Confetti** on lead change. **THE SLIPS** grid: green ✓ / red ✗ strikethrough per pick, live.

## How to make changes
Message Claude what you want. Claude edits the files and pushes to the repo. The push
currently goes through **Chrome on John's computer** (logged into GitHub) — so keep the
computer on + Chrome + the Claude desktop app running for changes to go live. Data-only
tweaks (leader text, taglines, event name, scoring numbers, lock time) are quick edits to
`config.json` / `index.html`.

## Known quirks
- Two Johnsons on the card (Charles vs Chapolin, Donte vs McConico) — disambiguated by opponent in the scraper's name matching.
- `update.mjs` uses fuzzy name matching (handles ESPN spelling like "Idiris" vs "Idris"); run `node update.mjs --dry` to preview matches before the event.

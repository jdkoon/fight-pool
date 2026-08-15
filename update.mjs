#!/usr/bin/env node
/*
  Fight Pool auto-updater
  -----------------------
  Reads config.json, pulls live results from ESPN's free MMA feed, writes
  results.json (winner + finishing round per fight), then git-commits & pushes
  so your GitHub Pages site updates itself.

  Usage:
    node update.mjs               # run once, write + push
    node update.mjs --loop        # keep running (default every 180s), push on changes
    node update.mjs --dry         # fetch + print parsed results, DO NOT write or push
    node update.mjs --no-push     # write results.json but do not git push
    node update.mjs --date 20250816   # override the event date (YYYYMMDD)
    node update.mjs --every 120   # loop interval in seconds (with --loop)

  Requires Node 18+ (built-in fetch). No API key needed.
*/

import fs from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG = path.join(__dirname, "config.json");
const RESULTS = path.join(__dirname, "results.json");

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };

const DRY = has("--dry");
const NO_PUSH = has("--no-push") || DRY;
const LOOP = has("--loop");
const EVERY = Number(val("--every", "180")) * 1000;

function log(...a) { console.log(new Date().toLocaleTimeString(), ...a); }

function loadConfig() {
  const c = JSON.parse(fs.readFileSync(CONFIG, "utf8"));
  c.espnLeague = c.espnLeague || "ufc";
  return c;
}

// Normalize a name for loose matching (lowercase, strip accents/punctuation/spaces)
function norm(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z]/g, "");
}
// Levenshtein edit distance for fuzzy name matching
function lev(a, b) {
  a = a || ""; b = b || "";
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const dp = Array.from({ length: m + 1 }, (_, i) => { const r = new Array(n + 1).fill(0); r[0] = i; return r; });
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[m][n];
}
// similarity 0..1 between a config fighter name and an ESPN athlete
function sim(configName, athlete) {
  const cn = norm(configName); if (!cn) return 0;
  const last = norm(athlete.lastName);
  const full = norm(athlete.fullName || athlete.displayName);
  if (last && (last === cn || last.includes(cn) || cn.includes(last))) return 1;
  if (full && full.includes(cn)) return 0.95;
  let best = 0;
  for (const c of [last, full].filter(Boolean)) {
    const s = 1 - lev(cn, c) / Math.max(cn.length, c.length);
    if (s > best) best = s;
  }
  return best;
}
// find the ESPN competition that best matches a fight, with fighter->side assignment
function bestCompetitionFor(f, comps) {
  const aName = f.espnA || f.a, bName = f.espnB || f.b;
  let best = null;
  for (const c of comps) {
    const cs = c.competitors || [];
    if (cs.length < 2) continue;
    const x = cs[0].athlete || {}, y = cs[1].athlete || {};
    // score each assignment by the WEAKER of the two sides (both must match)
    const opt1 = Math.min(sim(aName, x), sim(bName, y)); // a->0, b->1
    const opt2 = Math.min(sim(aName, y), sim(bName, x)); // a->1, b->0
    const score = Math.max(opt1, opt2);
    const assign = opt1 >= opt2 ? { aC: cs[0], bC: cs[1] } : { aC: cs[1], bC: cs[0] };
    if (!best || score > best.score) best = { score, comp: c, assign };
  }
  return best;
}
const MATCH_THRESHOLD = 0.6; // fighters this similar or better are treated as the same person

// ESPN puts the method in details[].type.text ("Unofficial Winner Decision",
// "Unofficial Winner Submission", "Unofficial Winner KO/TKO"). status.type.detail
// is only "Final", so we must read details[] to know decision vs finish.
function methodText(comp) {
  const ds = comp.details || [];
  for (const d of ds) {
    const t = (d?.type?.text || d?.text || "").toString();
    if (/decision|submission|ko\/tko|tko|\bko\b|draw|no contest|\bdq\b|disqualif/i.test(t)) {
      return t.replace(/unofficial winner\s*/i, "").trim();
    }
  }
  return (comp.status?.type?.detail || "").toString();
}
// Turn ESPN result into { round, method } where round is "DEC" or "1".."5".
// IMPORTANT: only award a finishing round for an EXPLICIT finish (KO/TKO/Submission).
// If the method isn't yet known (ESPN often posts the winner a beat before the
// method detail, leaving only "Final"), we conservatively return DEC so a decision
// is never briefly scored as a round finish (phantom bonus). It self-corrects to the
// real round on the next poll once ESPN posts the method.
function parseFinish(comp) {
  const st = comp.status || {};
  let period = Number(st.period);
  if (!period || isNaN(period)) period = null;
  const method = methodText(comp) || "Final";
  const isFinish = /ko\/tko|tko|\bko\b|submission|\bsub\b|technical submission/i.test(method);
  if (isFinish && period && period >= 1 && period <= 5) return { round: String(period), method };
  // decision, draw/NC, DQ, or method-not-yet-known => no finish bonus
  return { round: "DEC", method };
}

async function fetchScoreboard(league, date) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/mma/${league}/scoreboard?dates=${date}`;
  const r = await fetch(url, { headers: { "User-Agent": "fight-pool/1.0" } });
  if (!r.ok) throw new Error(`ESPN ${r.status} ${r.statusText}`);
  return r.json();
}

// Build a flat list of {names:[fullName..], competitors:[{athlete,winner}], status,...}
function competitionsFrom(sb) {
  const out = [];
  for (const ev of sb.events || []) {
    for (const comp of ev.competitions || []) {
      out.push(comp);
    }
  }
  return out;
}

function resolveResults(config, comps) {
  const out = {};
  const unmatched = [];
  config.fights.forEach((f, fi) => {
    const bc = bestCompetitionFor(f, comps);
    if (!bc || bc.score < MATCH_THRESHOLD) {
      out[fi] = { w: "", r: "DEC", method: "" };
      const near = bc ? ` (closest on card ~${Math.round(bc.score * 100)}%)` : "";
      unmatched.push(`${f.a} vs ${f.b}${near}`);
      return;
    }
    const comp = bc.comp;
    const completed = comp.status?.type?.completed;
    const aW = bc.assign.aC.winner === true;
    const bW = bc.assign.bC.winner === true;
    const conf = Math.round(bc.score * 100);
    // scheduled rounds from ESPN (5 = title/main event, else 3); clamp odd values
    const periods = Number(comp?.format?.regulation?.periods);
    const rounds = periods === 5 ? 5 : 3;
    if (!completed) {
      const o = { w: "", r: "DEC", method: "", conf, rounds };
      // mark a fight that's happening RIGHT NOW (ESPN state "in") for the LIVE NOW spotlight.
      // NOTE: we deliberately do NOT record the live round — the round changed every ~5 min,
      // and each change = a commit + Pages rebuild, which could push past the 10-builds/hour
      // soft limit during a busy prelim hour. Just the live flag keeps it to ~2 commits/fight.
      if (comp.status?.type?.state === "in") { o.live = true; }
      out[fi] = o; return;
    }
    if (!aW && !bW) {
      // completed but nobody won => draw / no contest. Record it as resolved (done)
      // so the site can show it instead of a permanent "TBD"; nobody scores.
      const m = methodText(comp) || "Draw";
      out[fi] = { w: "", r: "DEC", method: m, done: true, conf, rounds };
      return;
    }
    const fin = parseFinish(comp);
    out[fi] = { w: aW ? "a" : "b", r: fin.round, method: fin.method, done: true, conf, rounds };
  });
  return { results: out, unmatched };
}

function printTable(config, results) {
  const rd = (r) => (r.r === "DEC" ? "DEC" : "R" + r.r);
  console.log("\n  Fight".padEnd(34), "Winner".padEnd(14), "End", "  Method");
  console.log("  " + "-".repeat(70));
  config.fights.forEach((f, fi) => {
    const r = results[fi] || {};
    const wname = r.w === "a" ? f.a : r.w === "b" ? f.b : "— TBD —";
    const conf = (r.conf && r.conf < 100) ? ` ~${r.conf}%` : "";
    console.log("  " + `${f.a} vs ${f.b}`.padEnd(32), wname.padEnd(14), r.w ? rd(r) : "  ", " ", (r.method || "") + conf);
  });
  console.log("");
}

function writeResults(obj) {
  fs.writeFileSync(RESULTS, JSON.stringify(obj, null, 2));
}
function readResults() {
  try { return fs.readFileSync(RESULTS, "utf8"); } catch { return ""; }
}

function gitPush() {
  try {
    execSync("git rev-parse --is-inside-work-tree", { cwd: __dirname, stdio: "ignore" });
  } catch {
    log("⚠ Not a git repo — skipping push. (results.json was still written.)");
    return;
  }
  try {
    execSync("git add results.json", { cwd: __dirname, stdio: "ignore" });
    // commit only if there is something staged
    try { execSync("git diff --cached --quiet", { cwd: __dirname }); log("· no changes to push"); return; }
    catch { /* there are changes */ }
    execSync(`git commit -m "results update ${new Date().toISOString()}"`, { cwd: __dirname, stdio: "ignore" });
    execSync("git push", { cwd: __dirname, stdio: "ignore" });
    log("✔ pushed update to GitHub Pages");
  } catch (e) {
    log("⚠ git push failed:", e.message.split("\n")[0]);
  }
}

async function runOnce(config) {
  const date = val("--date", config.espnDate);
  const file = val("--file", null);
  let sb;
  if (file) {
    log(`Loading scoreboard from file ${file} …`);
    sb = JSON.parse(fs.readFileSync(file, "utf8"));
  } else {
    if (!date) { log("✖ No event date. Set espnDate in config.json (YYYYMMDD) or pass --date."); return; }
    log(`Fetching ${config.espnLeague.toUpperCase()} results for ${date} …`);
    sb = await fetchScoreboard(config.espnLeague, date);
  }
  const comps = competitionsFrom(sb);
  log(`ESPN returned ${comps.length} fights on the card.`);
  const { results, unmatched } = resolveResults(config, comps);
  printTable(config, results);
  if (unmatched.length) {
    log("⚠ Could not match these fights to the ESPN card (check spelling in config.json):");
    unmatched.forEach((u) => console.log("     - " + u));
  }
  const scored = Object.values(results).filter((r) => r.w).length;
  log(`${scored}/${config.fights.length} fights have a winner so far.`);
  if (DRY) { log("(dry run — nothing written or pushed)"); return; }
  // Only rewrite results.json when the actual fight data changed. generatedAt used to
  // change every run, which made the file churn every poll -> a commit + GitHub Pages
  // rebuild every 5 min (near the 10 builds/hr soft limit). Now we write only on a
  // real change, so commits/rebuilds happen only when a result actually moves.
  const before = readResults();
  let prevFights = null;
  try { prevFights = JSON.parse(before).fights; } catch { prevFights = null; }
  const changed = JSON.stringify(prevFights) !== JSON.stringify(results);
  if (!changed) {
    log("· results unchanged — not writing (no commit/rebuild)");
    if (!NO_PUSH) gitPush(); // no-op: nothing staged
    return;
  }
  const payload = { generatedAt: new Date().toISOString(), source: "espn", event: config.event, fights: results };
  writeResults(payload);
  log("✔ results changed — wrote results.json");
  if (!NO_PUSH) gitPush();
  else log("(--no-push: results.json written, not pushed)");
}

async function main() {
  const config = loadConfig();
  await runOnce(config);
  if (LOOP) {
    log(`Looping every ${EVERY / 1000}s — leave this running during the event. Ctrl+C to stop.`);
    setInterval(() => runOnce(loadConfig()).catch((e) => log("✖", e.message)), EVERY);
  }
}
main().catch((e) => { console.error("✖", e.message); process.exit(1); });

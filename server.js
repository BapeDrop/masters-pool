const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const ESPN_URL =
  "https://site.api.espn.com/apis/site/v2/sports/golf/leaderboard?league=pga";

// ---------------------------------------------------------------------------
// Pool entries – each player is keyed by ESPN athlete id
// ---------------------------------------------------------------------------
const PLAYERS = {
  3470: "McIlroy",
  10140: "Schauffele",
  9478: "Scheffler",
  9131: "C. Smith",
  3448: "D. Johnson",
  4375972: "Aberg",
  9126: "Conners",
  4848: "Thomas",
  10906: "Rai",
  4513: "Bradley",
  9780: "Rahm",
  5054388: "Bridgeman",
  9843: "Knapp",
  5539: "Fleetwood",
  10166: "Spaun",
  9530: "McNealy",
  5579: "Reed",
  8961: "Straka",
  10364: "Kitayama",
  569: "Rose",
  5409: "Henley",
  10592: "Morikawa",
  1225: "Harman",
  11382: "Im",
  91: "Couples",
  6798: "Koepka",
  4410932: "M.W. Lee",
  9037: "Fitzpatrick",
  10046: "DeChambeau",
  5860: "Matsuyama",
  4425906: "C. Young",
  5408: "English",
  4364873: "Hovland",
  8973: "Homa",
  11250: "N. Hojgaard",
  1680: "Day",
  4585549: "Penge",
  780: "Watson",
  3550: "Woodland",
  5217048: "Keefer",
  4837226: "Kataoka",
  11332: "Novak",
};

const ENTRIES = [
  { no: 1, name: "Bilodeau 1", players: [3470, 10140, 9478, 9131, 3448] },
  { no: 2, name: "Bilodeau 2", players: [4375972, 9126, 4848, 10906, 4513] },
  { no: 3, name: "Birdsall 1", players: [4375972, 9780, 10140, 5054388, 9843] },
  { no: 4, name: "Birdsall 2", players: [5539, 9780, 9478, 10166, 9530] },
  { no: 5, name: "Bowhead 1", players: [9478, 9780, 5579, 8961, 10364] },
  { no: 6, name: "Bowhead 2", players: [3470, 569, 5409, 5054388, 8961] },
  { no: 7, name: "Cloutier, A", players: [4375972, 10592, 569, 1225, 11382] },
  { no: 8, name: "Cloutier, K", players: [9478, 5539, 5579, 5054388, 91] },
  { no: 9, name: "Curtiss", players: [6798, 4410932, 9478, 5054388, 9530] },
  { no: 10, name: "Herbst", players: [9037, 5539, 9780, 10166, 8961] },
  { no: 11, name: "Khadduri 1", players: [10140, 9780, 9478, 8961, 11382] },
  { no: 12, name: "Khadduri 2", players: [10046, 5860, 4425906, 5408, 9530] },
  { no: 13, name: "Klapman", players: [4375972, 3470, 4364873, 9131, 11382] },
  { no: 14, name: "Makin", players: [10046, 3470, 9478, 10166, 11332] },
  { no: 15, name: "Rines 1", players: [10046, 9780, 9037, 9131, 8973] },
  { no: 16, name: "Rines 2", players: [9478, 9780, 5860, 9131, 4513] },
  { no: 17, name: "Rouse, T", players: [4375972, 9037, 10046, 9131, 10166] },
  { no: 18, name: "Rouse, C", players: [9478, 9780, 3470, 11250, 10364] },
  { no: 19, name: "Webster 1", players: [4375972, 9780, 4364873, 5054388, 4513] },
  { no: 20, name: "Webster 2", players: [9478, 9780, 10046, 5054388, 4513] },
  { no: 21, name: "Belleau", players: [10046, 9478, 780, 3550, 91] },
  { no: 22, name: "Matthews", players: [10046, 9478, 5539, 10166, 91] },
  { no: 23, name: "AC", players: [10046, 1680, 10592, 4585549, 10906] },
  { no: 24, name: "AC", players: [9478, 569, 4364873, 5217048, 4837226] },
];

// ---------------------------------------------------------------------------
// ESPN data fetching
// ---------------------------------------------------------------------------

let scoreCache = { data: null, ts: 0 };
const CACHE_TTL = 2 * 60 * 1000; // 2 minutes

function parseScore(score) {
  // ESPN returns score as either a string ("-3", "E") on /scoreboard
  // or an object {value: <total strokes>, displayValue: "-12"} on /leaderboard.
  // We always want the to-par, which is the displayValue.
  if (score && typeof score === "object") {
    return parseScore(score.displayValue);
  }
  if (!score || score === "E" || score === "-") return 0;
  const n = parseInt(score, 10);
  return Number.isNaN(n) ? 0 : n;
}

async function getScores() {
  if (scoreCache.data && Date.now() - scoreCache.ts < CACHE_TTL) {
    return scoreCache.data;
  }

  try {
    const res = await fetch(ESPN_URL);
    if (!res.ok) throw new Error(`ESPN ${res.status}`);
    const data = await res.json();

    // Find the Masters event
    const mastersEvent = data.events?.find((e) =>
      e.name?.toLowerCase().includes("masters")
    );

    if (!mastersEvent) {
      // Fallback: use first event if it's tournament week
      const result = {
        event: "Masters Tournament",
        status: "pre",
        currentRound: 0,
        players: {},
      };
      scoreCache = { data: result, ts: Date.now() };
      return result;
    }

    const eventStatus = mastersEvent.status?.type || {};
    const comp = mastersEvent.competitions?.[0];
    const competitors = comp?.competitors || [];
    const compPeriod = comp?.status?.period || 0;

    // A round linescore is "real" only if ESPN has populated a meaningful
    // displayValue ("E", "-3", "+1", …). Rounds not yet started come back
    // with value=0 and displayValue="-".
    function isRealRound(linescore) {
      if (!linescore) return false;
      const dv = linescore.displayValue;
      if (dv === "-" || dv === undefined || dv === null) return false;
      return true;
    }

    const result = {
      event: mastersEvent.name || "Masters Tournament",
      status: eventStatus.state || "pre", // "pre", "in", "post"
      statusDesc: eventStatus.description || "",
      currentRound: compPeriod,
      players: {},
    };

    for (const c of competitors) {
      const id = c.id;
      const linescores = c.linescores || [];
      const toPar = parseScore(c.score);

      const R1 = isRealRound(linescores[0]) ? linescores[0].value : null;
      const R2 = isRealRound(linescores[1]) ? linescores[1].value : null;
      const R3 = isRealRound(linescores[2]) ? linescores[2].value : null;
      const R4 = isRealRound(linescores[3]) ? linescores[3].value : null;

      // Trust ESPN's per-player status — the leaderboard endpoint exposes
      // STATUS_CUT / STATUS_WITHDRAWN / STATUS_DISQUALIFIED directly.
      const espnStatusName = c.status?.type?.name || "";
      const numCompleted = linescores.filter(isRealRound).length;

      let status = "active";
      if (espnStatusName === "STATUS_CUT") {
        status = "MC";
      } else if (espnStatusName === "STATUS_WITHDRAWN") {
        status = "WD";
      } else if (espnStatusName === "STATUS_DISQUALIFIED") {
        status = "DQ";
      } else if (result.status === "pre" || numCompleted === 0) {
        status = "pre";
      }

      // Thru: ESPN provides this directly on the leaderboard endpoint
      let thru = null;
      if (status === "active") {
        thru = c.status?.thru ?? null;
      }

      result.players[id] = {
        name: c.athlete?.fullName || PLAYERS[id] || `ID:${id}`,
        shortName: PLAYERS[id] || c.athlete?.shortName || c.athlete?.fullName,
        toPar,
        status,
        R1, R2, R3, R4,
        thru,
        round: numCompleted,
      };
    }

    scoreCache = { data: result, ts: Date.now() };
    return result;
  } catch (err) {
    console.error("Error fetching ESPN:", err.message);
    return { event: "Masters Tournament", status: "pre", currentRound: 0, players: {} };
  }
}

// ---------------------------------------------------------------------------
// Scoring logic
// ---------------------------------------------------------------------------

/**
 * Rules:
 * - Lowest cumulative score (to par) wins
 * - MC: R1+R2 count again as R3+R4 → pool score = 2× their to-par
 * - WD/DQ: team ineligible
 */
function calcEntryScore(entry, scores) {
  let totalToPar = 0;
  let hasWdDq = false;
  let allPre = true;
  const playerScores = [];

  for (const espnId of entry.players) {
    const s = scores.players[espnId];
    const displayName = PLAYERS[espnId] || `ID:${espnId}`;

    if (!s || s.status === "pre") {
      playerScores.push({
        espnId,
        name: displayName,
        toPar: null,
        status: "pre",
        R1: null, R2: null, R3: null, R4: null,
        thru: null,
        poolScore: null,
      });
      continue;
    }

    allPre = false;

    if (s.status === "WD" || s.status === "DQ") {
      hasWdDq = true;
      playerScores.push({
        espnId,
        name: displayName,
        toPar: s.toPar,
        status: s.status,
        R1: s.R1, R2: s.R2, R3: s.R3, R4: s.R4,
        thru: s.thru,
        poolScore: null,
      });
      continue;
    }

    if (s.status === "MC") {
      const poolScore = s.toPar * 2;
      totalToPar += poolScore;
      playerScores.push({
        espnId,
        name: displayName,
        toPar: s.toPar,
        status: "MC",
        R1: s.R1, R2: s.R2, R3: s.R1, R4: s.R2,
        thru: "MC",
        poolScore,
      });
      continue;
    }

    // Active or finished
    totalToPar += s.toPar;
    playerScores.push({
      espnId,
      name: displayName,
      toPar: s.toPar,
      status: "active",
      R1: s.R1, R2: s.R2, R3: s.R3, R4: s.R4,
      thru: s.thru,
      poolScore: s.toPar,
    });
  }

  return {
    no: entry.no,
    name: entry.name,
    totalToPar: allPre ? null : totalToPar,
    hasWdDq,
    allPre,
    players: playerScores,
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/leaderboard", async (req, res) => {
  try {
    const scores = await getScores();
    const results = ENTRIES.map((e) => calcEntryScore(e, scores));

    // Sort: eligible by score ASC, then ineligible, then pre
    results.sort((a, b) => {
      if (a.allPre && !b.allPre) return 1;
      if (!a.allPre && b.allPre) return -1;
      if (a.allPre && b.allPre) return a.no - b.no;
      if (a.hasWdDq && !b.hasWdDq) return 1;
      if (!a.hasWdDq && b.hasWdDq) return -1;
      if (a.totalToPar === null && b.totalToPar === null) return a.no - b.no;
      if (a.totalToPar === null) return 1;
      if (b.totalToPar === null) return -1;
      return a.totalToPar - b.totalToPar;
    });

    // Assign ranks
    let rank = 1;
    for (let i = 0; i < results.length; i++) {
      if (results[i].hasWdDq || results[i].allPre) {
        results[i].rank = null;
      } else {
        if (
          i > 0 &&
          !results[i - 1].hasWdDq &&
          !results[i - 1].allPre &&
          results[i].totalToPar === results[i - 1].totalToPar
        ) {
          results[i].rank = results[i - 1].rank;
        } else {
          results[i].rank = rank;
        }
        rank = i + 1 + 1;
      }
    }

    res.json({
      event: scores.event,
      status: scores.status,
      currentRound: scores.currentRound,
      lastUpdated: new Date().toISOString(),
      pot: 240,
      payouts: { first: 144, second: 72, third: 24 },
      entries: results,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Masters Pool leaderboard running at http://localhost:${PORT}`);
});

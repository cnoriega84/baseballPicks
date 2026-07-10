const MLB_API_BASE = 'https://statsapi.mlb.com/api/v1';

const state = {
  payload: null,
  analysis: [],
  cache: new Map()
};

const TEAM_ABBREV = {
  108: 'LAA', 109: 'ARI', 110: 'BAL', 111: 'BOS', 112: 'CHC', 113: 'CIN',
  114: 'CLE', 115: 'COL', 116: 'DET', 117: 'HOU', 118: 'KC', 119: 'LAD',
  120: 'WSH', 121: 'NYM', 133: 'ATH', 134: 'PIT', 135: 'SD', 136: 'SEA',
  137: 'SF', 138: 'STL', 139: 'TB', 140: 'TEX', 141: 'TOR', 142: 'MIN',
  143: 'PHI', 144: 'ATL', 145: 'CWS', 146: 'MIA', 147: 'NYY', 158: 'MIL'
};

const LEAGUE = {
  avg: 0.245,
  obp: 0.315,
  slg: 0.395,
  ops: 0.710,
  runsPerGame: 4.4,
  era: 4.20,
  whip: 1.28,
  k9: 8.4,
  bb9: 3.1,
  hr9: 1.1
};

const GRADE_ORDER = {
  'A+': 12,
  A: 11,
  'A-': 10,
  'B+': 9,
  B: 8,
  'B-': 7,
  'C+': 6,
  C: 5,
  'C-': 4,
  D: 3,
  F: 1
};

const $ = (sel) => document.querySelector(sel);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const fmtPct = (p) => `${(Number(p || 0) * 100).toFixed(1)}%`;
const fmtNum = (n, digits = 2) => Number.isFinite(Number(n)) ? Number(n).toFixed(digits) : '—';

function numberFrom(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(String(value).replace('%', ''));
  return Number.isFinite(n) ? n : fallback;
}

function todayPacific() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

function currentSeasonForDate(dateString) {
  const year = Number(String(dateString || todayPacific()).slice(0, 4));
  return Number.isFinite(year) ? year : new Date().getFullYear();
}

function setDefaultDate() {
  $('#dateInput').value = todayPacific();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function teamAbbrev(team = {}) {
  if (team.abbreviation) return team.abbreviation;
  if (TEAM_ABBREV[team.id]) return TEAM_ABBREV[team.id];
  return String(team.name || 'TBD')
    .split(/\s+/)
    .map((word) => word[0])
    .join('')
    .slice(0, 4)
    .toUpperCase();
}

function cleanStartTime(value) {
  if (!value) return 'Time TBD';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Time TBD';
  return parsed.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function compactStartTime(value) {
  if (!value) return 'Time TBD';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Time TBD';
  return parsed.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function gameTimeMs(game) {
  const ms = Date.parse(game.startTime || '');
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
}

function gradeValue(grade) {
  return GRADE_ORDER[String(grade || '').toUpperCase()] || 0;
}

function gradeClass(grade) {
  return `grade-${String(grade || 'na')
    .toLowerCase()
    .replace('+', '-plus')
    .replace('-', '-minus')
    .replace(/[^a-z0-9-]/g, '')}`;
}

function isFinalStatus(status = '') {
  return /final|completed|game over/.test(status.toLowerCase());
}

function isLiveStatus(status = '') {
  return /live|progress|inning|warmup|delayed|suspended|review/.test(status.toLowerCase());
}

function timeBucket(game) {
  const status = String(game.status || '');
  if (isFinalStatus(status)) return 'FINAL';
  if (isLiveStatus(status)) return 'LIVE';
  if (!game.startTime || !Number.isFinite(gameTimeMs(game))) return 'TBD';
  return gameTimeMs(game) >= Date.now() ? 'UPCOMING' : 'FINAL';
}

function updateDataStatus(message, detail = '') {
  const mode = $('#dataMode');
  const count = $('#dataCount');
  if (mode) mode.textContent = message;
  if (count) count.textContent = detail;
}

async function fetchJson(url, cacheKey = url) {
  if (state.cache.has(cacheKey)) return state.cache.get(cacheKey);
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`MLB data request failed (${response.status})`);
  const json = await response.json();
  state.cache.set(cacheKey, json);
  return json;
}

function statFromResponse(json) {
  return json?.stats?.[0]?.splits?.[0]?.stat || {};
}

async function fetchSchedule(date) {
  const url = `${MLB_API_BASE}/schedule?sportId=1&date=${encodeURIComponent(date)}&hydrate=team,probablePitcher,venue,linescore`;
  const json = await fetchJson(url, `schedule:${date}`);
  return json?.dates?.flatMap((entry) => entry.games || []) || [];
}

async function fetchTeamStats(teamId, season) {
  const fallback = {
    hitting: { ...LEAGUE, source: 'fallback' },
    pitching: { era: LEAGUE.era, whip: LEAGUE.whip, source: 'fallback' },
    quality: 0
  };

  if (!teamId) return fallback;

  const [hittingResult, pitchingResult] = await Promise.allSettled([
    fetchJson(`${MLB_API_BASE}/teams/${teamId}/stats?stats=season&group=hitting&season=${season}`, `team:${teamId}:hitting:${season}`),
    fetchJson(`${MLB_API_BASE}/teams/${teamId}/stats?stats=season&group=pitching&season=${season}`, `team:${teamId}:pitching:${season}`)
  ]);

  const rawHitting = hittingResult.status === 'fulfilled' ? statFromResponse(hittingResult.value) : {};
  const rawPitching = pitchingResult.status === 'fulfilled' ? statFromResponse(pitchingResult.value) : {};
  const hittingGames = numberFrom(rawHitting.gamesPlayed, 0);
  const pitchingGames = numberFrom(rawPitching.gamesPlayed, 0);

  const hitting = {
    avg: numberFrom(rawHitting.avg, LEAGUE.avg),
    obp: numberFrom(rawHitting.obp, LEAGUE.obp),
    slg: numberFrom(rawHitting.slg, LEAGUE.slg),
    ops: numberFrom(rawHitting.ops, LEAGUE.ops),
    runs: numberFrom(rawHitting.runs, 0),
    games: hittingGames,
    runsPerGame: hittingGames ? numberFrom(rawHitting.runs, 0) / hittingGames : LEAGUE.runsPerGame,
    source: hittingResult.status === 'fulfilled' ? 'live' : 'fallback'
  };

  const pitching = {
    era: numberFrom(rawPitching.era, LEAGUE.era),
    whip: numberFrom(rawPitching.whip, LEAGUE.whip),
    games: pitchingGames,
    source: pitchingResult.status === 'fulfilled' ? 'live' : 'fallback'
  };

  return {
    hitting,
    pitching,
    quality: (hitting.source === 'live' ? 1 : 0) + (pitching.source === 'live' ? 1 : 0)
  };
}

async function fetchPitcherStats(pitcherId, season) {
  if (!pitcherId) {
    return {
      era: LEAGUE.era,
      whip: LEAGUE.whip,
      k9: LEAGUE.k9,
      bb9: LEAGUE.bb9,
      hr9: LEAGUE.hr9,
      games: 0,
      source: 'fallback'
    };
  }

  try {
    const json = await fetchJson(`${MLB_API_BASE}/people/${pitcherId}/stats?stats=season&group=pitching&season=${season}`, `pitcher:${pitcherId}:${season}`);
    const raw = statFromResponse(json);
    return {
      era: numberFrom(raw.era, LEAGUE.era),
      whip: numberFrom(raw.whip, LEAGUE.whip),
      k9: numberFrom(raw.strikeoutsPer9Inn, LEAGUE.k9),
      bb9: numberFrom(raw.walksPer9Inn, LEAGUE.bb9),
      hr9: numberFrom(raw.homeRunsPer9, LEAGUE.hr9),
      games: numberFrom(raw.gamesPlayed, 0),
      source: raw?.era ? 'live' : 'fallback'
    };
  } catch (err) {
    return {
      era: LEAGUE.era,
      whip: LEAGUE.whip,
      k9: LEAGUE.k9,
      bb9: LEAGUE.bb9,
      hr9: LEAGUE.hr9,
      games: 0,
      source: 'fallback'
    };
  }
}

function normalizeScheduleGame(rawGame) {
  const awayTeam = rawGame?.teams?.away?.team || {};
  const homeTeam = rawGame?.teams?.home?.team || {};
  const awayPitcher = rawGame?.teams?.away?.probablePitcher || null;
  const homePitcher = rawGame?.teams?.home?.probablePitcher || null;

  return {
    gamePk: rawGame.gamePk,
    status: rawGame?.status?.detailedState || rawGame?.status?.abstractGameState || 'Preview',
    startTime: rawGame.gameDate || '',
    venue: rawGame?.venue?.name || 'Venue TBD',
    matchup: `${teamAbbrev(awayTeam)} @ ${teamAbbrev(homeTeam)}`,
    away: {
      id: awayTeam.id,
      name: awayTeam.name || 'Away Team',
      abbrev: teamAbbrev(awayTeam),
      score: rawGame?.teams?.away?.score,
      starter: awayPitcher ? { id: awayPitcher.id, name: awayPitcher.fullName || awayPitcher.name } : { id: null, name: 'Starter TBD' }
    },
    home: {
      id: homeTeam.id,
      name: homeTeam.name || 'Home Team',
      abbrev: teamAbbrev(homeTeam),
      score: rawGame?.teams?.home?.score,
      starter: homePitcher ? { id: homePitcher.id, name: homePitcher.fullName || homePitcher.name } : { id: null, name: 'Starter TBD' }
    }
  };
}

function offenseStrength(team) {
  const hit = team.hittingStats || {};
  return ((numberFrom(hit.ops, LEAGUE.ops) - LEAGUE.ops) * 26)
    + ((numberFrom(hit.obp, LEAGUE.obp) - LEAGUE.obp) * 30)
    + ((numberFrom(hit.slg, LEAGUE.slg) - LEAGUE.slg) * 18)
    + ((numberFrom(hit.runsPerGame, LEAGUE.runsPerGame) - LEAGUE.runsPerGame) * 2.8);
}

function starterStrength(team) {
  const p = team.starter?.seasonStats || {};
  if (p.source !== 'live') return 0;
  return ((LEAGUE.era - numberFrom(p.era, LEAGUE.era)) * 2.5)
    + ((LEAGUE.whip - numberFrom(p.whip, LEAGUE.whip)) * 8.5)
    + ((numberFrom(p.k9, LEAGUE.k9) - LEAGUE.k9) * 0.65)
    - ((numberFrom(p.bb9, LEAGUE.bb9) - LEAGUE.bb9) * 0.75)
    - ((numberFrom(p.hr9, LEAGUE.hr9) - LEAGUE.hr9) * 1.6);
}

function teamPitchingStrength(team) {
  const p = team.pitchingStats || {};
  return ((LEAGUE.era - numberFrom(p.era, LEAGUE.era)) * 1.5)
    + ((LEAGUE.whip - numberFrom(p.whip, LEAGUE.whip)) * 5.5);
}

function projectedRuns(team, opponent) {
  const hit = team.hittingStats || {};
  const oppStarter = opponent.starter?.seasonStats || {};
  const oppPitching = opponent.pitchingStats || {};

  const base = numberFrom(hit.runsPerGame, LEAGUE.runsPerGame);
  const offenseLift = (numberFrom(hit.ops, LEAGUE.ops) - LEAGUE.ops) * 5.2;
  const starterLift = (numberFrom(oppStarter.era, LEAGUE.era) - LEAGUE.era) * 0.17
    + (numberFrom(oppStarter.whip, LEAGUE.whip) - LEAGUE.whip) * 0.85;
  const staffLift = (numberFrom(oppPitching.era, LEAGUE.era) - LEAGUE.era) * 0.11;
  const starterKnownAdjustment = oppStarter.source === 'live' ? 0 : -0.08;

  return clamp(base + offenseLift + starterLift + staffLift + starterKnownAdjustment, 2.1, 7.6);
}

function sideScore(game, side) {
  const team = game[side];
  const opponent = side === 'home' ? game.away : game.home;
  const homeAdvantage = side === 'home' ? 1.15 : 0;
  return (team.projectedRuns.fullRuns * 10)
    + offenseStrength(team)
    + starterStrength(team)
    + teamPitchingStrength(team)
    + homeAdvantage;
}

function gradeFromScore(score) {
  if (score >= 88) return 'A+';
  if (score >= 82) return 'A';
  if (score >= 76) return 'A-';
  if (score >= 70) return 'B+';
  if (score >= 64) return 'B';
  if (score >= 58) return 'B-';
  if (score >= 52) return 'C+';
  return 'C';
}

function primaryPitcherText(team, opponent) {
  const starter = team.starter || {};
  const oppStarter = opponent.starter || {};
  const p = starter.seasonStats || {};
  const o = oppStarter.seasonStats || {};

  if (p.source !== 'live' && o.source !== 'live') return 'Probable starter data is limited, so this pick leans more on team-level hitting and pitching.';
  if (p.source === 'live' && o.source === 'live') {
    const edge = numberFrom(o.era, LEAGUE.era) - numberFrom(p.era, LEAGUE.era);
    const sign = edge >= 0 ? '+' : '';
    return `${starter.name} owns a ${fmtNum(p.era)} ERA / ${fmtNum(p.whip)} WHIP profile vs ${oppStarter.name} at ${fmtNum(o.era)} ERA / ${fmtNum(o.whip)} WHIP (${sign}${fmtNum(edge)} ERA edge).`;
  }
  if (p.source === 'live') return `${starter.name} brings a ${fmtNum(p.era)} ERA / ${fmtNum(p.whip)} WHIP starter profile.`;
  return `${oppStarter.name}'s available starter profile creates the bigger matchup adjustment.`;
}

function buildTeamReasons(game, side) {
  const team = game[side];
  const opponent = side === 'home' ? game.away : game.home;
  const hit = team.hittingStats || {};
  const pitch = team.pitchingStats || {};
  const starter = team.starter?.seasonStats || {};
  const runDiff = team.projectedRuns.fullRuns - opponent.projectedRuns.fullRuns;
  const sign = runDiff >= 0 ? '+' : '';
  const reasons = [
    `Projected run edge: ${team.abbrev} ${fmtNum(team.projectedRuns.fullRuns)} vs ${opponent.abbrev} ${fmtNum(opponent.projectedRuns.fullRuns)} (${sign}${fmtNum(runDiff)}).`,
    `Team offense: ${fmtNum(hit.runsPerGame)} runs/game with a ${fmtNum(hit.ops, 3)} OPS.`,
    `Team pitching baseline: ${fmtNum(pitch.era)} ERA and ${fmtNum(pitch.whip)} WHIP.`
  ];

  if (starter.source === 'live') {
    reasons.push(`Starter ${team.starter.name}: ${fmtNum(starter.era)} ERA, ${fmtNum(starter.whip)} WHIP, ${fmtNum(starter.k9)} K/9.`);
  } else {
    reasons.push(`Starter is listed as ${team.starter?.name || 'TBD'}, so the model gives less weight to starter-specific data.`);
  }

  if (side === 'home') reasons.push('Home-field bonus is included as a small model edge.');
  return reasons;
}

function analyzeGame(game) {
  game.away.projectedRuns = { fullRuns: projectedRuns(game.away, game.home) };
  game.home.projectedRuns = { fullRuns: projectedRuns(game.home, game.away) };

  const awayScore = sideScore(game, 'away');
  const homeScore = sideScore(game, 'home');
  const diff = homeScore - awayScore;
  const homeProbability = clamp(1 / (1 + Math.exp(-diff / 8.5)), 0.36, 0.74);
  const winnerSide = homeProbability >= 0.5 ? 'home' : 'away';
  const loserSide = winnerSide === 'home' ? 'away' : 'home';
  const winner = game[winnerSide];
  const loser = game[loserSide];
  const winnerProbability = winnerSide === 'home' ? homeProbability : 1 - homeProbability;
  const runEdge = winner.projectedRuns.fullRuns - loser.projectedRuns.fullRuns;

  const knownStarters = [game.away, game.home].filter((team) => team.starter?.seasonStats?.source === 'live').length;
  const knownTeamStats = [game.away, game.home].reduce((total, team) => total + (team.dataQuality || 0), 0);
  const dataQuality = knownStarters * 6 + knownTeamStats * 4;
  const confidenceScore = clamp(48 + Math.abs(diff) * 3.1 + Math.abs(runEdge) * 11 + dataQuality, 40, 96);
  const grade = gradeFromScore(confidenceScore);

  game.away.reasons = buildTeamReasons(game, 'away');
  game.home.reasons = buildTeamReasons(game, 'home');

  return {
    ...game,
    prediction: {
      winnerSide,
      winnerAbbrev: winner.abbrev,
      headline: winner.name,
      primaryReason: `${winner.abbrev} grades higher because of a ${runEdge >= 0 ? '+' : ''}${fmtNum(runEdge)} projected-run edge, starter profile, and team pitching/offense baseline.`,
      winProbability: winnerProbability,
      runEdge,
      confidence: {
        score: confidenceScore,
        grade
      }
    }
  };
}

async function hydrateGame(rawGame, season) {
  const game = normalizeScheduleGame(rawGame);
  const [awayTeamStats, homeTeamStats, awayStarterStats, homeStarterStats] = await Promise.all([
    fetchTeamStats(game.away.id, season),
    fetchTeamStats(game.home.id, season),
    fetchPitcherStats(game.away.starter.id, season),
    fetchPitcherStats(game.home.starter.id, season)
  ]);

  game.away.hittingStats = awayTeamStats.hitting;
  game.away.pitchingStats = awayTeamStats.pitching;
  game.away.dataQuality = awayTeamStats.quality;
  game.away.starter.seasonStats = awayStarterStats;

  game.home.hittingStats = homeTeamStats.hitting;
  game.home.pitchingStats = homeTeamStats.pitching;
  game.home.dataQuality = homeTeamStats.quality;
  game.home.starter.seasonStats = homeStarterStats;

  return analyzeGame(game);
}

function pitcherText(game, winnerSide) {
  const winner = game[winnerSide];
  const loser = winnerSide === 'home' ? game.away : game.home;
  return primaryPitcherText(winner, loser);
}

function runText(game, winnerSide) {
  const winner = game[winnerSide];
  const loser = winnerSide === 'home' ? game.away : game.home;
  const diff = winner.projectedRuns.fullRuns - loser.projectedRuns.fullRuns;
  const sign = diff >= 0 ? '+' : '';
  return `${winner.abbrev} ${fmtNum(winner.projectedRuns.fullRuns)} projected runs vs ${loser.abbrev} ${fmtNum(loser.projectedRuns.fullRuns)} (${sign}${fmtNum(diff)} edge).`;
}

function formText(game, winnerSide) {
  const winner = game[winnerSide];
  const hit = winner.hittingStats || {};
  const pitch = winner.pitchingStats || {};
  return `${winner.abbrev}: ${fmtNum(hit.runsPerGame)} runs/game, ${fmtNum(hit.ops, 3)} OPS, ${fmtNum(pitch.era)} staff ERA.`;
}

function renderReasons(listEl, reasons) {
  listEl.innerHTML = '';
  (reasons || []).forEach((reason) => {
    const li = document.createElement('li');
    li.textContent = reason;
    listEl.appendChild(li);
  });
}

function setFactor(el, label, text) {
  el.innerHTML = `<span>${escapeHtml(label)}</span><strong>${escapeHtml(text)}</strong>`;
}

function summaryMarkup(payload, visibleGames, allGames) {
  if (!allGames.length) return '<p>No MLB games found for this date.</p>';

  const topPicks = allGames.filter((g) => gradeValue(g.prediction?.confidence?.grade) >= gradeValue('B')).length;
  const upcoming = allGames.filter((g) => timeBucket(g) === 'UPCOMING').length;
  const avgConfidence = allGames.reduce((sum, game) => sum + Number(game.prediction?.confidence?.score || 0), 0) / allGames.length;
  const dataNote = payload.usedLiveStats
    ? 'Live MLB schedule and stat endpoints loaded directly from the browser. No server, Node app, or API route is required.'
    : 'Schedule loaded, but some stat endpoints were unavailable. Cards use neutral league-average fallbacks where data is missing.';

  return `
    <div class="summary-grid">
      <div><strong>${visibleGames.length}</strong><span>cards showing</span></div>
      <div><strong>${payload.count ?? allGames.length}</strong><span>games analyzed</span></div>
      <div><strong>${upcoming}</strong><span>upcoming games</span></div>
      <div><strong>${topPicks}</strong><span>B grade or better</span></div>
    </div>
    <p class="summary-note">Average confidence: ${fmtNum(avgConfidence, 0)}/100. ${escapeHtml(dataNote)}</p>
  `;
}

function getVisibleGames() {
  const minGrade = $('#gradeFilter')?.value || 'ALL';
  const timeFilter = $('#timeFilter')?.value || 'ALL';
  const sortBy = $('#sortSelect')?.value || 'timeAsc';
  const minGradeScore = minGrade === 'ALL' ? 0 : gradeValue(minGrade);

  const games = state.analysis
    .filter((game) => gradeValue(game.prediction?.confidence?.grade) >= minGradeScore)
    .filter((game) => timeFilter === 'ALL' || timeBucket(game) === timeFilter);

  games.sort((a, b) => {
    if (sortBy === 'gradeDesc') {
      return gradeValue(b.prediction?.confidence?.grade) - gradeValue(a.prediction?.confidence?.grade)
        || Number(b.prediction?.confidence?.score || 0) - Number(a.prediction?.confidence?.score || 0)
        || gameTimeMs(a) - gameTimeMs(b);
    }

    if (sortBy === 'confidenceDesc') {
      return Number(b.prediction?.confidence?.score || 0) - Number(a.prediction?.confidence?.score || 0)
        || gameTimeMs(a) - gameTimeMs(b);
    }

    if (sortBy === 'runEdgeDesc') {
      return Number(b.prediction?.runEdge || 0) - Number(a.prediction?.runEdge || 0)
        || Number(b.prediction?.confidence?.score || 0) - Number(a.prediction?.confidence?.score || 0)
        || gameTimeMs(a) - gameTimeMs(b);
    }

    return gameTimeMs(a) - gameTimeMs(b)
      || Number(b.prediction?.confidence?.score || 0) - Number(a.prediction?.confidence?.score || 0);
  });

  return games;
}

function renderCard(game, index) {
  const template = $('#gameCardTemplate');
  const node = template.content.cloneNode(true);
  const card = node.querySelector('.game-card');
  const winnerSide = game.prediction.winnerSide;
  const confidence = game.prediction.confidence || {};
  const probability = Number(game.prediction.winProbability || 0);
  const grade = confidence.grade || '—';

  card.classList.add(gradeClass(grade));
  card.dataset.grade = grade;
  card.dataset.timeBucket = timeBucket(game);
  card.style.setProperty('--reveal-delay', `${Math.min(index * 55, 650)}ms`);

  card.querySelector('.game-status').textContent = game.status || timeBucket(game);
  card.querySelector('.game-time-chip').textContent = compactStartTime(game.startTime);
  card.querySelector('.matchup').textContent = game.matchup;
  card.querySelector('.venue').textContent = `${game.venue || 'Venue TBD'} • ${cleanStartTime(game.startTime)}`;
  card.querySelector('.confidence').innerHTML = `${escapeHtml(grade)}<small>${Number(confidence.score || 0).toFixed(0)}/100</small>`;
  card.querySelector('.winner').textContent = game.prediction.headline;
  card.querySelector('.primary-reason').textContent = game.prediction.primaryReason;
  card.querySelector('.win-prob-value').textContent = fmtPct(probability);
  card.querySelector('.prob-track i').style.width = `${Math.max(0, Math.min(100, probability * 100))}%`;

  setFactor(card.querySelector('.pitcher-factor'), 'Starter matchup', pitcherText(game, winnerSide));
  setFactor(card.querySelector('.run-factor'), 'Projected run edge', runText(game, winnerSide));
  setFactor(card.querySelector('.form-factor'), 'Team baseline', formText(game, winnerSide));

  card.querySelector('.away-title').textContent = `${game.away.abbrev} case`;
  card.querySelector('.home-title').textContent = `${game.home.abbrev} case`;
  renderReasons(card.querySelector('.away-reasons'), game.away.reasons);
  renderReasons(card.querySelector('.home-reasons'), game.home.reasons);

  return node;
}

function renderFilteredBoard() {
  const grid = $('#boardGrid');
  const summary = $('#summary');
  const payload = state.payload || {};
  const visibleGames = getVisibleGames();

  grid.innerHTML = '';
  summary.innerHTML = summaryMarkup(payload, visibleGames, state.analysis);
  updateDataStatus('Static MLB mode', `${state.analysis.length} game card(s) loaded. Static-only build active.`);

  if (!visibleGames.length) {
    grid.innerHTML = `
      <div class="empty-state glass">
        <strong>No cards match those filters.</strong>
        <span>Drop the minimum grade or switch the time filter back to all games.</span>
      </div>
    `;
    return;
  }

  visibleGames.forEach((game, index) => {
    grid.appendChild(renderCard(game, index));
  });
}


function compactPredictionForAi(game) {
  const winnerSide = game.prediction?.winnerSide;
  const winner = game[winnerSide] || {};
  const loser = winnerSide === 'home' ? game.away : game.home;
  const confidence = game.prediction?.confidence || {};
  const reasons = [
    game.prediction?.primaryReason,
    ...(winner.reasons || []).slice(0, 4)
  ].filter(Boolean);

  return {
    gamePk: game.gamePk,
    gameTime: game.startTime,
    status: game.status,
    timeBucket: timeBucket(game),
    venue: game.venue,
    matchup: game.matchup,
    away: {
      id: game.away.id,
      name: game.away.name,
      abbrev: game.away.abbrev,
      starter: game.away.starter?.name || 'Starter TBD',
      score: game.away.score ?? null,
      projectedRuns: Number(game.away.projectedRuns.fullRuns.toFixed(2))
    },
    home: {
      id: game.home.id,
      name: game.home.name,
      abbrev: game.home.abbrev,
      starter: game.home.starter?.name || 'Starter TBD',
      score: game.home.score ?? null,
      projectedRuns: Number(game.home.projectedRuns.fullRuns.toFixed(2))
    },
    predictedWinner: winner.name,
    predictedWinnerAbbrev: winner.abbrev,
    opponent: loser?.name || null,
    appWinChance: Number((Number(game.prediction?.winProbability || 0) * 100).toFixed(1)),
    confidenceScore: Number(Number(confidence.score || 0).toFixed(0)),
    grade: confidence.grade || '—',
    projectedRunEdge: Number(Number(game.prediction?.runEdge || 0).toFixed(2)),
    signal: gradeValue(confidence.grade) >= gradeValue('A-') ? 'STRONG' : gradeValue(confidence.grade) >= gradeValue('B') ? 'PLAYABLE' : 'LEAN',
    reasons
  };
}

function buildAiReadableFeed(payload = {}) {
  const picks = (state.analysis || []).map(compactPredictionForAi);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: 'Diamond Oracle browser-generated feed',
    staticJsonUrl: 'picks.json',
    date: payload.date || $('#dateInput')?.value || todayPacific(),
    season: payload.season || currentSeasonForDate(payload.date || $('#dateInput')?.value),
    count: picks.length,
    usedLiveStats: Boolean(payload.usedLiveStats),
    picks,
    topPicks: picks.filter((pick) => gradeValue(pick.grade) >= gradeValue('B'))
  };
}

function publishAiReadableData(payload = {}) {
  const feed = buildAiReadableFeed(payload);
  const json = JSON.stringify(feed, null, 2);
  window.DIAMOND_ORACLE_PICKS = feed;

  const script = $('#diamondOracleData');
  const pre = $('#aiReadableJson');
  if (script) script.textContent = json;
  if (pre) pre.textContent = json;
}

async function copyAiJson() {
  const feed = window.DIAMOND_ORACLE_PICKS || buildAiReadableFeed(state.payload || {});
  const json = JSON.stringify(feed, null, 2);
  try {
    await navigator.clipboard.writeText(json);
    const btn = $('#copyJsonBtn');
    if (btn) {
      const original = btn.textContent;
      btn.textContent = 'Copied JSON';
      setTimeout(() => { btn.textContent = original; }, 1200);
    }
  } catch (err) {
    const pre = $('#aiReadableJson');
    if (pre) pre.focus();
    console.warn('Could not copy JSON automatically.', err);
  }
}

function renderBoard(payload) {
  state.payload = payload;
  state.analysis = payload.analysis || [];
  publishAiReadableData(payload);
  renderFilteredBoard();
}

async function loadBoard() {
  const btn = $('#loadBtn');
  const date = $('#dateInput').value || todayPacific();
  const season = currentSeasonForDate(date);

  btn.disabled = true;
  btn.textContent = 'Analyzing…';
  $('#summary').innerHTML = '<div class="loading-line"></div>';
  $('#boardGrid').innerHTML = '';
  updateDataStatus('Loading MLB board', 'Pulling schedule and stat data directly from the browser.');

  try {
    const schedule = await fetchSchedule(date);

    if (!schedule.length) {
      renderBoard({ date, season, count: 0, usedLiveStats: true, analysis: [] });
      updateDataStatus('No games found', `No MLB games are listed for ${date}.`);
      return;
    }

    updateDataStatus('Analyzing matchups', `${schedule.length} game(s) found. Building static model cards.`);
    const analysis = await Promise.all(schedule.map((game) => hydrateGame(game, season)));

    analysis.sort((a, b) => {
      const aScore = Number(a.prediction?.confidence?.score || 0) + Number(a.prediction?.runEdge || 0) * 3;
      const bScore = Number(b.prediction?.confidence?.score || 0) + Number(b.prediction?.runEdge || 0) * 3;
      return bScore - aScore || gameTimeMs(a) - gameTimeMs(b);
    });

    const usedLiveStats = analysis.some((game) =>
      game.away?.hittingStats?.source === 'live'
      || game.home?.hittingStats?.source === 'live'
      || game.away?.starter?.seasonStats?.source === 'live'
      || game.home?.starter?.seasonStats?.source === 'live'
    );

    renderBoard({ date, season, count: analysis.length, usedLiveStats, analysis });
  } catch (err) {
    $('#summary').innerHTML = `<p class="error">${escapeHtml(err.message)}. GitHub Pages is static, so this version only works when the browser can reach the public MLB Stats API.</p>`;
    updateDataStatus('MLB data unavailable', 'Check your internet connection or browser/network blockers.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Analyze board';
  }
}

setDefaultDate();
$('#loadBtn').addEventListener('click', loadBoard);
$('#copyJsonBtn')?.addEventListener('click', copyAiJson);
['sortSelect', 'gradeFilter', 'timeFilter'].forEach((id) => {
  $(`#${id}`).addEventListener('change', renderFilteredBoard);
});
loadBoard();

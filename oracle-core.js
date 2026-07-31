(function attachDiamondOracle(global) {
  'use strict';

  const MLB_API_BASE = 'https://statsapi.mlb.com/api/v1';
  const CACHE = new Map();

  const TEAM_ABBREV = {
    108: 'LAA', 109: 'ARI', 110: 'BAL', 111: 'BOS', 112: 'CHC', 113: 'CIN',
    114: 'CLE', 115: 'COL', 116: 'DET', 117: 'HOU', 118: 'KC', 119: 'LAD',
    120: 'WSH', 121: 'NYM', 133: 'ATH', 134: 'PIT', 135: 'SD', 136: 'SEA',
    137: 'SF', 138: 'STL', 139: 'TB', 140: 'TEX', 141: 'TOR', 142: 'MIN',
    143: 'PHI', 144: 'ATL', 145: 'CWS', 146: 'MIA', 147: 'NYY', 158: 'MIL'
  };

  const LEAGUE = Object.freeze({
    avg: 0.245,
    obp: 0.315,
    slg: 0.395,
    ops: 0.710,
    runsPerGame: 4.40,
    era: 4.20,
    whip: 1.28,
    k9: 8.40,
    bb9: 3.10,
    hr9: 1.10
  });

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const round = (value, digits = 2) => {
    const number = Number(value);
    return Number.isFinite(number) ? Number(number.toFixed(digits)) : null;
  };

  function numberFrom(value, fallback = 0) {
    if (value === undefined || value === null || value === '') return fallback;
    const parsed = Number(String(value).replace('%', ''));
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function inningsFrom(value) {
    if (value === undefined || value === null || value === '') return 0;
    const text = String(value);
    if (!text.includes('.')) return numberFrom(text, 0);
    const [wholeText, outsText] = text.split('.');
    const whole = numberFrom(wholeText, 0);
    const outs = clamp(numberFrom(outsText, 0), 0, 2);
    return whole + (outs / 3);
  }

  function todayPacific() {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date());
  }

  function seasonForDate(dateString) {
    const year = Number(String(dateString || todayPacific()).slice(0, 4));
    return Number.isFinite(year) ? year : new Date().getFullYear();
  }

  function shiftDate(dateString, days) {
    const [year, month, day] = String(dateString).split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
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

  function isFinalStatus(status = '') {
    return /final|completed|game over/.test(String(status).toLowerCase());
  }

  function isLiveStatus(status = '') {
    return /in progress|live|inning|delayed|suspended|review|challenge/.test(String(status).toLowerCase());
  }

  function isOffStatus(status = '') {
    return /postponed|cancelled|canceled/.test(String(status).toLowerCase());
  }

  function timeBucket(game) {
    const detailed = String(game.status || game.detailedState || '');
    const abstract = String(game.abstractState || '');
    if (/final/i.test(abstract) || isFinalStatus(detailed)) return 'FINAL';
    if (/live/i.test(abstract) || isLiveStatus(detailed)) return 'LIVE';
    if (isOffStatus(detailed)) return 'OFF';
    if (!game.startTime || !Number.isFinite(Date.parse(game.startTime))) return 'TBD';
    return 'UPCOMING';
  }

  async function fetchJson(url, cacheKey = url) {
    if (CACHE.has(cacheKey)) return CACHE.get(cacheKey);

    const request = (async () => {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), 15000) : null;
      try {
        const response = await fetch(url, {
          headers: { accept: 'application/json' },
          signal: controller?.signal
        });
        if (!response.ok) throw new Error(`MLB request failed (${response.status})`);
        return await response.json();
      } finally {
        if (timer) clearTimeout(timer);
      }
    })();

    CACHE.set(cacheKey, request);
    try {
      return await request;
    } catch (error) {
      CACHE.delete(cacheKey);
      throw error;
    }
  }

  function statsBlock(json, typeName) {
    const wanted = String(typeName).toLowerCase();
    return (json?.stats || []).find((block) => {
      const displayName = String(block?.type?.displayName || block?.type || '').toLowerCase();
      return displayName === wanted;
    }) || null;
  }

  function firstStat(json, typeName) {
    return statsBlock(json, typeName)?.splits?.[0]?.stat || {};
  }

  function normalizeHitting(raw = {}, source = 'fallback') {
    const games = numberFrom(raw.gamesPlayed, 0);
    const obp = numberFrom(raw.obp, LEAGUE.obp);
    const slg = numberFrom(raw.slg, LEAGUE.slg);
    const ops = numberFrom(raw.ops, obp + slg);
    const runs = numberFrom(raw.runs, 0);
    return {
      avg: numberFrom(raw.avg, LEAGUE.avg),
      obp,
      slg,
      ops,
      runs,
      games,
      runsPerGame: games > 0 ? runs / games : LEAGUE.runsPerGame,
      plateAppearances: numberFrom(raw.plateAppearances, 0),
      source
    };
  }

  function neutralHitting() {
    return normalizeHitting({}, 'fallback');
  }

  function normalizePitching(raw = {}, source = 'fallback') {
    const innings = inningsFrom(raw.inningsPitched);
    const gamesPitched = numberFrom(raw.gamesPitched ?? raw.gamesPlayed, 0);
    const gamesStarted = numberFrom(raw.gamesStarted, 0);
    return {
      era: numberFrom(raw.era, LEAGUE.era),
      whip: numberFrom(raw.whip, LEAGUE.whip),
      k9: numberFrom(raw.strikeoutsPer9Inn, LEAGUE.k9),
      bb9: numberFrom(raw.walksPer9Inn, LEAGUE.bb9),
      hr9: numberFrom(raw.homeRunsPer9, LEAGUE.hr9),
      innings,
      gamesPitched,
      gamesStarted,
      source
    };
  }

  function neutralPitching() {
    return normalizePitching({}, 'fallback');
  }

  async function fetchSchedule(date) {
    const url = `${MLB_API_BASE}/schedule?sportId=1&date=${encodeURIComponent(date)}&hydrate=team,probablePitcher,venue,linescore`;
    const json = await fetchJson(url, `schedule:${date}`);
    return json?.dates?.flatMap((entry) => entry.games || []) || [];
  }

  async function fetchTeamHitting(teamId, season, startDate, endDate) {
    const fallback = { season: neutralHitting(), recent: neutralHitting() };
    if (!teamId) return fallback;

    try {
      const url = `${MLB_API_BASE}/teams/${teamId}/stats?stats=season,byDateRange&group=hitting&season=${season}&startDate=${startDate}&endDate=${endDate}`;
      const json = await fetchJson(url, `hitting:${teamId}:${season}:${startDate}:${endDate}`);
      const seasonRaw = firstStat(json, 'season');
      const recentRaw = firstStat(json, 'byDateRange');
      return {
        season: normalizeHitting(seasonRaw, Object.keys(seasonRaw).length ? 'live' : 'fallback'),
        recent: normalizeHitting(recentRaw, Object.keys(recentRaw).length ? 'live' : 'fallback')
      };
    } catch (error) {
      return fallback;
    }
  }

  function aggregatePitchingSplits(splits, source, allowedIds = null) {
    const rows = (splits || [])
      .map((split) => {
        const playerId = split?.player?.id || split?.person?.id || split?.playerId || null;
        return { playerId, stat: normalizePitching(split?.stat || {}, source) };
      })
      .filter(({ playerId, stat }) => {
        if (allowedIds && !allowedIds.has(playerId)) return false;
        if (stat.gamesPitched < 2 || stat.innings <= 0) return false;
        const startShare = stat.gamesStarted / Math.max(1, stat.gamesPitched);
        return startShare <= 0.35;
      });

    if (!rows.length) return neutralPitching();

    const totalInnings = rows.reduce((sum, row) => sum + row.stat.innings, 0);
    if (totalInnings <= 0) return neutralPitching();

    const weighted = (field) => rows.reduce((sum, row) => sum + row.stat[field] * row.stat.innings, 0) / totalInnings;
    return {
      era: weighted('era'),
      whip: weighted('whip'),
      k9: weighted('k9'),
      bb9: weighted('bb9'),
      hr9: weighted('hr9'),
      innings: totalInnings,
      gamesPitched: rows.reduce((sum, row) => sum + row.stat.gamesPitched, 0),
      gamesStarted: rows.reduce((sum, row) => sum + row.stat.gamesStarted, 0),
      relieversCounted: rows.length,
      source
    };
  }

  async function fetchBullpen(teamId, season, startDate, endDate) {
    const fallback = { season: neutralPitching(), recent: neutralPitching() };
    if (!teamId) return fallback;

    try {
      const url = `${MLB_API_BASE}/stats?stats=season,byDateRange&group=pitching&teamId=${teamId}&season=${season}&sportIds=1&playerPool=ALL&startDate=${startDate}&endDate=${endDate}`;
      const json = await fetchJson(url, `bullpen:${teamId}:${season}:${startDate}:${endDate}`);
      const seasonSplits = statsBlock(json, 'season')?.splits || [];
      const seasonRelieverIds = new Set(
        seasonSplits
          .filter((split) => {
            const stat = normalizePitching(split?.stat || {}, 'live');
            return stat.gamesPitched >= 2 && stat.gamesStarted / Math.max(1, stat.gamesPitched) <= 0.35;
          })
          .map((split) => split?.player?.id || split?.person?.id || split?.playerId)
          .filter(Boolean)
      );
      const recentSplits = statsBlock(json, 'byDateRange')?.splits || [];
      return {
        season: aggregatePitchingSplits(seasonSplits, seasonSplits.length ? 'live' : 'fallback'),
        recent: aggregatePitchingSplits(recentSplits, recentSplits.length ? 'live' : 'fallback', seasonRelieverIds)
      };
    } catch (error) {
      return fallback;
    }
  }

  function aggregatePitcherGameLog(splits) {
    const starts = (splits || [])
      .filter((split) => numberFrom(split?.stat?.gamesStarted, 0) > 0 || String(split?.position?.abbreviation || '') === 'P')
      .sort((a, b) => Date.parse(b?.date || 0) - Date.parse(a?.date || 0))
      .slice(0, 5);

    if (!starts.length) return neutralPitching();

    const totals = starts.reduce((acc, split) => {
      const stat = split?.stat || {};
      acc.innings += inningsFrom(stat.inningsPitched);
      acc.earnedRuns += numberFrom(stat.earnedRuns, 0);
      acc.hits += numberFrom(stat.hits, 0);
      acc.walks += numberFrom(stat.baseOnBalls, 0);
      acc.homeRuns += numberFrom(stat.homeRuns, 0);
      acc.strikeouts += numberFrom(stat.strikeOuts, 0);
      return acc;
    }, { innings: 0, earnedRuns: 0, hits: 0, walks: 0, homeRuns: 0, strikeouts: 0 });

    if (totals.innings <= 0) return neutralPitching();

    return {
      era: (totals.earnedRuns * 9) / totals.innings,
      whip: (totals.hits + totals.walks) / totals.innings,
      k9: (totals.strikeouts * 9) / totals.innings,
      bb9: (totals.walks * 9) / totals.innings,
      hr9: (totals.homeRuns * 9) / totals.innings,
      innings: totals.innings,
      gamesPitched: starts.length,
      gamesStarted: starts.length,
      startsUsed: starts.length,
      source: 'live'
    };
  }

  async function fetchStarter(pitcherId, season) {
    const fallback = { season: neutralPitching(), recent: neutralPitching() };
    if (!pitcherId) return fallback;

    try {
      const url = `${MLB_API_BASE}/people/${pitcherId}/stats?stats=season,gameLog&group=pitching&season=${season}`;
      const json = await fetchJson(url, `starter:${pitcherId}:${season}`);
      const seasonRaw = firstStat(json, 'season');
      const gameLogSplits = statsBlock(json, 'gameLog')?.splits || [];
      return {
        season: normalizePitching(seasonRaw, Object.keys(seasonRaw).length ? 'live' : 'fallback'),
        recent: aggregatePitcherGameLog(gameLogSplits)
      };
    } catch (error) {
      return fallback;
    }
  }

  async function fetchBoxscore(gamePk) {
    if (!gamePk) return null;
    try {
      return await fetchJson(`${MLB_API_BASE}/game/${gamePk}/boxscore`, `boxscore:${gamePk}`);
    } catch (error) {
      return null;
    }
  }

  function playerHittingFromBoxscore(player = {}) {
    const raw = player?.seasonStats?.batting || player?.stats?.batting || {};
    const normalized = normalizeHitting(raw, Object.keys(raw).length ? 'live' : 'fallback');
    return {
      ...normalized,
      name: player?.person?.fullName || player?.person?.name || 'Unknown hitter'
    };
  }

  function lineupFromBoxscore(boxscore, side) {
    const teamBox = boxscore?.teams?.[side] || {};
    const battingOrder = Array.isArray(teamBox.battingOrder) ? teamBox.battingOrder.slice(0, 9) : [];
    const players = teamBox.players || {};
    const hitters = battingOrder
      .map((id, index) => {
        const player = players[`ID${id}`] || players[id] || null;
        if (!player) return null;
        const stats = playerHittingFromBoxscore(player);
        return { ...stats, id, order: index + 1 };
      })
      .filter(Boolean);

    const confirmed = battingOrder.length >= 9 && hitters.length >= 8;
    if (!hitters.length) {
      return { confirmed: false, hitters: [], stats: neutralHitting(), source: 'fallback' };
    }

    const orderWeights = [1.18, 1.14, 1.12, 1.10, 1.02, 0.96, 0.90, 0.86, 0.82];
    const totalWeight = hitters.reduce((sum, hitter, index) => sum + (orderWeights[index] || 0.8), 0);
    const weighted = (field, fallback) => hitters.reduce((sum, hitter, index) => {
      const weight = orderWeights[index] || 0.8;
      return sum + numberFrom(hitter[field], fallback) * weight;
    }, 0) / totalWeight;

    const obp = weighted('obp', LEAGUE.obp);
    const slg = weighted('slg', LEAGUE.slg);
    return {
      confirmed,
      hitters,
      source: confirmed ? 'confirmed' : 'provisional',
      stats: {
        avg: weighted('avg', LEAGUE.avg),
        obp,
        slg,
        ops: weighted('ops', obp + slg),
        runsPerGame: LEAGUE.runsPerGame,
        games: 0,
        source: confirmed ? 'live' : 'fallback'
      }
    };
  }

  function offenseIndex(stats = {}) {
    const opsTerm = (numberFrom(stats.ops, LEAGUE.ops) - LEAGUE.ops) / 0.065;
    const obpTerm = (numberFrom(stats.obp, LEAGUE.obp) - LEAGUE.obp) / 0.028;
    const slgTerm = (numberFrom(stats.slg, LEAGUE.slg) - LEAGUE.slg) / 0.060;
    const runsTerm = (numberFrom(stats.runsPerGame, LEAGUE.runsPerGame) - LEAGUE.runsPerGame) / 0.60;
    return clamp(50 + (opsTerm * 7.5) + (obpTerm * 4.0) + (slgTerm * 3.5) + (runsTerm * 5.0), 25, 78);
  }

  function pitchingIndex(stats = {}) {
    if (stats.source !== 'live') return 50;
    const raw = 50
      + ((LEAGUE.era - numberFrom(stats.era, LEAGUE.era)) * 5.6)
      + ((LEAGUE.whip - numberFrom(stats.whip, LEAGUE.whip)) * 16.0)
      + ((numberFrom(stats.k9, LEAGUE.k9) - LEAGUE.k9) * 1.5)
      - ((numberFrom(stats.bb9, LEAGUE.bb9) - LEAGUE.bb9) * 2.0)
      - ((numberFrom(stats.hr9, LEAGUE.hr9) - LEAGUE.hr9) * 4.0);
    const reliability = clamp(numberFrom(stats.innings, 0) / 70, 0.30, 1);
    return clamp(50 + ((raw - 50) * reliability), 22, 80);
  }

  function blend(values) {
    const usable = values.filter((item) => Number.isFinite(item.value) && item.weight > 0);
    const totalWeight = usable.reduce((sum, item) => sum + item.weight, 0);
    if (!totalWeight) return 50;
    return usable.reduce((sum, item) => sum + item.value * item.weight, 0) / totalWeight;
  }

  function buildTeamModel(team, opponent, side) {
    const seasonOffense = offenseIndex(team.hitting.season);
    const recentOffense = offenseIndex(team.hitting.recent);
    const lineupOffense = offenseIndex(team.lineup.stats);

    const offense = team.lineup.confirmed
      ? blend([
        { value: seasonOffense, weight: 0.30 },
        { value: recentOffense, weight: 0.30 },
        { value: lineupOffense, weight: 0.40 }
      ])
      : blend([
        { value: seasonOffense, weight: 0.58 },
        { value: recentOffense, weight: 0.42 }
      ]);

    const starterSeason = pitchingIndex(team.starter.stats.season);
    const starterRecent = pitchingIndex(team.starter.stats.recent);
    const starter = blend([
      { value: starterSeason, weight: 0.66 },
      { value: starterRecent, weight: team.starter.stats.recent.source === 'live' ? 0.34 : 0 }
    ]);

    const bullpenSeason = pitchingIndex(team.bullpen.season);
    const bullpenRecent = pitchingIndex(team.bullpen.recent);
    const bullpen = blend([
      { value: bullpenSeason, weight: 0.72 },
      { value: bullpenRecent, weight: team.bullpen.recent.source === 'live' ? 0.28 : 0 }
    ]);

    const opponentStarterSeason = pitchingIndex(opponent.starter.stats.season);
    const opponentStarterRecent = pitchingIndex(opponent.starter.stats.recent);
    const opponentStarter = blend([
      { value: opponentStarterSeason, weight: 0.66 },
      { value: opponentStarterRecent, weight: opponent.starter.stats.recent.source === 'live' ? 0.34 : 0 }
    ]);
    const opponentBullpen = blend([
      { value: pitchingIndex(opponent.bullpen.season), weight: 0.72 },
      { value: pitchingIndex(opponent.bullpen.recent), weight: opponent.bullpen.recent.source === 'live' ? 0.28 : 0 }
    ]);

    const homeRunBonus = side === 'home' ? 0.11 : 0;
    const projectedRuns = clamp(
      LEAGUE.runsPerGame
      + ((offense - 50) * 0.052)
      - ((opponentStarter - 50) * 0.034)
      - ((opponentBullpen - 50) * 0.019)
      + homeRunBonus,
      2.25,
      7.25
    );

    return {
      offense,
      seasonOffense,
      recentOffense,
      lineupOffense,
      starter,
      bullpen,
      projectedRuns
    };
  }

  function modelDataCompleteness(game) {
    const weightedFlags = [
      [game.away.hitting.season.source === 'live', 0.08],
      [game.home.hitting.season.source === 'live', 0.08],
      [game.away.hitting.recent.source === 'live', 0.08],
      [game.home.hitting.recent.source === 'live', 0.08],
      [game.away.starter.stats.season.source === 'live', 0.12],
      [game.home.starter.stats.season.source === 'live', 0.12],
      [game.away.bullpen.season.source === 'live', 0.09],
      [game.home.bullpen.season.source === 'live', 0.09],
      [game.away.lineup.confirmed, 0.13],
      [game.home.lineup.confirmed, 0.13]
    ];
    return weightedFlags.reduce((sum, [isReady, weight]) => sum + (isReady ? weight : 0), 0);
  }

  function logit(probability) {
    const p = clamp(probability, 0.001, 0.999);
    return Math.log(p / (1 - p));
  }

  function logistic(value) {
    return 1 / (1 + Math.exp(-value));
  }

  function gameReadiness(game) {
    const bucket = timeBucket(game);
    if (bucket === 'FINAL') return 'FINAL';
    if (bucket === 'LIVE') return 'LIVE';
    if (bucket === 'OFF') return 'OFF';
    if (!game.away.starter.id || !game.home.starter.id) return 'WAIT STARTER';
    if (!game.away.lineup.confirmed || !game.home.lineup.confirmed) return 'WAIT LINEUPS';
    return 'READY';
  }

  function decisionFor(game, winnerProbability, completeness) {
    const readiness = gameReadiness(game);

    // Game state and model opinion are separate concepts. Final and live games
    // retain PICK / LEAN / PASS instead of replacing the model opinion with a game-state label.
    if (readiness === 'OFF') return 'OFF';
    if (readiness === 'WAIT STARTER' || readiness === 'WAIT LINEUPS') return 'WAIT';
    if (winnerProbability >= 0.585 && completeness >= 0.82) return 'PICK';
    if (winnerProbability >= 0.545 && completeness >= 0.72) return 'LEAN';
    return 'PASS';
  }

  function buildReasons(game, side) {
    const team = game[side];
    const opponent = side === 'home' ? game.away : game.home;
    const model = team.model;
    const oppModel = opponent.model;
    const runEdge = model.projectedRuns - oppModel.projectedRuns;
    const recent = team.hitting.recent;
    const starter = team.starter.stats.season;
    const bullpen = team.bullpen.season;
    const lineupText = team.lineup.confirmed
      ? `Confirmed batting order index: ${round(model.lineupOffense, 1)}.`
      : 'Batting order is not confirmed; the probability is intentionally reduced.';

    return [
      `Projected runs: ${team.abbrev} ${round(model.projectedRuns, 2)} vs ${opponent.abbrev} ${round(oppModel.projectedRuns, 2)} (${runEdge >= 0 ? '+' : ''}${round(runEdge, 2)}).`,
      `Offense index ${round(model.offense, 1)}; recent form ${round(recent.runsPerGame, 2)} R/G and ${round(recent.ops, 3)} OPS.`,
      starter.source === 'live'
        ? `Starter ${team.starter.name}: ${round(starter.era, 2)} ERA, ${round(starter.whip, 2)} WHIP, ${round(starter.k9, 2)} K/9.`
        : `Starter ${team.starter.name || 'TBD'} lacks a usable season sample.`,
      bullpen.source === 'live'
        ? `Bullpen index ${round(model.bullpen, 1)} from ${bullpen.relieversCounted || 'available'} relievers.`
        : 'Bullpen-specific data was unavailable and was regressed to league average.',
      lineupText
    ];
  }

  function analyzeHydratedGame(game) {
    game.away.model = buildTeamModel(game.away, game.home, 'away');
    game.home.model = buildTeamModel(game.home, game.away, 'home');

    const exponent = 1.83;
    const awayPower = Math.pow(game.away.model.projectedRuns, exponent);
    const homePower = Math.pow(game.home.model.projectedRuns, exponent);
    const pythagHome = homePower / (homePower + awayPower);
    const completeness = modelDataCompleteness(game);

    let homeProbability = logistic(logit(pythagHome));
    const shrinkFactor = 0.56 + (0.44 * completeness);
    homeProbability = 0.5 + ((homeProbability - 0.5) * shrinkFactor);

    if (!game.away.lineup.confirmed || !game.home.lineup.confirmed) {
      homeProbability = 0.5 + ((homeProbability - 0.5) * 0.78);
    }
    if (game.away.starter.stats.season.source !== 'live' || game.home.starter.stats.season.source !== 'live') {
      homeProbability = 0.5 + ((homeProbability - 0.5) * 0.80);
    }

    homeProbability = clamp(homeProbability, 0.31, 0.69);
    const winnerSide = homeProbability >= 0.5 ? 'home' : 'away';
    const loserSide = winnerSide === 'home' ? 'away' : 'home';
    const winner = game[winnerSide];
    const loser = game[loserSide];
    const winnerProbability = winnerSide === 'home' ? homeProbability : 1 - homeProbability;
    const runEdge = winner.model.projectedRuns - loser.model.projectedRuns;
    const readiness = gameReadiness(game);
    const decision = decisionFor(game, winnerProbability, completeness);

    game.away.reasons = buildReasons(game, 'away');
    game.home.reasons = buildReasons(game, 'home');

    const lineupClause = game.away.lineup.confirmed && game.home.lineup.confirmed
      ? 'Both batting orders are confirmed.'
      : 'This is an early lean because one or both batting orders are still unconfirmed.';

    return {
      ...game,
      prediction: {
        winnerSide,
        winnerAbbrev: winner.abbrev,
        headline: winner.name,
        winProbability: winnerProbability,
        homeProbability,
        runEdge,
        dataCompleteness: completeness,
        readiness,
        decision,
        primaryReason: `${winner.abbrev} projects ${runEdge >= 0 ? '+' : ''}${round(runEdge, 2)} runs better after blending confirmed-lineup status, recent offense, starter form, and bullpen quality. ${lineupClause}`,
        components: {
          away: {
            offense: game.away.model.offense,
            starter: game.away.model.starter,
            bullpen: game.away.model.bullpen
          },
          home: {
            offense: game.home.model.offense,
            starter: game.home.model.starter,
            bullpen: game.home.model.bullpen
          }
        }
      }
    };
  }

  function normalizeScheduleGame(rawGame) {
    const awayTeam = rawGame?.teams?.away?.team || {};
    const homeTeam = rawGame?.teams?.home?.team || {};
    const awayPitcher = rawGame?.teams?.away?.probablePitcher || null;
    const homePitcher = rawGame?.teams?.home?.probablePitcher || null;
    return {
      gamePk: rawGame?.gamePk,
      status: rawGame?.status?.detailedState || rawGame?.status?.abstractGameState || 'Preview',
      detailedState: rawGame?.status?.detailedState || '',
      abstractState: rawGame?.status?.abstractGameState || '',
      startTime: rawGame?.gameDate || '',
      venue: rawGame?.venue?.name || 'Venue TBD',
      matchup: `${teamAbbrev(awayTeam)} @ ${teamAbbrev(homeTeam)}`,
      away: {
        id: awayTeam.id,
        name: awayTeam.name || 'Away Team',
        abbrev: teamAbbrev(awayTeam),
        score: rawGame?.teams?.away?.score ?? null,
        starter: {
          id: awayPitcher?.id || null,
          name: awayPitcher?.fullName || awayPitcher?.name || 'Starter TBD'
        }
      },
      home: {
        id: homeTeam.id,
        name: homeTeam.name || 'Home Team',
        abbrev: teamAbbrev(homeTeam),
        score: rawGame?.teams?.home?.score ?? null,
        starter: {
          id: homePitcher?.id || null,
          name: homePitcher?.fullName || homePitcher?.name || 'Starter TBD'
        }
      }
    };
  }

  async function hydrateGame(rawGame, season, startDate, endDate) {
    const game = normalizeScheduleGame(rawGame);
    const [awayHitting, homeHitting, awayBullpen, homeBullpen, awayStarter, homeStarter, boxscore] = await Promise.all([
      fetchTeamHitting(game.away.id, season, startDate, endDate),
      fetchTeamHitting(game.home.id, season, startDate, endDate),
      fetchBullpen(game.away.id, season, startDate, endDate),
      fetchBullpen(game.home.id, season, startDate, endDate),
      fetchStarter(game.away.starter.id, season),
      fetchStarter(game.home.starter.id, season),
      fetchBoxscore(game.gamePk)
    ]);

    game.away.hitting = awayHitting;
    game.home.hitting = homeHitting;
    game.away.bullpen = awayBullpen;
    game.home.bullpen = homeBullpen;
    game.away.starter.stats = awayStarter;
    game.home.starter.stats = homeStarter;
    game.away.lineup = lineupFromBoxscore(boxscore, 'away');
    game.home.lineup = lineupFromBoxscore(boxscore, 'home');

    return analyzeHydratedGame(game);
  }

  async function mapWithConcurrency(items, limit, worker, onProgress) {
    const results = new Array(items.length);
    let nextIndex = 0;
    let completed = 0;

    async function runWorker() {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        try {
          results[index] = await worker(items[index], index);
        } catch (error) {
          results[index] = null;
          console.warn('Pennant Pulse skipped one game after an unexpected error.', error);
        }
        completed += 1;
        if (typeof onProgress === 'function') onProgress({ completed, total: items.length });
      }
    }

    const workers = Array.from({ length: Math.min(limit, items.length) }, () => runWorker());
    await Promise.all(workers);
    return results.filter(Boolean);
  }

  async function generateBoard(date = todayPacific(), onProgress) {
    const season = seasonForDate(date);
    const recentStart = shiftDate(date, -20);
    const schedule = await fetchSchedule(date);
    const analysis = await mapWithConcurrency(
      schedule,
      4,
      (game) => hydrateGame(game, season, recentStart, date),
      onProgress
    );

    analysis.sort((a, b) => Date.parse(a.startTime || 0) - Date.parse(b.startTime || 0));
    const usedLiveStats = analysis.some((game) => game.prediction?.dataCompleteness > 0.35);
    return {
      schemaVersion: 2,
      modelVersion: 'pennant-pulse-v2-lineup-recent-bullpen',
      generatedAt: new Date().toISOString(),
      date,
      season,
      count: analysis.length,
      usedLiveStats,
      analysis
    };
  }

  function compactPrediction(game) {
    const winnerSide = game.prediction?.winnerSide;
    const winner = game[winnerSide] || {};
    const loser = winnerSide === 'home' ? game.away : game.home;
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
        lineupConfirmed: Boolean(game.away.lineup?.confirmed),
        score: game.away.score,
        projectedRuns: round(game.away.model?.projectedRuns, 2)
      },
      home: {
        id: game.home.id,
        name: game.home.name,
        abbrev: game.home.abbrev,
        starter: game.home.starter?.name || 'Starter TBD',
        lineupConfirmed: Boolean(game.home.lineup?.confirmed),
        score: game.home.score,
        projectedRuns: round(game.home.model?.projectedRuns, 2)
      },
      predictedWinner: winner.name,
      predictedWinnerAbbrev: winner.abbrev,
      opponent: loser?.name || null,
      appWinChance: round(numberFrom(game.prediction?.winProbability, 0) * 100, 1),
      projectedRunEdge: round(game.prediction?.runEdge, 2),
      dataCompleteness: round(numberFrom(game.prediction?.dataCompleteness, 0) * 100, 0),
      readiness: game.prediction?.readiness || 'LIMITED',
      decision: game.prediction?.decision || 'PASS',
      components: {
        away: {
          offense: round(game.prediction?.components?.away?.offense, 1),
          starter: round(game.prediction?.components?.away?.starter, 1),
          bullpen: round(game.prediction?.components?.away?.bullpen, 1)
        },
        home: {
          offense: round(game.prediction?.components?.home?.offense, 1),
          starter: round(game.prediction?.components?.home?.starter, 1),
          bullpen: round(game.prediction?.components?.home?.bullpen, 1)
        }
      },
      reasons: [
        game.prediction?.primaryReason,
        ...(winner.reasons || []).slice(0, 5)
      ].filter(Boolean)
    };
  }

  function buildFeed(payload = {}) {
    const picks = (payload.analysis || []).map(compactPrediction);
    return {
      schemaVersion: 2,
      modelVersion: payload.modelVersion || 'pennant-pulse-v2-lineup-recent-bullpen',
      generatedAt: payload.generatedAt || new Date().toISOString(),
      source: 'Pennant Pulse browser-generated feed',
      liveFeedUrl: 'ai.html',
      date: payload.date || todayPacific(),
      season: payload.season || seasonForDate(payload.date),
      count: picks.length,
      usedLiveStats: Boolean(payload.usedLiveStats),
      picks,
      actionablePicks: picks.filter((pick) => pick.timeBucket === 'UPCOMING' && pick.decision === 'PICK'),
      waitingForLineups: picks.filter((pick) => pick.readiness === 'WAIT LINEUPS')
    };
  }

  const api = {
    LEAGUE,
    todayPacific,
    seasonForDate,
    timeBucket,
    generateBoard,
    buildFeed,
    round,
    _test: {
      inningsFrom,
      offenseIndex,
      pitchingIndex,
      lineupFromBoxscore,
      analyzeHydratedGame,
      decisionFor
    }
  };

  global.DiamondOracleCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

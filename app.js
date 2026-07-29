'use strict';

const Core = window.DiamondOracleCore;
const state = { payload: null, analysis: [] };
const $ = (selector) => document.querySelector(selector);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function fmtNum(value, digits = 2) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : '—';
}

function fmtPct(value) {
  return `${fmtNum(Number(value || 0) * 100, 1)}%`;
}

function cleanStartTime(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Time TBD';
  return parsed.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function compactStartTime(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'TBD';
  return parsed.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function gameTimeMs(game) {
  const parsed = Date.parse(game.startTime || '');
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function updateDataStatus(message, detail = '') {
  $('#dataMode').textContent = message;
  $('#dataCount').textContent = detail;
}

function readinessRank(value) {
  return {
    READY: 6,
    'WAIT LINEUPS': 5,
    'WAIT STARTER': 4,
    LIVE: 3,
    FINAL: 2,
    OFF: 1
  }[value] || 0;
}

function setLoading(completed = 0, total = 0) {
  const percent = total ? Math.max(7, Math.round((completed / total) * 100)) : 7;
  $('#summary').innerHTML = `
    <div class="loading-wrap">
      <div class="loading-label">SCANNING MATCHUPS // ${completed}/${total || '?'}</div>
      <div class="loading-line"><i style="width:${percent}%"></i></div>
    </div>
  `;
}

function getVisibleGames() {
  const readinessFilter = $('#readinessFilter').value;
  const timeFilter = $('#timeFilter').value;
  const sortBy = $('#sortSelect').value;

  const games = state.analysis.filter((game) => {
    const readiness = game.prediction?.readiness;
    const decision = game.prediction?.decision;
    const bucket = Core.timeBucket(game);

    const readinessMatch = readinessFilter === 'ALL'
      || (readinessFilter === 'READY' && readiness === 'READY')
      || (readinessFilter === 'WAIT' && String(readiness).startsWith('WAIT'))
      || (readinessFilter === 'PICK' && decision === 'PICK')
      || (readinessFilter === 'PASS' && decision === 'PASS');
    const timeMatch = timeFilter === 'ALL' || timeFilter === bucket;
    return readinessMatch && timeMatch;
  });

  games.sort((a, b) => {
    if (sortBy === 'probabilityDesc') {
      return Number(b.prediction?.winProbability || 0) - Number(a.prediction?.winProbability || 0)
        || gameTimeMs(a) - gameTimeMs(b);
    }
    if (sortBy === 'runEdgeDesc') {
      return Number(b.prediction?.runEdge || 0) - Number(a.prediction?.runEdge || 0)
        || gameTimeMs(a) - gameTimeMs(b);
    }
    if (sortBy === 'readinessDesc') {
      return readinessRank(b.prediction?.readiness) - readinessRank(a.prediction?.readiness)
        || Number(b.prediction?.dataCompleteness || 0) - Number(a.prediction?.dataCompleteness || 0)
        || gameTimeMs(a) - gameTimeMs(b);
    }
    return gameTimeMs(a) - gameTimeMs(b)
      || Number(b.prediction?.winProbability || 0) - Number(a.prediction?.winProbability || 0);
  });

  return games;
}

function summaryMarkup(visibleGames) {
  const allGames = state.analysis;
  if (!allGames.length) return '<p>No MLB games were found for this date.</p>';

  const ready = allGames.filter((game) => game.prediction?.readiness === 'READY').length;
  const picks = allGames.filter((game) => game.prediction?.decision === 'PICK').length;
  const waiting = allGames.filter((game) => String(game.prediction?.readiness || '').startsWith('WAIT')).length;
  const avgData = allGames.reduce((sum, game) => sum + Number(game.prediction?.dataCompleteness || 0), 0) / allGames.length;

  return `
    <div class="summary-grid">
      <div><strong>${visibleGames.length}</strong><span>CARDS SHOWING</span></div>
      <div><strong>${allGames.length}</strong><span>GAMES SCANNED</span></div>
      <div><strong>${ready}</strong><span>READY</span></div>
      <div><strong>${picks}</strong><span>MODEL PICKS</span></div>
      <div><strong>${waiting}</strong><span>WAITING</span></div>
    </div>
    <p class="summary-note">Average data completeness: ${fmtNum(avgData * 100, 0)}%. Missing lineups and starters now reduce probabilities instead of creating fake high-confidence grades.</p>
  `;
}

function renderReasons(listElement, reasons) {
  listElement.innerHTML = '';
  (reasons || []).forEach((reason) => {
    const item = document.createElement('li');
    item.textContent = reason;
    listElement.appendChild(item);
  });
}

function setFactor(element, label, text) {
  element.innerHTML = `<span>${escapeHtml(label)}</span><strong>${escapeHtml(text)}</strong>`;
}

function lineupText(game) {
  const away = game.away.lineup?.confirmed ? 'CONF' : 'TBD';
  const home = game.home.lineup?.confirmed ? 'CONF' : 'TBD';
  return `${game.away.abbrev} ${away} // ${game.home.abbrev} ${home}`;
}

function starterText(game) {
  const away = game.away;
  const home = game.home;
  return `${away.starter.name} ${fmtNum(away.model?.starter, 1)} vs ${home.starter.name} ${fmtNum(home.model?.starter, 1)}`;
}

function bullpenText(game) {
  return `${game.away.abbrev} ${fmtNum(game.away.model?.bullpen, 1)} vs ${game.home.abbrev} ${fmtNum(game.home.model?.bullpen, 1)}`;
}

function formText(game) {
  const away = game.away.hitting?.recent || {};
  const home = game.home.hitting?.recent || {};
  return `${game.away.abbrev} ${fmtNum(away.runsPerGame, 2)} R/G vs ${game.home.abbrev} ${fmtNum(home.runsPerGame, 2)} R/G`;
}

function renderCard(game, index) {
  const node = $('#gameCardTemplate').content.cloneNode(true);
  const card = node.querySelector('.game-card');
  const prediction = game.prediction || {};
  const probability = Number(prediction.winProbability || 0);
  const readiness = prediction.readiness || 'LIMITED';
  const decision = prediction.decision || 'PASS';

  card.dataset.decision = decision;
  card.dataset.readiness = readiness;
  card.style.setProperty('--reveal-delay', `${Math.min(index * 28, 360)}ms`);

  card.querySelector('.game-status').textContent = game.status || Core.timeBucket(game);
  card.querySelector('.game-time-chip').textContent = compactStartTime(game.startTime);
  card.querySelector('.lineup-chip').textContent = game.away.lineup?.confirmed && game.home.lineup?.confirmed ? 'LINEUPS CONFIRMED' : 'LINEUPS PENDING';
  card.querySelector('.matchup').textContent = game.matchup;
  card.querySelector('.venue').textContent = `${game.venue || 'Venue TBD'} // ${cleanStartTime(game.startTime)}`;
  card.querySelector('.model-state').innerHTML = `${escapeHtml(readiness)}<small>DATA ${fmtNum(Number(prediction.dataCompleteness || 0) * 100, 0)}%</small>`;
  card.querySelector('.winner').textContent = prediction.headline || 'No pick';
  card.querySelector('.primary-reason').textContent = prediction.primaryReason || 'Model data unavailable.';
  card.querySelector('.win-prob-value').textContent = fmtPct(probability);
  card.querySelector('.prob-track i').style.width = `${clamp(probability * 100, 0, 100)}%`;
  card.querySelector('.decision').textContent = decision;
  card.querySelector('.projected-score').textContent = `PROJECTED // ${game.away.abbrev} ${fmtNum(game.away.model?.projectedRuns, 2)} - ${fmtNum(game.home.model?.projectedRuns, 2)} ${game.home.abbrev}`;

  setFactor(card.querySelector('.lineup-factor'), 'LINEUP STATUS', lineupText(game));
  setFactor(card.querySelector('.pitcher-factor'), 'STARTER INDEX', starterText(game));
  setFactor(card.querySelector('.bullpen-factor'), 'BULLPEN INDEX', bullpenText(game));
  setFactor(card.querySelector('.form-factor'), 'RECENT OFFENSE', formText(game));

  card.querySelector('.away-title').textContent = `${game.away.abbrev} DATA`;
  card.querySelector('.home-title').textContent = `${game.home.abbrev} DATA`;
  renderReasons(card.querySelector('.away-reasons'), game.away.reasons);
  renderReasons(card.querySelector('.home-reasons'), game.home.reasons);
  return node;
}

function publishAiReadableData() {
  const feed = Core.buildFeed(state.payload || {});
  const json = JSON.stringify(feed, null, 2);
  window.DIAMOND_ORACLE_PICKS = feed;
  $('#diamondOracleData').textContent = json;
  $('#aiReadableJson').textContent = json;
}

function renderFilteredBoard() {
  const visibleGames = getVisibleGames();
  const grid = $('#boardGrid');
  $('#summary').innerHTML = summaryMarkup(visibleGames);
  grid.innerHTML = '';

  if (!visibleGames.length) {
    grid.innerHTML = `
      <div class="empty-state arcade-panel">
        <strong>NO GAMES MATCH</strong>
        <span>Change the data-state or game-state filter.</span>
      </div>
    `;
    return;
  }

  visibleGames.forEach((game, index) => grid.appendChild(renderCard(game, index)));
}

async function copyAiJson() {
  const feed = window.DIAMOND_ORACLE_PICKS || Core.buildFeed(state.payload || {});
  const json = JSON.stringify(feed, null, 2);
  const button = $('#copyJsonBtn');
  try {
    await navigator.clipboard.writeText(json);
    const original = button.textContent;
    button.textContent = 'COPIED';
    setTimeout(() => { button.textContent = original; }, 1200);
  } catch (error) {
    $('#aiReadableJson').focus();
    console.warn('Clipboard copy failed.', error);
  }
}

async function loadBoard() {
  const button = $('#loadBtn');
  const date = $('#dateInput').value || Core.todayPacific();
  button.disabled = true;
  button.textContent = 'SCANNING';
  $('#boardGrid').innerHTML = '';
  setLoading(0, 0);
  updateDataStatus('SCANNING MLB', 'Loading schedule, lineups, recent form, starters, and bullpens.');

  try {
    const payload = await Core.generateBoard(date, ({ completed, total }) => {
      setLoading(completed, total);
      updateDataStatus('BUILDING BOARD', `${completed} of ${total} matchups analyzed.`);
    });
    state.payload = payload;
    state.analysis = payload.analysis || [];
    publishAiReadableData();
    renderFilteredBoard();
    updateDataStatus('SCAN COMPLETE', `${state.analysis.length} game(s) loaded with version-two logic.`);
  } catch (error) {
    $('#summary').innerHTML = `<p class="error">${escapeHtml(error.message)}. The browser must be able to reach the public MLB Stats API.</p>`;
    updateDataStatus('DATA ERROR', 'Check the connection or browser content blockers.');
  } finally {
    button.disabled = false;
    button.textContent = 'RUN SCAN';
  }
}

$('#dateInput').value = Core.todayPacific();
$('#loadBtn').addEventListener('click', loadBoard);
$('#copyJsonBtn').addEventListener('click', copyAiJson);
['sortSelect', 'readinessFilter', 'timeFilter'].forEach((id) => {
  $(`#${id}`).addEventListener('change', renderFilteredBoard);
});
loadBoard();

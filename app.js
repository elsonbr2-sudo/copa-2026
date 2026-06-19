(() => {
  "use strict";

  const TIMEZONE = "America/Sao_Paulo";
  const REFRESH_DATA_MS = 60_000; // re-busca os JSONs estáticos (atualizados pela GitHub Action)
  const RECOMPUTE_MS = 15_000; // recalcula estados "ao vivo" sem precisar refazer o fetch
  const LIVE_FALLBACK_MINUTES = 125; // duração média de uma partida (90min + intervalo + acréscimos)

  const state = {
    matches: [],
    standings: [],
    meta: null,
  };

  const els = {
    clock: document.getElementById("clock"),
    lastUpdated: document.getElementById("last-updated"),
    todayDateLabel: document.getElementById("today-date-label"),
    todayMatches: document.getElementById("today-matches"),
    resultsList: document.getElementById("results-list"),
    standingsGrid: document.getElementById("standings-grid"),
  };

  const STATUS_LABELS = {
    SCHEDULED: "Agendado",
    TIMED: "Agendado",
    IN_PLAY: "Em andamento",
    PAUSED: "Intervalo",
    FINISHED: "Encerrado",
    SUSPENDED: "Suspenso",
    POSTPONED: "Adiado",
    CANCELLED: "Cancelado",
    AWARDED: "Encerrado (W.O.)",
  };

  // ---------- Utilidades de data/hora ----------

  function todayKeyInSP() {
    return new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(new Date());
  }

  function matchDateKeyInSP(utcDate) {
    return new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(new Date(utcDate));
  }

  function formatKickoffTime(utcDate) {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: TIMEZONE,
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(utcDate));
  }

  function formatLongDate(dateKey) {
    const d = new Date(`${dateKey}T12:00:00Z`);
    const formatted = new Intl.DateTimeFormat("pt-BR", {
      timeZone: TIMEZONE,
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
    }).format(d);
    return formatted.charAt(0).toUpperCase() + formatted.slice(1);
  }

  function formatUpdatedAt(iso) {
    if (!iso) return "—";
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: TIMEZONE,
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  }

  function tickClock() {
    els.clock.textContent = new Intl.DateTimeFormat("pt-BR", {
      timeZone: TIMEZONE,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date()) + " (Brasília)";
  }

  // ---------- Lógica de status / "ao vivo" ----------

  function getMatchPhase(match, now) {
    const kickoff = new Date(match.utcDate);
    const minutesSinceKickoff = (now - kickoff) / 60000;

    if (match.status === "IN_PLAY" || match.status === "PAUSED") {
      return { isLive: true, label: match.status === "PAUSED" ? "Intervalo" : "Ao vivo" };
    }

    const stillOpen = ["SCHEDULED", "TIMED"].includes(match.status);
    if (stillOpen && minutesSinceKickoff >= 0 && minutesSinceKickoff < LIVE_FALLBACK_MINUTES) {
      return { isLive: true, label: "Ao vivo" };
    }

    return { isLive: false, label: STATUS_LABELS[match.status] || match.status };
  }

  function groupLabel(rawGroup) {
    if (!rawGroup) return "";
    return rawGroup.replace("GROUP_", "Grupo ");
  }

  // ---------- Render: Jogos do dia ----------

  function renderToday() {
    const todayKey = todayKeyInSP();
    els.todayDateLabel.textContent = `Jogos de hoje — ${formatLongDate(todayKey)}`;

    const todayMatches = state.matches
      .filter((m) => matchDateKeyInSP(m.utcDate) === todayKey)
      .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));

    if (todayMatches.length === 0) {
      els.todayMatches.innerHTML = `<p class="empty-state">Nenhuma partida marcada para hoje. Confira a aba "Resultados" ou "Classificação".</p>`;
      return;
    }

    const now = new Date();
    els.todayMatches.innerHTML = todayMatches.map((m) => renderMatchCard(m, now)).join("");
  }

  function renderMatchCard(match, now) {
    const phase = getMatchPhase(match, now);
    const home = match.homeTeam;
    const away = match.awayTeam;
    const hasScore = match.score?.fullTime?.home !== null && match.score?.fullTime?.home !== undefined;
    const finished = match.status === "FINISHED" || match.status === "AWARDED";

    const scoreBlock = phase.isLive || finished || hasScore
      ? `<div class="match-card__score-value">${match.score?.fullTime?.home ?? 0}<span class="sep">×</span>${match.score?.fullTime?.away ?? 0}</div>`
      : `<div class="match-card__kickoff">${formatKickoffTime(match.utcDate)}</div>`;

    const topRight = phase.isLive
      ? `<span class="live-badge"><span class="live-badge__dot" aria-hidden="true"></span>AO VIVO</span>`
      : `<span class="status-chip ${finished ? "status-chip--finished" : ""}">${phase.label}</span>`;

    return `
      <article class="match-card ${phase.isLive ? "match-card--live" : ""}">
        <div class="match-card__top">
          <span>${groupLabel(match.group)}</span>
          ${topRight}
        </div>
        <div class="match-card__teams">
          ${renderTeam(home)}
          <div class="match-card__score">${scoreBlock}</div>
          ${renderTeam(away)}
        </div>
        <div class="match-card__bottom">
          <span>${formatKickoffTime(match.utcDate)} (Brasília)</span>
          <span>Rodada ${match.matchday ?? "—"}</span>
        </div>
      </article>
    `;
  }

  function renderTeam(team) {
    if (!team) return `<div class="team"><span class="team__name">A definir</span></div>`;
    return `
      <div class="team">
        ${team.crest ? `<img class="team__crest" src="${team.crest}" alt="Bandeira/escudo de ${team.name}" loading="lazy" />` : ""}
        <span class="team__name">${team.name}</span>
      </div>
    `;
  }

  // ---------- Render: Resultados ----------

  function renderResults() {
    const finished = state.matches
      .filter((m) => m.status === "FINISHED" || m.status === "AWARDED")
      .sort((a, b) => new Date(b.utcDate) - new Date(a.utcDate));

    if (finished.length === 0) {
      els.resultsList.innerHTML = `<p class="empty-state">Ainda não há resultados registrados.</p>`;
      return;
    }

    const byMatchday = new Map();
    for (const m of finished) {
      const key = m.matchday ?? "—";
      if (!byMatchday.has(key)) byMatchday.set(key, []);
      byMatchday.get(key).push(m);
    }

    const sections = [...byMatchday.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([matchday, matches]) => `
        <div>
          <h3 class="results-group__title">Rodada ${matchday}</h3>
          <div class="results-rows">
            ${matches.map(renderResultRow).join("")}
          </div>
        </div>
      `);

    els.resultsList.innerHTML = sections.join("");
  }

  function renderResultRow(match) {
    const date = new Intl.DateTimeFormat("pt-BR", {
      timeZone: TIMEZONE,
      day: "2-digit",
      month: "2-digit",
    }).format(new Date(match.utcDate));

    return `
      <div class="result-row">
        <span class="result-row__date">${date}</span>
        <span class="result-row__team">
          ${match.homeTeam?.crest ? `<img class="result-row__crest" src="${match.homeTeam.crest}" alt="" loading="lazy" />` : ""}
          <span class="result-row__name">${match.homeTeam?.name ?? "A definir"}</span>
        </span>
        <span class="result-row__score">${match.score?.fullTime?.home ?? "-"} × ${match.score?.fullTime?.away ?? "-"}</span>
        <span class="result-row__team result-row__team--away">
          ${match.awayTeam?.crest ? `<img class="result-row__crest" src="${match.awayTeam.crest}" alt="" loading="lazy" />` : ""}
          <span class="result-row__name">${match.awayTeam?.name ?? "A definir"}</span>
        </span>
        <span class="result-row__group">${groupLabel(match.group)}</span>
      </div>
    `;
  }

  // ---------- Render: Classificação ----------

  function renderStandings() {
    if (state.standings.length === 0) {
      els.standingsGrid.innerHTML = `<p class="empty-state">Classificação ainda não disponível.</p>`;
      return;
    }

    const sorted = [...state.standings].sort((a, b) => a.group.localeCompare(b.group));

    els.standingsGrid.innerHTML = sorted.map((groupStanding) => `
      <div class="group-card">
        <div class="group-card__title">${groupStanding.group}</div>
        <table class="group-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Time</th>
              <th>PJ</th>
              <th>V</th>
              <th>E</th>
              <th>D</th>
              <th>SG</th>
              <th class="pts">Pts</th>
            </tr>
          </thead>
          <tbody>
            ${groupStanding.table.map((row, idx) => `
              <tr class="${idx < 2 ? "is-qualified" : ""}">
                <td><span class="standings-pos">${row.position}</span></td>
                <td>
                  <span class="standings-team">
                    ${row.team?.crest ? `<img src="${row.team.crest}" alt="" loading="lazy" />` : ""}
                    ${row.team?.shortName ?? row.team?.name}
                  </span>
                </td>
                <td>${row.playedGames}</td>
                <td>${row.won}</td>
                <td>${row.draw}</td>
                <td>${row.lost}</td>
                <td>${row.goalDifference > 0 ? "+" : ""}${row.goalDifference}</td>
                <td class="pts">${row.points}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `).join("");
  }

  // ---------- Render geral ----------

  function renderAll() {
    renderToday();
    renderResults();
    renderStandings();
  }

  // ---------- Carregamento de dados ----------

  async function loadJSON(path) {
    const res = await fetch(`${path}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`Falha ao carregar ${path}: HTTP ${res.status}`);
    return res.json();
  }

  async function loadData() {
    try {
      const [matchesData, standingsData, meta] = await Promise.all([
        loadJSON("data/matches.json"),
        loadJSON("data/standings.json"),
        loadJSON("data/meta.json"),
      ]);
      state.matches = matchesData.matches ?? [];
      state.standings = standingsData.standings ?? [];
      state.meta = meta;
      els.lastUpdated.textContent = `Atualizado em ${formatUpdatedAt(meta.fetchedAt)}`;
      renderAll();
    } catch (err) {
      console.error(err);
      els.lastUpdated.textContent = "Não foi possível atualizar os dados agora.";
      if (state.matches.length === 0) {
        const msg = `<p class="empty-state">Não foi possível carregar os dados. Verifique sua conexão ou tente novamente em alguns minutos.</p>`;
        els.todayMatches.innerHTML = msg;
        els.resultsList.innerHTML = msg;
        els.standingsGrid.innerHTML = msg;
      }
    }
  }

  // ---------- Abas ----------

  function setupTabs() {
    const buttons = document.querySelectorAll(".tab");
    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const target = btn.dataset.tab;

        buttons.forEach((b) => b.setAttribute("aria-selected", String(b === btn)));

        document.querySelectorAll(".panel").forEach((panel) => {
          const isTarget = panel.id === `tab-${target}`;
          panel.classList.toggle("is-hidden", !isTarget);
          panel.hidden = !isTarget;
        });
      });
    });
  }

  // ---------- Inicialização ----------

  function init() {
    setupTabs();
    tickClock();
    setInterval(tickClock, 1000);

    loadData();
    setInterval(loadData, REFRESH_DATA_MS);
    setInterval(renderAll, RECOMPUTE_MS);
  }

  document.addEventListener("DOMContentLoaded", init);
})();

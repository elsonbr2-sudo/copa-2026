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
    knockoutBracket: document.getElementById("knockout-bracket"),
  };

  // Estrutura oficial da fase de 32 avos da Copa 2026 (12 grupos, top 2 de cada
  // + 8 melhores 3os colocados). Fonte: regulamento da FIFA / Wikipedia
  // "2026 FIFA World Cup knockout stage". Os jogos 73-88 são, por definição,
  // ordenados cronologicamente — por isso casamos este array (na mesma ordem)
  // com os jogos LAST_32 da API ordenados por data, em vez de depender de IDs.
  const R32_BRACKET = [
    { id: 73, home: { kind: "runnerup", group: "A" }, away: { kind: "runnerup", group: "B" } },
    { id: 74, home: { kind: "winner", group: "E" }, away: { kind: "best3", groups: ["A", "B", "C", "D", "F"] } },
    { id: 75, home: { kind: "winner", group: "F" }, away: { kind: "runnerup", group: "C" } },
    { id: 76, home: { kind: "winner", group: "C" }, away: { kind: "runnerup", group: "F" } },
    { id: 77, home: { kind: "winner", group: "I" }, away: { kind: "best3", groups: ["C", "D", "F", "G", "H"] } },
    { id: 78, home: { kind: "runnerup", group: "E" }, away: { kind: "runnerup", group: "I" } },
    { id: 79, home: { kind: "winner", group: "A" }, away: { kind: "best3", groups: ["C", "E", "F", "H", "I"] } },
    { id: 80, home: { kind: "winner", group: "L" }, away: { kind: "best3", groups: ["E", "H", "I", "J", "K"] } },
    { id: 81, home: { kind: "winner", group: "D" }, away: { kind: "best3", groups: ["B", "E", "F", "I", "J"] } },
    { id: 82, home: { kind: "winner", group: "G" }, away: { kind: "best3", groups: ["A", "E", "H", "I", "J"] } },
    { id: 83, home: { kind: "runnerup", group: "K" }, away: { kind: "runnerup", group: "L" } },
    { id: 84, home: { kind: "winner", group: "H" }, away: { kind: "runnerup", group: "J" } },
    { id: 85, home: { kind: "winner", group: "B" }, away: { kind: "best3", groups: ["E", "F", "G", "I", "J"] } },
    { id: 86, home: { kind: "winner", group: "J" }, away: { kind: "runnerup", group: "H" } },
    { id: 87, home: { kind: "winner", group: "K" }, away: { kind: "best3", groups: ["D", "E", "I", "J", "L"] } },
    { id: 88, home: { kind: "runnerup", group: "D" }, away: { kind: "runnerup", group: "G" } },
  ];

  // Numeração oficial FIFA para as fases seguintes
  const KNOCKOUT_IDS = {
    r16:   [89, 90, 91, 92, 93, 94, 95, 96],
    qf:    [97, 98, 99, 100],
    sf:    [101, 102],
    third: 103,
    final: 104,
  };
  // Jogos que alimentam cada slot (ordem = mesma do R32_BRACKET)
  const R16_FEEDERS = [[73,74],[75,76],[77,78],[79,80],[81,82],[83,84],[85,86],[87,88]];
  const QF_FEEDERS  = [[89,90],[91,92],[93,94],[95,96]];
  const SF_FEEDERS  = [[97,98],[99,100]];

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

  // ---------- Render: Próxima fase (chaveamento 32 avos) ----------

  function groupLetterFromMatch(raw) {
    return raw ? raw.replace("GROUP_", "") : null;
  }

  function groupLetterFromStandings(raw) {
    return raw ? raw.replace("Group ", "").trim() : null;
  }

  function standingsTableFor(letter) {
    const entry = state.standings.find((s) => groupLetterFromStandings(s.group) === letter);
    return entry?.table ?? null;
  }

  function slotLabel(slotRef) {
    if (slotRef.kind === "winner") return `1º Grupo ${slotRef.group}`;
    if (slotRef.kind === "runnerup") return `2º Grupo ${slotRef.group}`;
    return `Melhor 3º (${slotRef.groups.join("/")})`;
  }

  function slotLabelShort(slotRef) {
    if (slotRef.kind === "winner")   return `1º Gr.${slotRef.group}`;
    if (slotRef.kind === "runnerup") return `2º Gr.${slotRef.group}`;
    return `3º ${slotRef.groups.join("/")}`;
  }

  // Para um grupo ainda em andamento, simula todos os resultados possíveis dos
  // jogos restantes (vitória casa/empate/vitória fora) e retorna, para a
  // posição pedida (1=1º, 2=2º...), todos os times que ainda podem terminar
  // ali em pelo menos um cenário. Empates em pontos são tratados como "ambos
  // possíveis" para aquela posição, já que o saldo de gols dos jogos futuros
  // ainda não é conhecido.
  function candidatesForGroupPosition(letter, position, table) {
    const teams = table.map((r) => ({ id: r.team.id, team: r.team, points: r.points }));
    const groupMatches = state.matches.filter(
      (m) => m.stage === "GROUP_STAGE" && groupLetterFromMatch(m.group) === letter
    );
    const remaining = groupMatches.filter(
      (m) => !["FINISHED", "AWARDED"].includes(m.status) && m.homeTeam?.id && m.awayTeam?.id
    );
    const n = remaining.length;
    const possiblePositions = new Map(teams.map((t) => [t.id, new Set()]));

    if (n === 0 || n > 8) {
      table.forEach((r) => possiblePositions.get(r.team.id)?.add(r.position));
    } else {
      const outcomes = [
        [3, 0],
        [1, 1],
        [0, 3],
      ];
      const totalCombos = 3 ** n;
      for (let combo = 0; combo < totalCombos; combo++) {
        const pts = new Map(teams.map((t) => [t.id, t.points]));
        let c = combo;
        for (let i = 0; i < n; i++) {
          const outcomeIdx = c % 3;
          c = Math.floor(c / 3);
          const [hp, ap] = outcomes[outcomeIdx];
          const m = remaining[i];
          pts.set(m.homeTeam.id, (pts.get(m.homeTeam.id) ?? 0) + hp);
          pts.set(m.awayTeam.id, (pts.get(m.awayTeam.id) ?? 0) + ap);
        }
        const sorted = [...teams].sort((a, b) => pts.get(b.id) - pts.get(a.id));
        let i = 0;
        while (i < sorted.length) {
          let j = i;
          while (j + 1 < sorted.length && pts.get(sorted[j + 1].id) === pts.get(sorted[i].id)) j++;
          for (let k = i; k <= j; k++) {
            for (let pos = i + 1; pos <= j + 1; pos++) possiblePositions.get(sorted[k].id).add(pos);
          }
          i = j + 1;
        }
      }
    }

    return teams.filter((t) => possiblePositions.get(t.id).has(position)).map((t) => t.team);
  }

  function resolveSide(slotRef, apiTeam) {
    const label = slotLabel(slotRef);

    if (apiTeam && apiTeam.id) {
      return { state: "defined", label, team: apiTeam };
    }

    if (slotRef.kind === "best3") {
      const candidates = slotRef.groups
        .map((g) => {
          const table = standingsTableFor(g);
          const row = table?.find((r) => r.position === 3);
          if (!row?.team) return null;
          return {
            code: row.team.tla || g,
            crest: row.team.crest,
            title: `${row.team.name} — 3º colocado do Grupo ${g}`,
          };
        })
        .filter(Boolean);
      return { state: "pending", label, candidates };
    }

    const position = slotRef.kind === "winner" ? 1 : 2;
    const table = standingsTableFor(slotRef.group);
    if (!table) return { state: "pending", label, candidates: [] };

    const finished = table.every((r) => r.playedGames === table.length - 1);
    if (finished) {
      const row = table.find((r) => r.position === position);
      return { state: "defined", label, team: row.team };
    }

    const candidateTeams = candidatesForGroupPosition(slotRef.group, position, table);
    if (candidateTeams.length === 1) {
      return { state: "defined", label, team: candidateTeams[0] };
    }

    return {
      state: "pending",
      label,
      candidates: candidateTeams.map((t) => ({
        code: t.tla,
        crest: t.crest,
        title: `${t.name} — ainda em disputa`,
      })),
    };
  }

  function renderBtSlot(resolved, slotRef) {
    if (resolved.state === "defined") {
      const t = resolved.team;
      const img = t.crest ? `<img class="bt-crest" src="${t.crest}" alt="" loading="lazy">` : "";
      return `<div class="bt-slot bt-slot--defined">${img}<span class="bt-name">${t.tla || t.shortName || t.name}</span></div>`;
    }
    const shown = resolved.candidates.slice(0, 4);
    const extra = resolved.candidates.length - shown.length;
    const chips = shown.map((c) => {
      const img = c.crest ? `<img src="${c.crest}" alt="">` : "";
      return `<span class="bt-chip" title="${c.title}">${img}<span>${c.code}</span></span>`;
    }).join("");
    const moreChip = extra > 0 ? `<span class="bt-chip bt-chip--more">+${extra}</span>` : "";
    return `<div class="bt-slot bt-slot--pending"><span class="bt-slot-label">${slotLabelShort(slotRef)}</span><div class="bt-chips">${chips || `<span class="bt-chip bt-chip--unknown">?</span>`}${moreChip}</div></div>`;
  }

  function renderBtFeederSlot(gameId) {
    return `<div class="bt-slot bt-slot--feeder"><span class="bt-feeder">V M${gameId}</span></div>`;
  }

  function fmtBtDate(utcDate) {
    if (!utcDate) return "A definir";
    const d = new Date(utcDate);
    const date = new Intl.DateTimeFormat("pt-BR", { timeZone: TIMEZONE, day: "2-digit", month: "2-digit" }).format(d);
    return `${date} · ${formatKickoffTime(utcDate)}`;
  }

  function renderBtNode(gameId, utcDate, homeHtml, awayHtml) {
    return `<div class="bt-node"><article class="bt-card"><div class="bt-meta">M${gameId} · ${fmtBtDate(utcDate)}</div>${homeHtml}<div class="bt-vs" aria-hidden="true"></div>${awayHtml}</article></div>`;
  }

  function renderKnockout() {
    if (!els.knockoutBracket) return;

    if (state.standings.length === 0 || state.matches.length === 0) {
      els.knockoutBracket.innerHTML = `<p class="empty-state">Carregando chaveamento…</p>`;
      return;
    }

    const byStage = (s) => state.matches.filter((m) => m.stage === s).sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));
    const last32 = byStage("LAST_32");
    const last16 = byStage("LAST_16");
    const qfs    = byStage("QUARTER_FINALS");
    const sfs    = byStage("SEMI_FINALS");
    const finals = byStage("FINAL");

    if (last32.length !== 16) {
      els.knockoutBracket.innerHTML = `<p class="empty-state">O chaveamento ainda não está disponível.</p>`;
      return;
    }

    const ids = KNOCKOUT_IDS;

    function r32Node(idx) {
      const slot = R32_BRACKET[idx];
      const api  = last32[idx];
      const home = resolveSide(slot.home, api.homeTeam);
      const away = resolveSide(slot.away, api.awayTeam);
      return renderBtNode(slot.id, api.utcDate, renderBtSlot(home, slot.home), renderBtSlot(away, slot.away));
    }

    function fNode(gameId, utcDate, fa, fb) {
      return renderBtNode(gameId, utcDate, renderBtFeederSlot(fa), renderBtFeederSlot(fb));
    }

    const p = (...nodes) => `<div class="bt-pair">${nodes.join("")}</div>`;

    const colL_r32 = [p(r32Node(0),r32Node(1)), p(r32Node(2),r32Node(3)), p(r32Node(4),r32Node(5)), p(r32Node(6),r32Node(7))].join("");
    const colR_r32 = [p(r32Node(8),r32Node(9)), p(r32Node(10),r32Node(11)), p(r32Node(12),r32Node(13)), p(r32Node(14),r32Node(15))].join("");

    const colL_r16 = [
      p(fNode(ids.r16[0], last16[0]?.utcDate, 73, 74), fNode(ids.r16[1], last16[1]?.utcDate, 75, 76)),
      p(fNode(ids.r16[2], last16[2]?.utcDate, 77, 78), fNode(ids.r16[3], last16[3]?.utcDate, 79, 80)),
    ].join("");
    const colR_r16 = [
      p(fNode(ids.r16[4], last16[4]?.utcDate, 81, 82), fNode(ids.r16[5], last16[5]?.utcDate, 83, 84)),
      p(fNode(ids.r16[6], last16[6]?.utcDate, 85, 86), fNode(ids.r16[7], last16[7]?.utcDate, 87, 88)),
    ].join("");

    const colL_qf = p(fNode(ids.qf[0], qfs[0]?.utcDate, 89, 90), fNode(ids.qf[1], qfs[1]?.utcDate, 91, 92));
    const colR_qf = p(fNode(ids.qf[2], qfs[2]?.utcDate, 93, 94), fNode(ids.qf[3], qfs[3]?.utcDate, 95, 96));

    const colL_sf  = renderBtNode(ids.sf[0],  sfs[0]?.utcDate,    renderBtFeederSlot(97),  renderBtFeederSlot(98));
    const colR_sf  = renderBtNode(ids.sf[1],  sfs[1]?.utcDate,    renderBtFeederSlot(99),  renderBtFeederSlot(100));
    const colFinal = renderBtNode(ids.final,  finals[0]?.utcDate, renderBtFeederSlot(101), renderBtFeederSlot(102));

    els.knockoutBracket.innerHTML = `
      <div class="bracket-tree">
        <div class="bt-stages">
          <span>32 avos</span><span>16 avos</span><span>Quartas</span><span>Semis</span>
          <span class="is-final">Final</span>
          <span>Semis</span><span>Quartas</span><span>16 avos</span><span>32 avos</span>
        </div>
        <div class="bt-body">
          <div class="bt-col" data-round="r32" data-side="left">${colL_r32}</div>
          <div class="bt-col" data-round="r16" data-side="left">${colL_r16}</div>
          <div class="bt-col" data-round="qf"  data-side="left">${colL_qf}</div>
          <div class="bt-col" data-round="sf"  data-side="left">${colL_sf}</div>
          <div class="bt-col" data-round="final">${colFinal}</div>
          <div class="bt-col" data-round="sf"  data-side="right">${colR_sf}</div>
          <div class="bt-col" data-round="qf"  data-side="right">${colR_qf}</div>
          <div class="bt-col" data-round="r16" data-side="right">${colR_r16}</div>
          <div class="bt-col" data-round="r32" data-side="right">${colR_r32}</div>
        </div>
      </div>
    `;
  }

  // ---------- Render geral ----------

  function renderAll() {
    renderToday();
    renderResults();
    renderStandings();
    renderKnockout();
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

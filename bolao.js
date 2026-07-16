(() => {
  "use strict";

  const TOKEN_KEY = "sinuca-bolao-token-v1";
  const SYNC_INTERVAL_MS = 5000;
  const DEFAULT_STAKE = 50;

  const dom = {
    content: document.querySelector("#pool-content"),
    title: document.querySelector("#pool-title"),
    liveStatus: document.querySelector("#pool-live-status"),
    toastRegion: document.querySelector("#pool-toast-region"),
    confirmDialog: document.querySelector("#pool-confirm-dialog"),
    confirmTitle: document.querySelector("#pool-confirm-title"),
    confirmMessage: document.querySelector("#pool-confirm-message"),
    confirmAction: document.querySelector("#pool-confirm-action"),
  };

  let appState = null;
  let betting = {
    profile: null,
    leaderboard: [],
    myBets: [],
    settings: { initialBalance: 10000, maxStake: 500, payoutMultiplier: 2 },
  };
  let adminAuthenticated = false;
  let syncInProgress = false;
  let confirmResolver = null;

  function token() {
    try {
      return localStorage.getItem(TOKEN_KEY) || "";
    } catch (error) {
      console.warn("Não foi possível acessar o token local.", error);
      return "";
    }
  }

  function saveToken(value) {
    try {
      if (value) localStorage.setItem(TOKEN_KEY, value);
      else localStorage.removeItem(TOKEN_KEY);
    } catch (error) {
      console.warn("Não foi possível salvar o token local.", error);
    }
  }

  async function fetchJSON(url, options = {}) {
    const headers = new Headers(options.headers || {});
    if (token()) headers.set("X-Bettor-Token", token());
    if (options.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    const response = await fetch(url, { ...options, headers, cache: "no-store" });
    let payload = {};
    try {
      payload = await response.json();
    } catch (error) {
      payload = {};
    }
    if (!response.ok) {
      const failure = new Error(payload.error || `Falha HTTP ${response.status}`);
      failure.status = response.status;
      throw failure;
    }
    return payload;
  }

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    })[character]);
  }

  function formatNumber(value) {
    return new Intl.NumberFormat("pt-BR").format(Number(value) || 0);
  }

  function formatDateTime(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(date);
  }

  function cleanText(value, fallback = "") {
    if (value === null || value === undefined) return fallback;
    const text = String(value).trim();
    return text || fallback;
  }

  function normalizeKey(value) {
    return cleanText(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[\s_]+/g, "-");
  }

  function normalizeDateTime(value) {
    const text = cleanText(value);
    if (!text) return "";
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? "" : text;
  }

  function combineLegacyDateTime(entry) {
    const date = cleanText(entry.date || entry.scheduledDate || entry.dia);
    if (!date) return "";
    const time = cleanText(entry.time || entry.scheduledTime || entry.horario, "00:00");
    const offset = cleanText(entry.offset || entry.timezoneOffset || entry.utcOffset);
    return normalizeDateTime(`${date}T${time.length === 5 ? `${time}:00` : time}${offset}`);
  }

  function normalizeProgrammingStatus(value, fallback = "unscheduled") {
    const aliases = {
      unscheduled: "unscheduled",
      pending: "unscheduled",
      pendente: "unscheduled",
      "nao-agendado": "unscheduled",
      scheduled: "scheduled",
      agendado: "scheduled",
      confirmado: "scheduled",
      postponed: "postponed",
      adiado: "postponed",
      remarcado: "postponed",
      cancelled: "cancelled",
      canceled: "cancelled",
      cancelado: "cancelled",
    };
    return aliases[normalizeKey(value)] || fallback;
  }

  function normalizeProgrammingEntry(value) {
    const entry = typeof value === "string"
      ? { scheduledAt: value }
      : value && typeof value === "object" && !Array.isArray(value)
        ? value
        : {};
    const scheduledAt = normalizeDateTime(
      entry.scheduledAt ||
      entry.dateTime ||
      entry.startsAt ||
      entry.start ||
      entry.datetime ||
      combineLegacyDateTime(entry),
    );
    const inferredStatus = scheduledAt ? "scheduled" : "unscheduled";
    let status = normalizeProgrammingStatus(
      entry.status || entry.state || entry.situacao,
      inferredStatus,
    );
    if (status === "scheduled" && !scheduledAt) status = "unscheduled";
    return {
      scheduledAt,
      location: cleanText(entry.location || entry.venue || entry.local),
      status,
      publicNote: cleanText(
        entry.publicNote ||
        entry.publicObservation ||
        entry.observacaoPublica ||
        entry.note ||
        entry.observation ||
        entry.observacao,
      ),
    };
  }

  function rawProgrammingEntries(rawProgramming) {
    const raw = rawProgramming && typeof rawProgramming === "object" && !Array.isArray(rawProgramming)
      ? rawProgramming
      : {};
    const source = raw.matches || raw.schedule || raw.scheduledMatches;
    if (Array.isArray(source)) {
      return source
        .filter((entry) => entry && cleanText(entry.matchId || entry.id))
        .map((entry) => [String(entry.matchId || entry.id), entry]);
    }
    if (source && typeof source === "object") return Object.entries(source);
    const reserved = new Set([
      "nextMatchId",
      "next_match_id",
      "nextMatch",
      "featuredMatchIds",
      "featuredMatches",
      "highlights",
    ]);
    return Object.entries(raw).filter(([key]) => !reserved.has(key));
  }

  function normalizedProgramming() {
    const league = appState?.league || {};
    const raw = league.programming && typeof league.programming === "object"
      ? league.programming
      : {};
    const leagueMatches = collectMatches().filter((match) => match.kind === "league");
    const matchesById = new Map(leagueMatches.map((match) => [String(match.id), match]));
    const pendingMatch = (id) => {
      const match = matchesById.get(String(id || ""));
      return match && !match.result ? match : null;
    };
    const matches = {};

    rawProgrammingEntries(raw).forEach(([matchId, entry]) => {
      const id = cleanText(matchId);
      if (!pendingMatch(id)) return;
      matches[id] = normalizeProgrammingEntry(entry);
    });

    const nextCandidate = cleanText(
      raw.nextMatchId ||
      raw.next_match_id ||
      raw.nextMatch?.id ||
      (typeof raw.nextMatch === "string" ? raw.nextMatch : "") ||
      league.nextMatchId,
    );
    const nextMatchId = pendingMatch(nextCandidate) && matches[nextCandidate]?.status !== "cancelled"
      ? nextCandidate
      : null;

    const featuredSource = raw.featuredMatchIds ||
      raw.featuredMatches ||
      raw.highlights ||
      league.featuredMatchIds ||
      [];
    const featuredValues = Array.isArray(featuredSource)
      ? featuredSource
      : Object.keys(
        featuredSource && typeof featuredSource === "object" ? featuredSource : {},
      ).filter((id) => featuredSource[id]);
    const featuredMatchIds = [];
    featuredValues.forEach((value) => {
      const id = cleanText(value?.id || value?.matchId || value);
      if (
        featuredMatchIds.length < 3 &&
        !featuredMatchIds.includes(id) &&
        pendingMatch(id) &&
        matches[id]?.status !== "cancelled"
      ) {
        featuredMatchIds.push(id);
      }
    });

    return { nextMatchId, featuredMatchIds, matches };
  }

  function programmingEntry(matchId, programming = normalizedProgramming()) {
    return programming.matches[matchId] || normalizeProgrammingEntry({});
  }

  function orderedLeagueMatches(matches) {
    const programming = normalizedProgramming();
    const featuredOrder = new Map(
      programming.featuredMatchIds.map((matchId, index) => [matchId, index]),
    );
    const rank = (match, entry) => {
      if (match.inProgress) return 0;
      if (programming.nextMatchId === match.id) return 1;
      if (entry.status === "scheduled" && entry.scheduledAt) return 2;
      if (featuredOrder.has(match.id)) return 3;
      return 4;
    };
    const dateValue = (entry) => {
      if (!entry.scheduledAt) return Number.MAX_SAFE_INTEGER;
      const value = new Date(entry.scheduledAt).getTime();
      return Number.isNaN(value) ? Number.MAX_SAFE_INTEGER : value;
    };

    return [...matches]
      .filter((match) => !match.result)
      .sort((matchA, matchB) => {
        const entryA = programmingEntry(matchA.id, programming);
        const entryB = programmingEntry(matchB.id, programming);
        const rankDifference = rank(matchA, entryA) - rank(matchB, entryB);
        if (rankDifference) return rankDifference;
        if (rank(matchA, entryA) === 2) {
          const dateDifference = dateValue(entryA) - dateValue(entryB);
          if (dateDifference) return dateDifference;
        }
        if (rank(matchA, entryA) === 3) {
          const featuredDifference = featuredOrder.get(matchA.id) - featuredOrder.get(matchB.id);
          if (featuredDifference) return featuredDifference;
        }
        return (matchA.orderIndex || 0) - (matchB.orderIndex || 0);
      });
  }

  function showToast(message, kind = "success") {
    const toast = document.createElement("div");
    toast.className = `toast${kind === "error" ? " is-error" : ""}`;
    toast.innerHTML = `<span>${kind === "error" ? "!" : "✓"}</span><span>${escapeHTML(message)}</span>`;
    dom.toastRegion.append(toast);
    window.setTimeout(() => toast.remove(), 3600);
  }

  function setConnectionStatus(ok, text = "Atualizado") {
    dom.liveStatus.classList.toggle("is-offline", !ok);
    dom.liveStatus.innerHTML = `<span class="status-dot"></span> ${escapeHTML(text)}`;
  }

  function playersMap() {
    return new Map(
      (appState?.players || []).map((player) => [player.id, player.name]),
    );
  }

  function playerName(id, fallback = "A definir") {
    return playersMap().get(id) || fallback;
  }

  function validResult(result, playerAId, playerBId) {
    if (!result || typeof result !== "object") return null;
    const resultPlayerAId = result.playerAId || playerAId;
    const resultPlayerBId = result.playerBId || playerBId;
    if (resultPlayerAId !== playerAId || resultPlayerBId !== playerBId) return null;
    if (![playerAId, playerBId].includes(result.winnerId)) return null;
    return { ...result, playerAId, playerBId };
  }

  function collectMatches() {
    const matches = [];
    if (!appState || typeof appState !== "object") return matches;

    const league = appState.league;
    if (league?.rounds) {
      const results = league.results || {};
      const inProgress = league.inProgress || {};
      let orderIndex = 0;
      league.rounds.forEach((round, roundIndex) => {
        (round.matches || []).forEach((match) => {
          if (!match?.id || !match.playerAId || !match.playerBId) return;
          const result = validResult(results[match.id], match.playerAId, match.playerBId);
          matches.push({
            kind: "league",
            id: match.id,
            roundName: `Liga · Rodada ${round.number || roundIndex + 1}`,
            roundNumber: Number(round.number) || roundIndex + 1,
            orderIndex,
            playerAId: match.playerAId,
            playerBId: match.playerBId,
            result,
            winnerId: result?.winnerId || null,
            inProgress: Boolean(inProgress[match.id]) && !result,
          });
          orderIndex += 1;
        });
      });
    }

    const tournament = appState.tournament;
    if (tournament?.bracketSize && Array.isArray(tournament.seeds)) {
      const bracketSize = Number(tournament.bracketSize);
      const results = tournament.results || {};
      const rounds = [];
      let previous = null;
      const roundCount = Math.log2(bracketSize);
      for (let roundIndex = 0; roundIndex < roundCount; roundIndex += 1) {
        const matchCount = bracketSize / 2 ** (roundIndex + 1);
        const roundNames = {
          1: "Final",
          2: "Semifinais",
          4: "Quartas de final",
          8: "Oitavas de final",
          16: "Primeira fase",
        };
        const roundName = roundNames[matchCount] || `Rodada de ${matchCount * 2}`;
        const current = [];
        for (let matchIndex = 0; matchIndex < matchCount; matchIndex += 1) {
          const id = `r${roundIndex}m${matchIndex}`;
          let playerAId = null;
          let playerBId = null;
          if (roundIndex === 0) {
            playerAId = tournament.seeds[matchIndex * 2] || null;
            playerBId = tournament.seeds[matchIndex * 2 + 1] || null;
          } else {
            playerAId = previous?.[matchIndex * 2]?.winnerId || null;
            playerBId = previous?.[matchIndex * 2 + 1]?.winnerId || null;
          }
          const result = validResult(results[id], playerAId, playerBId);
          const automatic = roundIndex === 0 && Boolean(playerAId) !== Boolean(playerBId);
          const winnerId = automatic
            ? playerAId || playerBId
            : result?.winnerId || null;
          const loserId = result
            ? winnerId === playerAId
              ? playerBId
              : playerAId
            : null;
          current.push({ id, playerAId, playerBId, result, winnerId, loserId });
          if (playerAId && playerBId) {
            matches.push({
              kind: "bracket",
              id,
              roundName: `Mata-mata · ${roundName}`,
              playerAId,
              playerBId,
              result,
              winnerId: result?.winnerId || null,
            });
          }
        }
        rounds.push(current);
        previous = current;
      }

      if (appState.settings?.thirdPlace && rounds.length >= 2) {
        const semifinals = rounds[rounds.length - 2];
        const playerAId = semifinals?.[0]?.loserId || null;
        const playerBId = semifinals?.[1]?.loserId || null;
        const result = validResult(tournament.thirdPlaceResult, playerAId, playerBId);
        if (playerAId && playerBId) {
          matches.push({
            kind: "third",
            id: "third-place",
            roundName: "Mata-mata · Disputa de 3º lugar",
            playerAId,
            playerBId,
            result,
            winnerId: result?.winnerId || null,
          });
        }
      }
    }

    return matches;
  }

  function matchKey(kind, id) {
    return `${kind}:${id}`;
  }

  function myBetsMap() {
    return new Map(
      (betting.myBets || []).map((bet) => [matchKey(bet.matchKind, bet.matchId), bet]),
    );
  }

  function currentMatchesMap() {
    return new Map(collectMatches().map((match) => [matchKey(match.kind, match.id), match]));
  }

  async function loadAll({ quiet = false } = {}) {
    if (syncInProgress) return;
    syncInProgress = true;
    try {
      const [statePayload, bettingPayload, authPayload] = await Promise.all([
        fetchJSON("/api/state"),
        fetchJSON("/api/bets"),
        fetchJSON("/api/auth"),
      ]);
      appState = statePayload.state || null;
      betting = bettingPayload;
      adminAuthenticated = Boolean(authPayload.authenticated);
      if (appState?.settings?.title) {
        dom.title.textContent = appState.settings.title;
        document.title = `Bolão virtual · ${appState.settings.title}`;
      }
      setConnectionStatus(true, "Dados atualizados");
      render();
    } catch (error) {
      console.error(error);
      setConnectionStatus(false, "Servidor indisponível");
      if (!appState) {
        dom.content.innerHTML = `<section class="card pool-loading-card pool-error-card" role="alert">
          <div class="empty-state"><div class="empty-state-icon">!</div><h2>Não foi possível abrir o bolão</h2><p>Verifique sua conexão e tente novamente. Nenhuma aposta foi alterada.</p><button class="button button-primary" type="button" data-pool-action="retry-load">Tentar novamente</button></div>
        </section>`;
      }
      if (!quiet) showToast("Não foi possível carregar o bolão.", "error");
    } finally {
      syncInProgress = false;
    }
  }

  function render() {
    const pendingMatches = collectMatches().filter((match) => !match.result);
    const leagueMatches = orderedLeagueMatches(
      pendingMatches.filter((match) => match.kind === "league"),
    );
    const profile = betting.profile;

    dom.content.innerHTML = `
      <section class="pool-hero">
        <div>
          <span class="eyebrow">Bolão interno</span>
          <h1>Aposte fichas virtuais nas disputas</h1>
          <p>Escolha o vencedor e reserve parte do seu saldo. Acerto aumenta suas fichas; erro mantém a pontuação atual. Não há dinheiro, pagamento ou saque.</p>
        </div>
        <div class="pool-rules-chip"><strong>${formatNumber(betting.settings?.initialBalance || 10000)}</strong><span>fichas iniciais</span></div>
      </section>

      ${profile ? renderProfile(profile) : renderAccessForms()}

      <div class="pool-layout">
        <section class="pool-main-column">
          ${renderBettingSection("Liga por pontos", "Todos contra todos", leagueMatches, "↻")}
          ${profile ? renderMyBets() : ""}
        </section>
        <aside class="pool-side-column">
          ${renderLeaderboard()}
          ${renderRules()}
          ${adminAuthenticated ? renderAdminTools() : ""}
        </aside>
      </div>
    `;
  }

  function renderAccessForms() {
    return `
      <section class="card pool-access-card">
        <div class="card-header">
          <div>
            <h2>Entre no bolão</h2>
            <p>O campeonato continua público; o perfil serve somente para registrar suas apostas.</p>
          </div>
        </div>
        <div class="pool-access-grid">
          <form class="pool-access-form" id="bettor-login-form">
            <h3>Já tenho perfil</h3>
            <label class="field"><span>Nome</span><input name="name" autocomplete="username" maxlength="30" required></label>
            <label class="field"><span>PIN</span><input name="pin" type="password" inputmode="numeric" autocomplete="current-password" minlength="4" maxlength="8" required></label>
            <button class="button button-primary" type="submit">Entrar</button>
          </form>
          <form class="pool-access-form" id="bettor-register-form">
            <h3>Criar perfil</h3>
            <label class="field"><span>Nome no ranking</span><input name="name" autocomplete="nickname" maxlength="30" required></label>
            <label class="field"><span>PIN de 4 a 8 números</span><input name="pin" type="password" inputmode="numeric" autocomplete="new-password" minlength="4" maxlength="8" required></label>
            <label class="field"><span>Confirmar PIN</span><input name="pinConfirm" type="password" inputmode="numeric" autocomplete="new-password" minlength="4" maxlength="8" required></label>
            <button class="button button-primary" type="submit">Criar e receber fichas</button>
          </form>
        </div>
      </section>
    `;
  }

  function renderProfile(profile) {
    const profit = Number(profile.profit) || 0;
    return `
      <section class="card pool-profile-card">
        <div class="pool-profile-head">
          <div class="player-cell">
            <span class="avatar gold">${escapeHTML(initials(profile.name))}</span>
            <div><span class="eyebrow">Seu perfil</span><h2>${escapeHTML(profile.name)}</h2></div>
          </div>
          <button class="button button-small button-ghost" data-pool-action="logout">Sair do bolão</button>
        </div>
        <div class="pool-profile-stats">
          ${poolStat("Disponível", formatNumber(profile.availableBalance), "fichas para apostar")}
          ${poolStat("Saldo apurado", formatNumber(profile.settledBalance), "sem descontar apostas abertas")}
          ${poolStat("Resultado", `${profit > 0 ? "+" : ""}${formatNumber(profit)}`, profit >= 0 ? "lucro virtual" : "prejuízo virtual")}
          ${poolStat("Acertos", `${formatNumber(profile.accuracy)}%`, `${profile.wins || 0} vitória(s) · ${profile.losses || 0} erro(s)`) }
        </div>
      </section>
    `;
  }

  function poolStat(label, value, detail) {
    return `<div class="pool-stat"><span>${escapeHTML(label)}</span><strong>${escapeHTML(value)}</strong><small>${escapeHTML(detail)}</small></div>`;
  }

  function renderBettingSection(title, subtitle, matches, icon) {
    const liveCount = matches.filter((match) => match.inProgress).length;
    const openCount = matches.length - liveCount;
    const programming = normalizedProgramming();
    const nextMatch = programming.nextMatchId
      ? matches.find((match) => match.id === programming.nextMatchId)
      : null;
    return `
      <section class="card pool-matches-card">
        <div class="card-header">
          <div>
            <h2>${escapeHTML(title)}</h2>
            <p>${escapeHTML(subtitle)} · ${openCount} aposta(s) aberta(s)${liveCount ? ` · ${liveCount} em andamento` : ""}.</p>
            <a class="button button-small button-ghost" href="/#schedule">Consultar agenda oficial</a>
          </div>
          <span class="pool-section-icon" aria-hidden="true">${icon}</span>
        </div>
        ${nextMatch ? `<p class="notice" role="status"><span aria-hidden="true">◷</span><span><strong>Próximo jogo oficial:</strong> ${escapeHTML(playerName(nextMatch.playerAId))} × ${escapeHTML(playerName(nextMatch.playerBId))}. A organização escolheu este confronto sem fechar as apostas das demais partidas.</span></p>` : ""}
        <div class="pool-match-list">
          ${matches.length
            ? matches.map((match) => renderBetCard(match, programming)).join("")
            : `<div class="empty-state compact"><div class="empty-state-icon">✓</div><h3>Nenhuma disputa aberta</h3><p>Novas opções aparecem quando os confrontos forem definidos.</p></div>`}
        </div>
      </section>
    `;
  }

  function renderBetCard(match, currentProgramming = null) {
    const existing = myBetsMap().get(matchKey(match.kind, match.id));
    const selected = existing?.predictedWinnerId || "";
    const stake = existing?.stake || Math.min(DEFAULT_STAKE, betting.profile?.availableBalance || DEFAULT_STAKE);
    const isLive = match.kind === "league" && match.inProgress;
    const programming = match.kind === "league"
      ? currentProgramming || normalizedProgramming()
      : null;
    const entry = programming ? programmingEntry(match.id, programming) : normalizeProgrammingEntry({});
    const isNext = programming?.nextMatchId === match.id;
    const isFeatured = programming?.featuredMatchIds.includes(match.id);
    const disabled = !betting.profile || isLive;
    const formId = `bet-${match.kind}-${match.id}`.replace(/[^a-zA-Z0-9_-]/g, "-");
    const badges = [];
    if (isLive) badges.push('<span class="badge badge-live"><i aria-hidden="true"></i>Em andamento</span>');
    if (isNext) badges.push('<span class="badge badge-gold">Próximo jogo oficial</span>');
    if (isFeatured) badges.push('<span class="badge badge-green">Em destaque</span>');
    if (existing) badges.push('<span class="badge badge-gold">Sua aposta está aberta</span>');
    else if (!isLive) badges.push('<span class="badge badge-green">Aberta</span>');
    return `
      <form class="pool-match-card${isLive ? " is-live" : ""}${isNext ? " is-next" : ""}${isFeatured ? " is-featured" : ""}" data-bet-form data-kind="${escapeHTML(match.kind)}" data-match-id="${escapeHTML(match.id)}"${isNext ? ` aria-label="${escapeHTML(`Aposta em ${playerName(match.playerAId)} contra ${playerName(match.playerBId)} — próximo jogo oficial`)}"` : ""}>
        <div class="pool-match-meta">
          <span>${escapeHTML(match.roundName)}</span>
          <span>${badges.join(" ")}</span>
        </div>
        <div class="pool-pick-grid">
          ${renderPickOption(formId, match.playerAId, selected, disabled)}
          <span class="pool-versus">×</span>
          ${renderPickOption(formId, match.playerBId, selected, disabled)}
        </div>
        <div class="pool-wager-row">
          <label class="pool-stake-field"><span>Fichas</span><input name="stake" type="number" min="1" max="${Number(betting.settings?.maxStake) || 500}" step="1" value="${stake}" ${disabled ? "disabled" : ""} required></label>
          <button class="button button-primary" type="submit" ${disabled ? "disabled" : ""}>${existing ? "Atualizar aposta" : "Apostar"}</button>
          ${existing ? `<button class="button button-small button-ghost" type="button" data-pool-action="cancel-bet" data-kind="${escapeHTML(match.kind)}" data-match-id="${escapeHTML(match.id)}" ${isLive ? "disabled" : ""}>Cancelar</button>` : ""}
          ${match.kind === "league" ? `<a class="button button-small button-ghost" href="/#match/${encodeURIComponent(match.id)}">Ver confronto</a>` : ""}
        </div>
        ${renderProgrammingContext(match, entry, { isNext, isFeatured })}
        ${isLive ? `<p class="pool-live-notice"><span aria-hidden="true">●</span><span>A partida já começou. ${existing ? "Seu palpite foi preservado, mas não pode mais ser alterado ou cancelado." : "Novos palpites estão bloqueados até o resultado."}</span></p>` : disabled ? '<p class="pool-login-hint">Crie ou acesse seu perfil acima para apostar.</p>' : ""}
      </form>
    `;
  }

  function renderProgrammingContext(match, entry, { isNext = false, isFeatured = false } = {}) {
    if (match.kind !== "league") return "";
    const hasProgramming = Boolean(
      entry.scheduledAt ||
      entry.location ||
      entry.publicNote ||
      entry.status !== "unscheduled" ||
      isNext ||
      isFeatured,
    );
    if (!hasProgramming) return "";

    const dateMarkup = entry.scheduledAt
      ? `<time datetime="${escapeHTML(entry.scheduledAt)}">${escapeHTML(formatDateTime(entry.scheduledAt))}</time>`
      : "data a definir";
    const location = entry.location ? escapeHTML(entry.location) : "local a definir";
    const note = entry.publicNote ? ` · <span>${escapeHTML(entry.publicNote)}</span>` : "";

    if (entry.status === "postponed") {
      return `<p class="notice notice-warning" role="status"><span aria-hidden="true">!</span><span><strong>Partida adiada.</strong> ${dateMarkup} · ${location}${note}</span></p>`;
    }
    if (entry.status === "cancelled") {
      return `<p class="notice notice-danger" role="status"><span aria-hidden="true">!</span><span><strong>Partida cancelada na agenda.</strong> ${dateMarkup} · ${location}${note}</span></p>`;
    }

    const label = entry.status === "scheduled"
      ? "Agenda oficial"
      : isNext
        ? "Próximo oficial"
        : "Programação";
    return `<p class="pool-login-hint"><strong>${label}:</strong> ${dateMarkup} · ${location}${note}</p>`;
  }

  function renderPickOption(formId, playerId, selected, disabled) {
    const checked = selected === playerId ? "checked" : "";
    return `
      <label class="pool-pick-option ${checked ? "is-selected" : ""}">
        <input type="radio" name="winner" value="${escapeHTML(playerId)}" ${checked} ${disabled ? "disabled" : ""} required>
        <span class="avatar">${escapeHTML(initials(playerName(playerId)))}</span>
        <strong>${escapeHTML(playerName(playerId))}</strong>
        <small>Escolher vencedor</small>
      </label>
    `;
  }

  function renderMyBets() {
    const matches = currentMatchesMap();
    const bets = (betting.myBets || []).filter((bet) => bet.matchKind === "league");
    return `
      <section class="card pool-history-card">
        <div class="card-header"><div><h2>Minhas apostas</h2><p>As fichas são apuradas automaticamente quando o administrador salva o placar.</p></div></div>
        ${bets.length
          ? `<div class="pool-bet-history">${bets.map((bet) => renderBetHistoryRow(bet, matches.get(matchKey(bet.matchKind, bet.matchId)))).join("")}</div>`
          : '<div class="empty-state compact"><div class="empty-state-icon">◉</div><h3>Você ainda não apostou</h3><p>Escolha um confronto aberto acima.</p></div>'}
      </section>
    `;
  }

  function renderBetHistoryRow(bet, match) {
    let statusMeta = {
      pending: ["Aberta", "badge-gold", `-${formatNumber(bet.stake)} fichas reservadas`],
      won: ["Ganhou", "badge-green", `+${formatNumber(bet.stake)} de lucro`],
      lost: ["Não acertou", "", "saldo mantido"],
      void: ["Anulada", "", "fichas devolvidas"],
    }[bet.status] || [bet.status, "", ""];
    if (bet.status === "pending" && match?.inProgress) {
      statusMeta = ["Em andamento", "badge-live", `${formatNumber(bet.stake)} fichas reservadas`];
    }
    const playerA = match?.playerAId || bet.playerAId;
    const playerB = match?.playerBId || bet.playerBId;
    return `
      <article class="pool-history-row">
        <div><span class="badge ${statusMeta[1]}">${statusMeta[0]}</span><small>${escapeHTML(match?.roundName || `${bet.matchKind} · ${bet.matchId}`)}</small></div>
        <div class="pool-history-match"><span>${escapeHTML(playerName(playerA, "Jogador removido"))}</span><strong>×</strong><span>${escapeHTML(playerName(playerB, "Jogador removido"))}</span></div>
        <div><strong>${escapeHTML(playerName(bet.predictedWinnerId, "Jogador removido"))}</strong><small>seu vencedor · ${formatNumber(bet.stake)} fichas</small></div>
        <div class="pool-history-result"><strong>${statusMeta[2]}</strong><small>${formatDateTime(bet.updatedAt)}</small></div>
      </article>
    `;
  }

  function renderLeaderboard() {
    const rows = betting.leaderboard || [];
    return `
      <section class="card pool-leaderboard-card">
        <div class="card-header"><div><h2>Ranking do bolão</h2><p>Ordenado pelo saldo apurado.</p></div></div>
        ${rows.length
          ? `<div class="pool-leaderboard">${rows.map((row, index) => `
              <div class="pool-leader-row ${betting.profile?.id === row.id ? "is-me" : ""}">
                <span class="ranking-position pos-${index + 1}">${index + 1}</span>
                <span class="avatar">${escapeHTML(initials(row.name))}</span>
                <div><strong>${escapeHTML(row.name)}</strong><small>${row.wins} acerto(s) · ${row.accuracy}%${betting.profile?.id === row.id ? " · Você" : ""}</small></div>
                <div class="pool-leader-balance"><strong>${formatNumber(row.settledBalance)}</strong><small>${Number(row.profit) >= 0 ? "+" : ""}${formatNumber(row.profit)}</small></div>
              </div>`).join("")}</div>`
          : '<div class="empty-state compact"><p>Ninguém entrou no bolão ainda.</p></div>'}
      </section>
    `;
  }

  function renderRules() {
    return `
      <section class="card pool-rules-card">
        <div class="card-header"><div><h2>Como funciona</h2></div></div>
        <ol class="pool-rule-list">
          <li>Todo perfil começa com <strong>${formatNumber(betting.settings?.initialBalance || 10000)} fichas virtuais</strong>.</li>
          <li>Escolha um vencedor e aposte até <strong>${formatNumber(betting.settings?.maxStake || 500)} fichas</strong> por disputa.</li>
          <li>Acertou: recebe <strong>2× a aposta</strong>, incluindo a devolução das fichas apostadas.</li>
          <li>Não acertou: as fichas reservadas voltam ao saldo, sem perda de pontos.</li>
          <li>A aposta fecha quando o placar é registrado pelo administrador.</li>
        </ol>
        <div class="notice notice-warning"><span>!</span><span>Este módulo é recreativo e usa somente pontos virtuais. Não registra dinheiro, pagamentos ou prêmios.</span></div>
      </section>
    `;
  }

  function renderAdminTools() {
    return `
      <section class="card pool-admin-card">
        <div class="card-header"><div><h2>Administração</h2><p>Sessão administrativa detectada.</p></div></div>
        <button class="button button-danger button-ghost" data-pool-action="reset-pool">Zerar bolão e perfis</button>
      </section>
    `;
  }

  function initials(name) {
    return String(name || "?")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("");
  }

  async function submitAccess(form, mode) {
    const data = new FormData(form);
    const name = String(data.get("name") || "").trim();
    const pin = String(data.get("pin") || "").trim();
    if (mode === "register" && pin !== String(data.get("pinConfirm") || "").trim()) {
      showToast("Os PINs não conferem.", "error");
      return;
    }
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const payload = await fetchJSON(
        mode === "register" ? "/api/bettors/register" : "/api/bettors/login",
        { method: "POST", body: JSON.stringify({ name, pin }) },
      );
      saveToken(payload.token);
      showToast(mode === "register" ? "Perfil criado. Suas fichas já estão disponíveis." : "Você entrou no bolão.");
      await loadAll({ quiet: true });
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      button.disabled = false;
    }
  }

  async function submitBet(form) {
    const match = currentMatchesMap().get(matchKey(form.dataset.kind, form.dataset.matchId));
    if (match?.kind === "league" && match.inProgress) {
      showToast("A partida já começou. Este palpite não pode mais ser alterado.", "error");
      render();
      return;
    }
    const data = new FormData(form);
    const predictedWinnerId = String(data.get("winner") || "");
    const stake = Number(data.get("stake"));
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      betting = await fetchJSON("/api/bets/wager", {
        method: "POST",
        body: JSON.stringify({
          matchKind: form.dataset.kind,
          matchId: form.dataset.matchId,
          predictedWinnerId,
          stake,
        }),
      });
      showToast("Aposta virtual salva.");
      render();
    } catch (error) {
      if (error.status === 401) {
        saveToken("");
        await loadAll({ quiet: true });
      }
      showToast(error.message, "error");
    } finally {
      button.disabled = false;
    }
  }

  async function cancelBet(kind, matchId) {
    const match = currentMatchesMap().get(matchKey(kind, matchId));
    if (match?.kind === "league" && match.inProgress) {
      showToast("A partida já começou. O palpite foi preservado e não pode ser cancelado.", "error");
      render();
      return;
    }
    const confirmed = await askConfirm(
      "Cancelar esta aposta?",
      "As fichas reservadas voltarão ao seu saldo disponível.",
      "Cancelar aposta",
    );
    if (!confirmed) return;
    try {
      betting = await fetchJSON("/api/bets/cancel", {
        method: "POST",
        body: JSON.stringify({ matchKind: kind, matchId }),
      });
      showToast("Aposta cancelada.");
      render();
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  async function resetPool() {
    const confirmed = await askConfirm(
      "Zerar todo o bolão?",
      "Todos os perfis, PINs, fichas e apostas serão apagados. O campeonato não será alterado.",
      "Apagar bolão",
    );
    if (!confirmed) return;
    try {
      await fetchJSON("/api/bets/reset", { method: "POST", body: JSON.stringify({ confirm: true }) });
      saveToken("");
      showToast("Bolão zerado.");
      await loadAll({ quiet: true });
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  function askConfirm(title, message, actionLabel) {
    dom.confirmTitle.textContent = title;
    dom.confirmMessage.textContent = message;
    dom.confirmAction.textContent = actionLabel;
    dom.confirmDialog.returnValue = "";
    dom.confirmDialog.showModal();
    return new Promise((resolve) => {
      confirmResolver = resolve;
    });
  }

  function closeConfirm() {
    if (!dom.confirmDialog.open) return;
    dom.confirmDialog.close("cancel");
  }

  dom.content.addEventListener("submit", (event) => {
    if (event.target.matches("#bettor-login-form")) {
      event.preventDefault();
      submitAccess(event.target, "login");
      return;
    }
    if (event.target.matches("#bettor-register-form")) {
      event.preventDefault();
      submitAccess(event.target, "register");
      return;
    }
    if (event.target.matches("[data-bet-form]")) {
      event.preventDefault();
      submitBet(event.target);
    }
  });

  dom.content.addEventListener("change", (event) => {
    if (!event.target.matches('[data-bet-form] input[name="winner"]')) return;
    event.target.closest("[data-bet-form]")?.querySelectorAll(".pool-pick-option").forEach((option) => {
      option.classList.toggle("is-selected", option.contains(event.target) && event.target.checked);
    });
  });

  dom.content.addEventListener("click", (event) => {
    const button = event.target.closest("[data-pool-action]");
    if (!button) return;
    const action = button.dataset.poolAction;
    if (action === "logout") {
      saveToken("");
      betting.profile = null;
      betting.myBets = [];
      showToast("Você saiu do bolão.");
      loadAll({ quiet: true });
    } else if (action === "cancel-bet") {
      cancelBet(button.dataset.kind, button.dataset.matchId);
    } else if (action === "reset-pool") {
      resetPool();
    } else if (action === "retry-load") {
      loadAll();
    }
  });

  document.querySelectorAll("[data-close-confirm]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      closeConfirm();
    });
  });

  dom.confirmDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeConfirm();
  });

  dom.confirmDialog.addEventListener("close", () => {
    if (!confirmResolver) return;
    const resolver = confirmResolver;
    confirmResolver = null;
    resolver(dom.confirmDialog.returnValue === "confirm");
  });

  loadAll();
  window.setInterval(() => {
    const active = document.activeElement;
    if (document.hidden || active?.closest?.("form")) return;
    loadAll({ quiet: true });
  }, SYNC_INTERVAL_MS);
})();

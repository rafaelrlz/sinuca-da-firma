(() => {
  "use strict";

  const TOKEN_KEY = "sinuca-bolao-token-v1";
  const SYNC_INTERVAL_MS = 15000;
  const DEFAULT_STAKE = 50;
  const domain = window.BettingDomain;

  const dom = {
    content: document.querySelector("#pool-content"),
    title: document.querySelector("#pool-title"),
    userLabel: document.querySelector("#pool-user-label"),
    liveStatus: document.querySelector("#pool-live-status"),
    connectionBanner: document.querySelector("#pool-connection-banner"),
    connectionMessage: document.querySelector("#pool-connection-message"),
    toastRegion: document.querySelector("#pool-toast-region"),
    confirmDialog: document.querySelector("#pool-confirm-dialog"),
    confirmTitle: document.querySelector("#pool-confirm-title"),
    confirmMessage: document.querySelector("#pool-confirm-message"),
    confirmAction: document.querySelector("#pool-confirm-action"),
  };

  let appState = null;
  let betting = domain.normalizeSnapshot({});
  let adminAuthenticated = false;
  let syncInProgress = false;
  let initialLoadComplete = false;
  let confirmResolver = null;
  let confirmTrigger = null;
  let lastFocusedKey = "";
  let serverPreviewTimer = 0;
  const INITIAL_PANEL = ["matches", "history", "ranking", "performance"].includes(window.location.hash.slice(1))
    ? window.location.hash.slice(1)
    : "matches";
  let ui = {
    matchFilter: "available",
    playerFilter: "",
    historyFilter: "all",
    rankingScope: "overall",
    activePanel: INITIAL_PANEL,
    expandedBetId: "",
    profileEditorOpen: false,
    matchLimit: 12,
  };

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
    if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    const response = await fetch(url, { ...options, headers, cache: "no-store" });
    let payload = {};
    try {
      payload = await response.json();
    } catch (error) {
      payload = {};
    }
    if (!response.ok) {
      const failure = new Error(payload.error || payload.message || `Falha HTTP ${response.status}`);
      failure.status = response.status;
      failure.payload = payload;
      throw failure;
    }
    return payload;
  }

  async function optionalJSON(url) {
    try {
      return await fetchJSON(url);
    } catch (error) {
      if ([404, 405, 501].includes(error.status)) return null;
      throw error;
    }
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

  function formatNumber(value, digits = 0) {
    return new Intl.NumberFormat("pt-BR", {
      maximumFractionDigits: digits,
      minimumFractionDigits: digits,
    }).format(Number(value) || 0);
  }

  function formatDateTime(value, fallback = "A definir") {
    if (!value) return fallback;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return fallback;
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(date);
  }

  function formatRelative(value) {
    if (!value) return "sem horário definido";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "sem horário definido";
    const distance = date.getTime() - Date.now();
    if (distance <= 0) return "fechado";
    const minutes = Math.ceil(distance / 60000);
    if (minutes < 60) return `fecha em ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const remaining = minutes % 60;
    if (hours < 24) return `fecha em ${hours}h${remaining ? ` ${remaining}min` : ""}`;
    const days = Math.floor(hours / 24);
    return `fecha em ${days} dia${days === 1 ? "" : "s"}`;
  }

  function initials(name) {
    return String(name || "?").trim().split(/\s+/).slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase()).join("");
  }

  function matchKey(kind, id) {
    return `${kind}:${id}`;
  }

  function cleanText(value, fallback = "") {
    const text = String(value ?? "").trim();
    return text || fallback;
  }

  function showToast(message, kind = "success") {
    const toast = document.createElement("div");
    toast.className = `toast${kind === "error" ? " is-error" : ""}`;
    toast.innerHTML = `<span aria-hidden="true">${kind === "error" ? "!" : "✓"}</span><span>${escapeHTML(message)}</span>`;
    dom.toastRegion.append(toast);
    window.setTimeout(() => toast.remove(), 4200);
  }

  function setConnectionStatus(status, message) {
    const offline = status === "offline";
    const syncing = status === "syncing";
    dom.liveStatus.classList.toggle("is-offline", offline);
    dom.liveStatus.classList.toggle("is-syncing", syncing);
    dom.liveStatus.innerHTML = `<span class="status-dot" aria-hidden="true"></span><span>${escapeHTML(message)}</span>`;
    dom.connectionBanner.hidden = !offline;
    if (offline) dom.connectionMessage.textContent = message;
  }

  function playersMap() {
    return new Map((appState?.players || []).map((player) => [String(player.id), player]));
  }

  function playerName(id, fallback = "A definir") {
    return playersMap().get(String(id))?.name || fallback;
  }

  function scheduleEntry(matchId) {
    const programming = appState?.league?.programming || {};
    const source = programming.matches || programming.schedule || programming.scheduledMatches || programming;
    let entry = Array.isArray(source)
      ? source.find((item) => String(item?.matchId || item?.id) === String(matchId))
      : source?.[matchId];
    if (typeof entry === "string") entry = { scheduledAt: entry };
    entry = entry && typeof entry === "object" ? entry : {};
    const date = entry.scheduledAt || entry.dateTime || entry.startsAt || entry.start || "";
    return {
      scheduledAt: date,
      location: cleanText(entry.location || entry.venue || entry.local),
      status: cleanText(entry.status || entry.state, date ? "scheduled" : "unscheduled"),
      note: cleanText(entry.publicNote || entry.note || entry.observation),
    };
  }

  function collectLegacyMatches() {
    const league = appState?.league;
    if (!league?.rounds) return [];
    const results = league.results || {};
    const inProgress = league.inProgress || {};
    const nextMatchId = String(
      league.programming?.nextMatchId || league.nextMatchId || "",
    );
    const matches = [];
    league.rounds.forEach((round, roundIndex) => {
      (round.matches || []).forEach((match, matchIndex) => {
        if (!match?.id || !match.playerAId || !match.playerBId) return;
        const schedule = scheduleEntry(match.id);
        const result = results[match.id] || null;
        matches.push({
          kind: "league",
          id: String(match.id),
          matchKind: "league",
          matchId: String(match.id),
          roundName: `Liga · Rodada ${round.number || roundIndex + 1}`,
          roundNumber: Number(round.number) || roundIndex + 1,
          orderIndex: roundIndex * 100 + matchIndex,
          playerAId: match.playerAId,
          playerBId: match.playerBId,
          result,
          winnerId: result?.winnerId || "",
          inProgress: Boolean(inProgress[match.id]) && !result,
          isNext: nextMatchId === String(match.id),
          ...schedule,
        });
      });
    });
    return matches;
  }

  function normalizeMatch(raw, legacy = null) {
    const match = raw && typeof raw === "object" ? raw : {};
    const base = legacy || {};
    const normalized = {
      ...base,
      ...match,
      kind: String(match.kind || match.matchKind || match.match_kind || base.kind || "league"),
      id: String(match.id || match.matchId || match.match_id || base.id || ""),
      roundName: cleanText(match.roundName || match.round_name || base.roundName, "Liga"),
      playerAId: match.playerAId || match.player_a_id || base.playerAId || "",
      playerBId: match.playerBId || match.player_b_id || base.playerBId || "",
      scheduledAt: match.closesAt || match.closes_at || match.scheduledAt || match.scheduled_at || base.scheduledAt || "",
      closesAt: match.closesAt || match.closes_at || match.lockAt || match.lock_at || match.scheduledAt || match.scheduled_at || base.scheduledAt || "",
      location: cleanText(match.location || match.venue || base.location),
      bettingStatus: match.bettingStatus || match.betting_status || "inherit",
      inProgress: Boolean(match.inProgress ?? match.in_progress ?? base.inProgress),
      result: match.result || base.result || null,
      winnerId: match.winnerId || match.winner_id || base.winnerId || "",
      isNext: Boolean(match.isNext ?? match.is_next ?? base.isNext),
      distribution: match.distribution || match.predictionDistribution || null,
    };
    const lock = domain.resolveLockState(normalized, betting.rules);
    normalized.locked = match.locked === true || match.open === false || lock.locked;
    normalized.lockReason = match.lockReason || match.lock_reason ||
      ({
        result_recorded: "result",
        in_progress: "started",
        manual_lock: "manual",
        disabled: "disabled",
        scheduled_lock: "scheduled",
      })[match.closeReason || match.close_reason] ||
      lock.reason;
    return normalized;
  }

  function allMatches() {
    const legacy = collectLegacyMatches();
    const byKey = new Map(legacy.map((match) => [matchKey(match.kind, match.id), match]));
    (betting.matches || []).forEach((raw) => {
      const kind = String(raw.kind || raw.matchKind || raw.match_kind || "league");
      const id = String(raw.id || raw.matchId || raw.match_id || "");
      if (!id) return;
      byKey.set(matchKey(kind, id), normalizeMatch(raw, byKey.get(matchKey(kind, id))));
    });
    return [...byKey.values()].map((match) => normalizeMatch(match));
  }

  function betsMap() {
    return new Map((betting.myBets || []).map((bet) => [matchKey(bet.matchKind, bet.matchId), bet]));
  }

  function preserveInteraction() {
    const active = document.activeElement;
    lastFocusedKey = active?.dataset?.focusKey || active?.id || "";
    return { scrollX: window.scrollX, scrollY: window.scrollY };
  }

  function restoreInteraction(position) {
    window.scrollTo(position.scrollX, position.scrollY);
    if (!lastFocusedKey) return;
    const target = dom.content.querySelector(`[data-focus-key="${CSS.escape(lastFocusedKey)}"], #${CSS.escape(lastFocusedKey)}`);
    target?.focus({ preventScroll: true });
  }

  async function loadAll({ quiet = false } = {}) {
    if (syncInProgress) return;
    syncInProgress = true;
    const position = initialLoadComplete ? preserveInteraction() : null;
    if (!quiet) setConnectionStatus("syncing", "Atualizando");
    try {
      const [stateResult, betsResult, authResult] = await Promise.all([
        fetchJSON("/api/state"),
        fetchJSON("/api/bets"),
        optionalJSON("/api/auth"),
      ]);
      appState = stateResult.state || stateResult || null;
      betting = domain.normalizeSnapshot(betsResult);
      adminAuthenticated = Boolean(authResult?.authenticated);

      const expanded = await Promise.allSettled([
        optionalJSON("/api/bets/me"),
        optionalJSON("/api/bets/matches"),
        optionalJSON("/api/bets/rules"),
        token() ? optionalJSON("/api/bets/history") : Promise.resolve(null),
      ]);
      const me = expanded[0].status === "fulfilled" ? expanded[0].value : null;
      const matches = expanded[1].status === "fulfilled" ? expanded[1].value : null;
      const rules = expanded[2].status === "fulfilled" ? expanded[2].value : null;
      const history = expanded[3].status === "fulfilled" ? expanded[3].value : null;
      if (me) {
        betting.profile = me.profile || me.me || me;
        betting.achievements = me.achievements || betting.profile?.achievements || betting.achievements;
      }
      if (matches) betting.matches = matches.matches || (Array.isArray(matches) ? matches : betting.matches);
      if (rules) {
        betting.rules = domain.normalizeRules(rules.rules || rules);
        betting.settings = betting.rules;
      }
      if (history) {
        const rows = history.history || history.bets || history.items || (Array.isArray(history) ? history : []);
        if (rows.length) betting.myBets = rows.map(domain.normalizeBet);
      }

      const title = appState?.settings?.title;
      if (title) {
        dom.title.textContent = title;
        document.title = `Bolão · ${title}`;
      }
      setConnectionStatus("online", "Atualizado agora");
      render();
      initialLoadComplete = true;
      if (position) restoreInteraction(position);
    } catch (error) {
      console.error(error);
      const hasData = initialLoadComplete && appState;
      setConnectionStatus("offline", hasData
        ? "Sem conexão. Exibindo os últimos dados carregados; confirmações estão pausadas."
        : "Não foi possível conectar ao servidor.");
      if (!hasData) renderFatalError(error);
      else disableMutations();
      if (!quiet) showToast("A atualização falhou. Nenhum palpite foi alterado.", "error");
    } finally {
      syncInProgress = false;
    }
  }

  function renderFatalError(error) {
    dom.content.innerHTML = `
      <section class="pool-system-state" role="alert">
        <span class="pool-state-mark" aria-hidden="true">!</span>
        <div>
          <h1>Não foi possível abrir o bolão</h1>
          <p>${escapeHTML(error?.message || "Verifique sua conexão e tente novamente.")} Nenhum palpite foi alterado.</p>
          <button class="button button-primary" type="button" data-pool-action="retry-load">Tentar novamente</button>
        </div>
      </section>`;
  }

  function disableMutations() {
    dom.content.querySelectorAll("form button[type='submit'], [data-pool-action='review-bet'], [data-pool-action='cancel-bet']")
      .forEach((control) => {
        control.disabled = true;
        control.title = "A ação volta a ficar disponível quando a conexão for restabelecida.";
      });
  }

  function render() {
    const profile = betting.profile;
    dom.userLabel.hidden = !profile;
    dom.userLabel.textContent = profile ? `Olá, ${profile.name}` : "";
    dom.content.innerHTML = `
      ${renderIntro(profile)}
      ${profile ? renderMyPool(profile) : renderAccess()}
      ${renderPrimaryNav(profile)}
      <div class="pool-workspace">
        <div class="pool-workspace-main">
          ${renderActivePanel(profile)}
        </div>
        <aside class="pool-workspace-side" aria-label="Resumo do bolão">
          ${renderQuickRanking()}
          ${profile ? renderAchievements() : ""}
          ${renderRules()}
        </aside>
      </div>
      ${profile ? renderProfileEditor(profile) : ""}
    `;
    updateCountdowns();
  }

  function renderIntro(profile) {
    const open = allMatches().filter((match) => !match.result && !match.locked);
    return `
      <section class="pool-intro" aria-labelledby="pool-page-title">
        <div>
          <p class="pool-context">Competição entre colegas · somente fichas virtuais</p>
          <h1 id="pool-page-title">${profile ? "Seu próximo palpite começa aqui." : "Acompanhe, escolha e torça."}</h1>
          <p>${profile
            ? "Veja primeiro o que está perto de fechar. Antes de confirmar, você confere retorno, regra de perda e horário."
            : "Entre com seu nome e PIN para registrar palpites. O campeonato e o ranking continuam abertos para consulta."}</p>
        </div>
        <div class="pool-intro-status">
          <strong>${formatNumber(open.length)}</strong>
          <span>${open.length === 1 ? "partida aberta" : "partidas abertas"}</span>
          <small>Sem dinheiro, pagamento ou saque.</small>
        </div>
      </section>`;
  }

  function renderAccess() {
    return `
      <section class="pool-access" aria-labelledby="pool-access-title">
        <div class="pool-access-copy">
          <h2 id="pool-access-title">Entre no seu bolão</h2>
          <p>Seu perfil guarda saldo, palpites e conquistas. O PIN tem de 4 a 8 números.</p>
        </div>
        <div class="pool-access-forms">
          <form class="pool-access-form" id="bettor-login-form">
            <h3>Já tenho perfil</h3>
            <label class="field"><span>Nome no ranking</span><input name="name" autocomplete="username" maxlength="30" required></label>
            <label class="field"><span>PIN</span><input name="pin" type="password" inputmode="numeric" pattern="[0-9]{4,8}" autocomplete="current-password" required></label>
            <button class="button button-primary" type="submit">Entrar no bolão</button>
          </form>
          <form class="pool-access-form" id="bettor-register-form">
            <h3>Quero participar</h3>
            <label class="field"><span>Nome no ranking</span><input name="name" autocomplete="nickname" maxlength="30" required></label>
            <div class="pool-pin-fields">
              <label class="field"><span>Crie um PIN</span><input name="pin" type="password" inputmode="numeric" pattern="[0-9]{4,8}" autocomplete="new-password" required></label>
              <label class="field"><span>Repita o PIN</span><input name="pinConfirm" type="password" inputmode="numeric" pattern="[0-9]{4,8}" autocomplete="new-password" required></label>
            </div>
            <button class="button button-secondary" type="submit">Criar perfil</button>
          </form>
        </div>
      </section>`;
  }

  function profilePosition(profile) {
    const rows = betting.rankings?.overall || betting.leaderboard || [];
    const index = rows.findIndex((row) => String(row.id) === String(profile.id));
    return Number(profile.position || profile.rank || (index >= 0 ? index + 1 : 0));
  }

  function renderMyPool(profile) {
    const reserved = Number(profile.reservedStake ?? profile.pendingStake ?? 0);
    const sequence = Number(profile.currentStreak ?? profile.streak ?? 0);
    const position = profilePosition(profile);
    const next = prioritizedMatches().find((match) => !match.locked);
    const variation = Number(profile.positionChange ?? profile.rankChange ?? 0);
    return `
      <section class="pool-scoreboard" aria-labelledby="my-pool-title">
        <div class="pool-scoreboard-head">
          <div class="pool-person">
            <span class="avatar gold" aria-hidden="true">${escapeHTML(initials(profile.name))}</span>
            <div>
              <p>Meu bolão</p>
              <h2 id="my-pool-title">${escapeHTML(profile.name)}</h2>
            </div>
          </div>
          <div class="pool-scoreboard-actions">
            <button class="button button-ghost button-small" type="button" data-pool-action="edit-profile">Perfil</button>
            <button class="button button-ghost button-small" type="button" data-pool-action="logout">Sair</button>
          </div>
        </div>
        <div class="pool-scoreboard-grid">
          <div class="pool-rank-block">
            <span>Posição geral</span>
            <strong>${position ? `${position}º` : "—"}</strong>
            <small>${variation > 0 ? `subiu ${variation}` : variation < 0 ? `caiu ${Math.abs(variation)}` : "sem mudança registrada"}</small>
          </div>
          <dl class="pool-balance-strip">
            <div><dt>Disponível</dt><dd>${formatNumber(profile.availableBalance)}</dd></div>
            <div><dt>Apurado</dt><dd>${formatNumber(profile.settledBalance)}</dd></div>
            <div><dt>Reservado</dt><dd>${formatNumber(reserved)}</dd></div>
            <div><dt>Acertos</dt><dd>${formatNumber(profile.accuracy)}%</dd></div>
            <div><dt>Sequência</dt><dd>${sequence > 0 ? `${sequence} acerto${sequence === 1 ? "" : "s"}` : "—"}</dd></div>
          </dl>
          <div class="pool-next-action">
            <span>Próxima ação</span>
            ${next ? `
              <strong>${escapeHTML(playerName(next.playerAId))} × ${escapeHTML(playerName(next.playerBId))}</strong>
              <small data-countdown="${escapeHTML(next.closesAt)}">${escapeHTML(formatRelative(next.closesAt))}</small>
              <button class="button button-primary" type="button" data-pool-action="open-match" data-match-id="${escapeHTML(next.id)}">Fazer palpite</button>
            ` : `<strong>Tudo em dia</strong><small>Você não tem partidas abertas agora.</small>`}
          </div>
        </div>
      </section>`;
  }

  function renderPrimaryNav(profile) {
    const items = [
      ["matches", "Partidas", allMatches().filter((match) => !match.result && !match.locked).length],
      ["history", profile ? "Meus palpites" : "Resultados", profile ? betting.myBets.length : 0],
      ["ranking", "Rankings", null],
      ["performance", "Desempenho", null],
    ];
    return `
      <nav class="pool-tabs" aria-label="Áreas do bolão">
        ${items.map(([key, label, count]) => `
          <button type="button" aria-pressed="${ui.activePanel === key}" class="${ui.activePanel === key ? "is-active" : ""}" data-pool-action="switch-panel" data-panel="${key}">
            ${label}${count !== null ? `<span>${formatNumber(count)}</span>` : ""}
          </button>`).join("")}
      </nav>`;
  }

  function renderActivePanel(profile) {
    if (ui.activePanel === "history") return renderHistory(profile);
    if (ui.activePanel === "ranking") return renderRankings();
    if (ui.activePanel === "performance") return renderPerformance(profile);
    return renderMatches(profile);
  }

  function prioritizedMatches() {
    const myBets = betsMap();
    return allMatches().filter((match) => !match.result).sort((a, b) => {
      const priority = (match) => {
        if (match.inProgress) return 0;
        if (match.isNext) return 1;
        if (myBets.has(matchKey(match.kind, match.id))) return 2;
        if (match.closesAt) return 3;
        return 4;
      };
      const difference = priority(a) - priority(b);
      if (difference) return difference;
      const dateA = new Date(a.closesAt || 8640000000000000).getTime();
      const dateB = new Date(b.closesAt || 8640000000000000).getTime();
      return dateA - dateB || (a.orderIndex || 0) - (b.orderIndex || 0);
    });
  }

  function filteredMatches() {
    const existing = betsMap();
    return prioritizedMatches().filter((match) => {
      if (ui.matchFilter === "available" && match.locked) return false;
      if (ui.matchFilter === "mine" && !existing.has(matchKey(match.kind, match.id))) return false;
      if (ui.matchFilter === "locked" && !match.locked) return false;
      if (ui.playerFilter && ![match.playerAId, match.playerBId].includes(ui.playerFilter)) return false;
      return true;
    });
  }

  function renderMatches(profile) {
    const allFilteredMatches = filteredMatches();
    const matches = allFilteredMatches.slice(0, ui.matchLimit);
    const players = [...playersMap().values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    return `
      <section class="pool-panel pool-matches-panel" aria-labelledby="matches-title">
        <header class="pool-panel-head">
          <div><h2 id="matches-title">Partidas</h2><p>Próximos jogos e fechamentos aparecem primeiro.</p></div>
          <a class="button button-ghost button-small" href="/#schedule">Agenda oficial</a>
        </header>
        <div class="pool-filters">
          <div class="pool-filter-chips" role="group" aria-label="Filtrar partidas por estado">
            ${filterButton("available", "Abertas")}
            ${filterButton("mine", "Com meu palpite")}
            ${filterButton("locked", "Fechadas")}
            ${filterButton("all", "Todas")}
          </div>
          <label><span class="sr-only">Filtrar por jogador</span>
            <select id="pool-player-filter" data-focus-key="player-filter">
              <option value="">Todos os jogadores</option>
              ${players.map((player) => `<option value="${escapeHTML(player.id)}"${ui.playerFilter === String(player.id) ? " selected" : ""}>${escapeHTML(player.name)}</option>`).join("")}
            </select>
          </label>
        </div>
        <div class="pool-match-list">
          ${matches.length ? matches.map((match) => renderMatch(match, profile)).join("") : renderMatchesEmpty()}
        </div>
        ${allFilteredMatches.length > matches.length ? `<div class="pool-show-more"><button class="button button-ghost" type="button" data-pool-action="show-more-matches">Mostrar mais ${Math.min(12, allFilteredMatches.length - matches.length)} partidas</button><small>${formatNumber(matches.length)} de ${formatNumber(allFilteredMatches.length)} exibidas</small></div>` : ""}
      </section>`;
  }

  function filterButton(value, label) {
    return `<button type="button" class="${ui.matchFilter === value ? "is-active" : ""}" aria-pressed="${ui.matchFilter === value}" data-pool-action="filter-matches" data-filter="${value}">${label}</button>`;
  }

  function renderMatchesEmpty() {
    const messages = {
      available: ["Nenhuma partida aberta", "Quando novos confrontos forem liberados, eles aparecerão aqui."],
      mine: ["Nenhum palpite nesta lista", "Faça um palpite em uma partida aberta para acompanhá-lo aqui."],
      locked: ["Nenhuma partida fechada", "Partidas em andamento ou encerradas aparecerão neste filtro."],
      all: ["Nenhuma partida disponível", "A organização ainda não definiu novos confrontos."],
    };
    const [title, text] = messages[ui.matchFilter] || messages.all;
    return `<div class="pool-empty"><span aria-hidden="true">8</span><h3>${title}</h3><p>${text}</p></div>`;
  }

  function renderMatch(match, profile) {
    const existing = betsMap().get(matchKey(match.kind, match.id));
    const rules = existing?.rulesSnapshot || betting.rules;
    const stake = existing?.stake || Math.min(DEFAULT_STAKE, Number(profile?.availableBalance) || DEFAULT_STAKE);
    const selected = existing?.predictedWinnerId || "";
    const preview = domain.calculatePreview({
      stake,
      acceptedOdds: existing?.acceptedOdds,
      rules,
    });
    const formId = `bet-${match.kind}-${match.id}`.replace(/[^a-zA-Z0-9_-]/g, "-");
    const unavailable = !profile || match.locked;
    return `
      <article class="pool-match${match.isNext ? " is-next" : ""}${match.locked ? " is-locked" : ""}" id="match-${escapeHTML(match.id)}">
        <header class="pool-match-head">
          <div>
            <span>${escapeHTML(match.roundName)}</span>
            <div class="pool-match-badges">
              ${match.isNext ? '<span class="pool-badge is-priority">Próximo oficial</span>' : ""}
              ${match.inProgress ? '<span class="pool-badge is-live">Em andamento</span>' : ""}
              ${existing ? '<span class="pool-badge is-mine">Seu palpite</span>' : ""}
              ${match.locked && !match.inProgress ? '<span class="pool-badge">Fechada</span>' : ""}
            </div>
          </div>
          <div class="pool-deadline">
            <strong data-countdown="${escapeHTML(match.closesAt)}">${escapeHTML(match.locked ? lockReasonText(match) : formatRelative(match.closesAt))}</strong>
            <small>${escapeHTML(match.closesAt ? formatDateTime(match.closesAt) : "A organização ainda definirá o horário")}</small>
          </div>
        </header>
        <form data-bet-form data-kind="${escapeHTML(match.kind)}" data-match-id="${escapeHTML(match.id)}" data-form-id="${escapeHTML(formId)}">
          <fieldset class="pool-picks"${unavailable ? " disabled" : ""}>
            <legend class="sr-only">Escolha o vencedor de ${escapeHTML(playerName(match.playerAId))} contra ${escapeHTML(playerName(match.playerBId))}</legend>
            ${renderPick(formId, match.playerAId, selected)}
            <span class="pool-versus" aria-hidden="true">×</span>
            ${renderPick(formId, match.playerBId, selected)}
          </fieldset>
          <div class="pool-wager">
            <label class="pool-stake-field">
              <span>Fichas virtuais</span>
              <input name="stake" type="number" inputmode="numeric" min="${betting.rules.minStake}" max="${betting.rules.maxStake}" step="1" value="${preview.stake}" data-focus-key="stake-${escapeHTML(match.id)}" ${unavailable ? "disabled" : ""} required>
            </label>
            <div class="pool-preview-summary" aria-live="polite">
              <span>Retorno se acertar</span>
              <strong data-preview-return>${formatNumber(preview.potentialReturn)} fichas</strong>
              <small data-preview-odds>multiplicador ${formatNumber(preview.acceptedOdds, 2)}×</small>
            </div>
            <button class="button ${existing ? "button-secondary" : "button-primary"}" type="button" data-pool-action="review-bet" ${unavailable ? "disabled" : ""}>
              ${existing ? "Revisar alteração" : "Revisar palpite"}
            </button>
          </div>
          <div class="pool-bet-review" data-bet-review hidden></div>
          ${renderMatchContext(match, existing, profile)}
        </form>
      </article>`;
  }

  function renderPick(formId, playerId, selected) {
    const checked = String(selected) === String(playerId);
    return `
      <label class="pool-pick${checked ? " is-selected" : ""}">
        <input type="radio" name="winner" value="${escapeHTML(playerId)}" ${checked ? "checked" : ""} required>
        <span class="avatar" aria-hidden="true">${escapeHTML(initials(playerName(playerId)))}</span>
        <span><strong>${escapeHTML(playerName(playerId))}</strong><small>${checked ? "Escolhido" : "Escolher vencedor"}</small></span>
      </label>`;
  }

  function renderMatchContext(match, existing, profile) {
    if (match.locked) {
      return `<p class="pool-inline-state"><strong>${escapeHTML(lockReasonText(match))}.</strong> ${existing ? "Seu snapshot foi preservado e pode ser consultado em Meus palpites." : "Novos palpites e alterações não são aceitos."}</p>`;
    }
    if (!profile) {
      return '<p class="pool-inline-state">Entre no seu perfil acima para confirmar um palpite.</p>';
    }
    const pieces = [];
    if (match.location) pieces.push(match.location);
    if (match.note) pieces.push(match.note);
    return pieces.length
      ? `<p class="pool-match-context"><strong>Agenda:</strong> ${escapeHTML(pieces.join(" · "))}</p>`
      : "";
  }

  function lockReasonText(match) {
    const reasons = {
      result: "Resultado registrado",
      started: "Palpites fechados: partida iniciada",
      manual: "Palpites fechados pela organização",
      disabled: "Palpites indisponíveis nesta partida",
      scheduled: "Horário de fechamento atingido",
    };
    return reasons[match.lockReason] || "Palpites fechados";
  }

  function renderHistory(profile) {
    if (!profile) {
      return `<section class="pool-panel"><div class="pool-empty"><h2>Seus palpites ficam aqui</h2><p>Entre ou crie um perfil para consultar snapshots e eventos.</p></div></section>`;
    }
    const bets = betting.myBets.filter((bet) => {
      if (ui.historyFilter === "all") return true;
      return domain.statusGroup(bet.status) === ui.historyFilter;
    });
    return `
      <section class="pool-panel" aria-labelledby="history-title">
        <header class="pool-panel-head"><div><h2 id="history-title">Meus palpites</h2><p>Cada resultado mantém a regra e o multiplicador aceitos na confirmação.</p></div></header>
        <div class="pool-filter-chips pool-history-filters" role="group" aria-label="Filtrar meus palpites">
          ${historyFilter("all", "Todos")}
          ${historyFilter("open", "Abertos")}
          ${historyFilter("won", "Acertos")}
          ${historyFilter("lost", "Erros")}
          ${historyFilter("void", "Anulados")}
        </div>
        <div class="pool-history-list">
          ${bets.length ? bets.map(renderHistoryItem).join("") : '<div class="pool-empty"><h3>Nenhum palpite neste filtro</h3><p>Escolha outro estado ou volte às partidas abertas.</p></div>'}
        </div>
      </section>`;
  }

  function historyFilter(value, label) {
    return `<button type="button" class="${ui.historyFilter === value ? "is-active" : ""}" aria-pressed="${ui.historyFilter === value}" data-pool-action="filter-history" data-filter="${value}">${label}</button>`;
  }

  function renderHistoryItem(bet) {
    const match = allMatches().find((item) => item.id === bet.matchId && item.kind === bet.matchKind);
    const expanded = ui.expandedBetId === bet.id;
    const status = statusMeta(bet);
    const latestEvent = bet.events.at?.(-1);
    return `
      <article class="pool-history-item">
        <button type="button" class="pool-history-summary" aria-expanded="${expanded}" data-pool-action="toggle-timeline" data-bet-id="${escapeHTML(bet.id)}">
          <span><span class="pool-badge ${status.className}">${status.label}</span><small>${escapeHTML(match?.roundName || bet.matchId)}</small></span>
          <span><strong>${escapeHTML(playerName(bet.predictedWinnerId, "Jogador removido"))}</strong><small>seu vencedor · ${formatNumber(bet.stake)} fichas</small></span>
          <span><strong>${formatNumber(bet.acceptedOdds, 2)}×</strong><small>retorno previsto ${formatNumber(bet.potentialReturn)}</small></span>
          <span><strong>${escapeHTML(status.result)}</strong><small>${escapeHTML(formatDateTime(bet.updatedAt))}</small></span>
          <span class="pool-disclosure" aria-hidden="true">${expanded ? "−" : "+"}</span>
        </button>
        ${expanded ? renderTimeline(bet, latestEvent, match) : ""}
      </article>`;
  }

  function statusMeta(bet) {
    const delta = Number(bet.settlementDelta || 0);
    const map = {
      pending: ["Aberto", "is-mine", "Aguardando fechamento"],
      locked: ["Fechado", "", "Aguardando resultado"],
      won: ["Acertou", "is-won", `+${formatNumber(delta || bet.potentialReturn - bet.stake)} fichas`],
      lost: ["Não acertou", "is-lost", delta < 0 ? `${formatNumber(delta)} fichas` : "Saldo preservado"],
      void: ["Anulado", "", "Fichas devolvidas"],
      voided: ["Anulado", "", "Fichas devolvidas"],
    };
    const [label, className, result] = map[bet.status] || [bet.status, "", bet.settlementReason || "Processado"];
    return { label, className, result };
  }

  function renderTimeline(bet, latestEvent, match) {
    const events = bet.events.length ? bet.events : fallbackEvents(bet);
    const cancellable = domain.statusGroup(bet.status) === "open" &&
      !match?.locked &&
      bet.rulesSnapshot.allowCancellation;
    return `
      <div class="pool-timeline-wrap">
        <div class="pool-snapshot">
          <h3>Snapshot aceito</h3>
          <dl>
            <div><dt>Multiplicador</dt><dd>${formatNumber(bet.acceptedOdds, 2)}×</dd></div>
            <div><dt>Retorno potencial</dt><dd>${formatNumber(bet.potentialReturn)} fichas</dd></div>
            <div><dt>Regra ao errar</dt><dd>${escapeHTML(domain.lossPolicyText(bet.rulesSnapshot))}</dd></div>
            <div><dt>Cancelamento</dt><dd>${bet.rulesSnapshot.allowCancellation ? "Permitido enquanto aberto" : "Não permitido"}</dd></div>
          </dl>
          ${cancellable ? `<button class="button button-ghost button-small pool-cancel-bet" type="button" data-pool-action="cancel-bet" data-kind="${escapeHTML(bet.matchKind)}" data-match-id="${escapeHTML(bet.matchId)}">Cancelar palpite</button>` : ""}
        </div>
        <ol class="pool-timeline" aria-label="Linha do tempo do palpite">
          ${events.map((event) => `
            <li>
              <span aria-hidden="true"></span>
              <div><strong>${escapeHTML(eventLabel(event.eventType || event.type))}</strong><small>${escapeHTML(event.detail || event.reason || "")}</small></div>
              <time datetime="${escapeHTML(event.createdAt || event.created_at || "")}">${escapeHTML(formatDateTime(event.createdAt || event.created_at))}</time>
            </li>`).join("")}
        </ol>
        ${latestEvent ? `<p class="sr-only">Evento mais recente: ${escapeHTML(eventLabel(latestEvent.eventType || latestEvent.type))}.</p>` : ""}
      </div>`;
  }

  function fallbackEvents(bet) {
    const events = [{ eventType: "created", createdAt: bet.createdAt }];
    if (bet.updatedAt && bet.updatedAt !== bet.createdAt) events.push({ eventType: "updated", createdAt: bet.updatedAt });
    if (bet.lockedAt) events.push({ eventType: "locked", createdAt: bet.lockedAt });
    if (bet.settledAt) events.push({ eventType: "settled", createdAt: bet.settledAt, detail: bet.settlementReason });
    return events;
  }

  function eventLabel(type) {
    return ({
      created: "Palpite confirmado",
      updated: "Palpite atualizado",
      cancelled: "Palpite cancelado",
      locked: "Palpite fechado",
      reopened: "Palpite reaberto",
      settled: "Resultado apurado",
      resettled: "Resultado corrigido",
      voided: "Palpite anulado",
    })[type] || "Evento registrado";
  }

  function scopes() {
    return [
      ["overall", "Geral"],
      ["round", "Rodada"],
      ["month", "Mês"],
      ["season", "Temporada"],
      ["streak", "Sequência"],
      ["underdog", "Azarões"],
    ];
  }

  function rankingRows(scope = ui.rankingScope) {
    return betting.rankings?.[scope] || (scope === "overall" ? betting.leaderboard : []) || [];
  }

  function renderRankings() {
    const rows = rankingRows();
    return `
      <section class="pool-panel" aria-labelledby="ranking-title">
        <header class="pool-panel-head">
          <div><h2 id="ranking-title">Rankings</h2><p>Recortes do bolão não alteram a classificação oficial do campeonato.</p></div>
          ${renderSeasonSelect()}
        </header>
        <div class="pool-ranking-scopes" role="group" aria-label="Escopo do ranking">
          ${scopes().map(([value, label]) => `<button type="button" class="${ui.rankingScope === value ? "is-active" : ""}" aria-pressed="${ui.rankingScope === value}" data-pool-action="ranking-scope" data-scope="${value}">${label}</button>`).join("")}
        </div>
        ${rows.length ? renderRankingList(rows, 30, ui.rankingScope) : `
          <div class="pool-empty"><h3>Ranking ainda sem dados</h3><p>Este recorte aparece quando houver palpites apurados suficientes.</p></div>`}
      </section>`;
  }

  function renderSeasonSelect() {
    const seasons = betting.seasons || [];
    const current = betting.currentSeason || betting.activeSeason;
    if (!seasons.length && !current) return "";
    return `<span class="pool-season-label">${escapeHTML(current?.title || current?.name || "Temporada atual")}</span>`;
  }

  function renderRankingList(rows, limit = 8, scope = "overall") {
    return `<ol class="pool-ranking-list">${rows.slice(0, limit).map((row, index) => {
      const position = Number(row.position || row.rank || index + 1);
      const isMe = String(row.id) === String(betting.profile?.id);
      const value = scope === "streak"
        ? `${formatNumber(row.currentStreak ?? row.streak)}`
        : formatNumber(row.settledBalance ?? row.balance ?? row.score);
      const secondary = scope === "streak"
        ? "acertos seguidos"
        : `${formatNumber(row.wins)} acertos · ${formatNumber(row.accuracy)}%`;
      return `
        <li class="${isMe ? "is-me" : ""}">
          <span class="pool-position ${position <= 3 ? `is-top-${position}` : ""}">${position}</span>
          <span class="avatar" aria-hidden="true">${escapeHTML(initials(row.name))}</span>
          <span><strong>${escapeHTML(row.name)}${isMe ? " (você)" : ""}</strong><small>${secondary}</small></span>
          <span><strong>${value}</strong><small>${scope === "streak" ? "sequência" : "fichas"}</small></span>
        </li>`;
    }).join("")}</ol>`;
  }

  function renderQuickRanking() {
    const rows = betting.leaderboard || [];
    return `
      <section class="pool-side-section pool-quick-ranking" aria-labelledby="quick-ranking-title">
        <header><h2 id="quick-ranking-title">Liderança geral</h2><button type="button" data-pool-action="switch-panel" data-panel="ranking">Ver ranking</button></header>
        ${rows.length ? renderRankingList(rows, 5, "overall") : '<p class="pool-side-empty">O ranking começa com o primeiro perfil.</p>'}
      </section>`;
  }

  function renderPerformance(profile) {
    if (!profile) {
      return `<section class="pool-panel"><div class="pool-empty"><h2>Desempenho pessoal</h2><p>Entre no bolão para acompanhar sua evolução e conquistas.</p></div></section>`;
    }
    const history = profile.balanceHistory || betting.balanceHistory || [];
    const max = Math.max(...history.map((point) => Number(point.balance || point.value || 0)), 1);
    const choices = profile.choiceDistribution || betting.choiceDistribution || [];
    const profit = Number(profile.profit || 0);
    return `
      <section class="pool-panel" aria-labelledby="performance-title">
        <header class="pool-panel-head"><div><h2 id="performance-title">Seu desempenho</h2><p>Números virtuais da temporada, com o mesmo resumo disponível em texto.</p></div>${renderSeasonSelect()}</header>
        <div class="pool-performance-summary">
          <div><span>Resultado virtual</span><strong>${profit > 0 ? "+" : ""}${formatNumber(profit)}</strong><small>${profit >= 0 ? "acima do saldo inicial" : "abaixo do saldo inicial"}</small></div>
          <div><span>Melhor sequência</span><strong>${formatNumber(profile.bestStreak ?? profile.currentStreak ?? 0)}</strong><small>acertos consecutivos</small></div>
          <div><span>Palpites apurados</span><strong>${formatNumber((profile.wins || 0) + (profile.losses || 0))}</strong><small>${formatNumber(profile.accuracy)}% de acerto</small></div>
        </div>
        <div class="pool-chart-section">
          <div>
            <h3>Evolução do saldo</h3>
            <p>${history.length ? `Do primeiro registro de ${formatNumber(history[0].balance || history[0].value)} até ${formatNumber(history.at(-1).balance || history.at(-1).value)} fichas.` : "A evolução aparece depois dos primeiros resultados."}</p>
          </div>
          ${history.length ? `<div class="pool-bar-chart" role="img" aria-label="Evolução do saldo: ${escapeHTML(history.map((point) => `${formatNumber(point.balance || point.value)} fichas`).join(", "))}">
            ${history.slice(-16).map((point) => `<span style="--bar-height:${Math.max(8, Math.round(Number(point.balance || point.value || 0) / max * 100))}%"></span>`).join("")}
          </div>` : '<div class="pool-chart-empty">Sem dados suficientes</div>'}
        </div>
        <div class="pool-chart-section">
          <div><h3>Distribuição de escolhas</h3><p>${choices.length ? choices.map((item) => `${playerName(item.playerId, item.name)}: ${formatNumber(item.percent)}%`).join(" · ") : "A distribuição aparece quando houver histórico suficiente."}</p></div>
          ${choices.length ? `<div class="pool-choice-bars">${choices.slice(0, 5).map((item) => `<div><span>${escapeHTML(playerName(item.playerId, item.name))}</span><i><b style="width:${Math.max(0, Math.min(100, Number(item.percent) || 0))}%"></b></i><strong>${formatNumber(item.percent)}%</strong></div>`).join("")}</div>` : ""}
        </div>
      </section>`;
  }

  function renderAchievements() {
    const achievements = betting.achievements || [];
    return `
      <section class="pool-side-section" aria-labelledby="achievements-title">
        <header><h2 id="achievements-title">Conquistas</h2><span>${achievements.length}</span></header>
        ${achievements.length ? `<ul class="pool-achievements">${achievements.slice(0, 6).map((achievement) => `
          <li><span aria-hidden="true">✓</span><div><strong>${escapeHTML(achievement.title || achievement.name || achievementLabel(achievement.achievementType || achievement.type))}</strong><small>${escapeHTML(achievement.description || formatDateTime(achievement.earnedAt || achievement.earned_at, ""))}</small></div></li>`).join("")}</ul>`
          : '<p class="pool-side-empty">O primeiro palpite já abre caminho para sua primeira conquista.</p>'}
      </section>`;
  }

  function achievementLabel(type) {
    return ({
      first_bet: "Primeiro palpite",
      first_win: "Primeiro acerto",
      streak_3: "Três acertos seguidos",
      three_win_streak: "Três acertos seguidos",
      streak_5: "Cinco acertos seguidos",
      five_win_streak: "Cinco acertos seguidos",
      underdog: "Acerto no azarão",
      underdog_win: "Acerto no azarão",
      round_leader: "Líder da rodada",
      monthly_leader: "Líder do mês",
      season_champion: "Campeão da temporada",
    })[type] || "Conquista do bolão";
  }

  function renderRules() {
    const rules = betting.rules;
    return `
      <section class="pool-side-section pool-rules" id="pool-rules" aria-labelledby="rules-title">
        <header><h2 id="rules-title">Regras vigentes</h2><span>versão ${rules.schemaVersion}</span></header>
        <dl>
          <div><dt>Ao acertar</dt><dd>Retorno conforme o multiplicador aceito em cada palpite.</dd></div>
          <div><dt>Ao errar</dt><dd>${escapeHTML(domain.lossPolicyText(rules))}</dd></div>
          <div><dt>Fechamento</dt><dd>${escapeHTML(closePolicyText(rules))}</dd></div>
          <div><dt>Limite</dt><dd>De ${formatNumber(rules.minStake)} a ${formatNumber(rules.maxStake)} fichas por partida.</dd></div>
        </dl>
        <p class="pool-virtual-notice"><strong>Uso recreativo.</strong> Fichas não têm valor financeiro e não podem ser compradas, sacadas ou trocadas por prêmio.</p>
      </section>`;
  }

  function closePolicyText(rules) {
    if (rules.closePolicy === "started_only") return "Quando a partida começa.";
    if (rules.closePolicy === "manual_or_started") return "Por decisão da organização ou quando a partida começa.";
    return rules.lockMinutesBefore
      ? `${rules.lockMinutesBefore} min antes do horário ou quando a partida começa.`
      : "No horário marcado ou quando a partida começa.";
  }

  function renderProfileEditor(profile) {
    if (!ui.profileEditorOpen) return "";
    const enabled = Boolean(profile.publicProfileEnabled ?? profile.public_profile_enabled);
    return `
      <section class="pool-profile-editor" aria-labelledby="profile-editor-title">
        <header><div><h2 id="profile-editor-title">Perfil no bolão</h2><p>Seu perfil público começa desligado. Ative somente se quiser aparecer além do ranking.</p></div><button class="icon-button" type="button" data-pool-action="close-profile" aria-label="Fechar edição do perfil">×</button></header>
        <form id="bettor-profile-form">
          <label class="pool-opt-in">
            <input type="checkbox" name="publicProfileEnabled" ${enabled ? "checked" : ""}>
            <span><strong>Permitir perfil público</strong><small>Mostra bio, jogador favorito e conquistas. Seu PIN nunca é exibido.</small></span>
          </label>
          <label class="field"><span>Bio curta <small>(opcional)</small></span><textarea name="bio" maxlength="180" rows="3">${escapeHTML(profile.bio || "")}</textarea></label>
          <label class="field"><span>Jogador favorito <small>(opcional)</small></span>
            <select name="favoritePlayerId"><option value="">Não informar</option>${[...playersMap().values()].map((player) => `<option value="${escapeHTML(player.id)}"${String(profile.favoritePlayerId || "") === String(player.id) ? " selected" : ""}>${escapeHTML(player.name)}</option>`).join("")}</select>
          </label>
          <div class="pool-form-actions"><button class="button button-ghost" type="button" data-pool-action="close-profile">Cancelar</button><button class="button button-primary" type="submit">Salvar perfil</button></div>
        </form>
      </section>`;
  }

  function updateCountdowns() {
    dom.content.querySelectorAll("[data-countdown]").forEach((element) => {
      const value = element.dataset.countdown;
      if (value) element.textContent = formatRelative(value);
    });
  }

  function updateLocalPreview(form) {
    const stake = Number(new FormData(form).get("stake"));
    const existing = betsMap().get(matchKey(form.dataset.kind, form.dataset.matchId));
    const preview = domain.calculatePreview({ stake, acceptedOdds: existing?.acceptedOdds, rules: existing?.rulesSnapshot || betting.rules });
    form.querySelector("[data-preview-return]").textContent = `${formatNumber(preview.potentialReturn)} fichas`;
    form.querySelector("[data-preview-odds]").textContent = `multiplicador ${formatNumber(preview.acceptedOdds, 2)}×`;
  }

  function reviewBet(form) {
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const winnerId = String(data.get("winner") || "");
    if (!winnerId) {
      showToast("Escolha um vencedor antes de revisar.", "error");
      return;
    }
    const existing = betsMap().get(matchKey(form.dataset.kind, form.dataset.matchId));
    const preview = domain.calculatePreview({
      stake: data.get("stake"),
      acceptedOdds: existing?.acceptedOdds,
      rules: existing?.rulesSnapshot || betting.rules,
    });
    const review = form.querySelector("[data-bet-review]");
    review.hidden = false;
    review.innerHTML = `
      <div>
        <span>Você escolheu</span>
        <strong>${escapeHTML(playerName(winnerId))}</strong>
        <small>${formatNumber(preview.stake)} fichas reservadas</small>
      </div>
      <dl>
        <div><dt>Se acertar</dt><dd>${formatNumber(preview.potentialReturn)} fichas retornam ao saldo</dd></div>
        <div><dt>Se não acertar</dt><dd>${escapeHTML(domain.lossPolicyText(preview.rules))}</dd></div>
        <div><dt>Multiplicador</dt><dd>${formatNumber(preview.acceptedOdds, 2)}× na prévia; o servidor confirma o valor aceito</dd></div>
      </dl>
      <div class="pool-review-actions">
        <button class="button button-ghost" type="button" data-pool-action="close-review">Continuar editando</button>
        <button class="button button-primary" type="submit">${existing ? "Confirmar alteração" : "Confirmar palpite"}</button>
      </div>`;
    review.querySelector("button[type='submit']")?.focus();
    requestServerPreview(form, review);
  }

  function requestServerPreview(form, review) {
    window.clearTimeout(serverPreviewTimer);
    serverPreviewTimer = window.setTimeout(async () => {
      const data = new FormData(form);
      const params = new URLSearchParams({
        matchId: form.dataset.matchId,
        winnerId: String(data.get("winner") || ""),
        stake: String(data.get("stake") || ""),
      });
      try {
        const payload = await optionalJSON(`/api/bets/preview?${params}`);
        if (!payload || review.hidden) return;
        const preview = domain.calculatePreview({
          stake: payload.stake ?? data.get("stake"),
          acceptedOdds: payload.acceptedOddsPreview ?? payload.acceptedOdds ?? payload.odds,
          rules: payload.rules || betting.rules,
        });
        const odds = review.querySelector("dl div:nth-child(3) dd");
        const returnField = review.querySelector("dl div:first-child dd");
        if (odds) odds.textContent = `${formatNumber(preview.acceptedOdds, 2)}× será aceito na confirmação`;
        if (returnField) returnField.textContent = `${formatNumber(payload.potentialReturn ?? preview.potentialReturn)} fichas retornam ao saldo`;
      } catch (error) {
        console.warn("Prévia oficial indisponível; mantendo cálculo local.", error);
      }
    }, 250);
  }

  async function submitAccess(form, mode) {
    const data = new FormData(form);
    const name = cleanText(data.get("name"));
    const pin = cleanText(data.get("pin"));
    if (!/^\d{4,8}$/.test(pin)) {
      showToast("Use um PIN com 4 a 8 números.", "error");
      return;
    }
    if (mode === "register" && pin !== cleanText(data.get("pinConfirm"))) {
      showToast("Os PINs não conferem.", "error");
      return;
    }
    const button = form.querySelector("button[type='submit']");
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
    const data = new FormData(form);
    const button = form.querySelector("button[type='submit']");
    button.disabled = true;
    try {
      const payload = await fetchJSON("/api/bets/wager", {
        method: "POST",
        body: JSON.stringify({
          matchKind: form.dataset.kind,
          matchId: form.dataset.matchId,
          predictedWinnerId: String(data.get("winner") || ""),
          stake: Number(data.get("stake")),
        }),
      });
      betting = domain.normalizeSnapshot(payload);
      showToast("Palpite confirmado com seu snapshot de regras.");
      render();
      document.querySelector(`#match-${CSS.escape(form.dataset.matchId)}`)?.scrollIntoView({ block: "center" });
    } catch (error) {
      if (error.status === 401) {
        saveToken("");
        showToast("Sua sessão expirou. Entre novamente para confirmar.", "error");
        await loadAll({ quiet: true });
      } else if (error.status === 409) {
        showConflict(form, error);
      } else {
        showToast(error.message, "error");
        button.disabled = false;
      }
    }
  }

  function showConflict(form, error) {
    const review = form.querySelector("[data-bet-review]");
    review.hidden = false;
    review.innerHTML = `
      <div class="pool-conflict" role="alert">
        <strong>Esta partida mudou enquanto você confirmava.</strong>
        <p>${escapeHTML(error.message || "O horário, multiplicador ou estado de fechamento foi atualizado.")}</p>
        <button class="button button-primary" type="button" data-pool-action="refresh-conflict">Recarregar dados</button>
      </div>`;
    review.querySelector("button")?.focus();
  }

  async function cancelBet(button) {
    const confirmed = await askConfirm(
      "Cancelar este palpite?",
      "As fichas reservadas voltarão ao saldo conforme a regra aceita.",
      "Cancelar palpite",
      button,
    );
    if (!confirmed) return;
    try {
      const payload = await fetchJSON("/api/bets/cancel", {
        method: "POST",
        body: JSON.stringify({ matchKind: button.dataset.kind, matchId: button.dataset.matchId }),
      });
      betting = domain.normalizeSnapshot(payload);
      showToast("Palpite cancelado.");
      render();
    } catch (error) {
      if (error.status === 409) showToast("A partida fechou e o palpite não pode mais ser cancelado.", "error");
      else showToast(error.message, "error");
    }
  }

  async function saveProfile(form) {
    const data = new FormData(form);
    const body = {
      publicProfileEnabled: data.get("publicProfileEnabled") === "on",
      bio: cleanText(data.get("bio")),
      favoritePlayerId: cleanText(data.get("favoritePlayerId")) || null,
    };
    const button = form.querySelector("button[type='submit']");
    button.disabled = true;
    try {
      const payload = await fetchJSON("/api/bettors/profile", {
        method: "PUT",
        body: JSON.stringify(body),
      });
      betting.profile = payload.profile || payload.me || payload;
      ui.profileEditorOpen = false;
      showToast("Preferências do perfil salvas.");
      render();
    } catch (error) {
      if ([404, 405, 501].includes(error.status)) {
        showToast("O servidor ainda não habilitou a edição de perfil público.", "error");
      } else {
        showToast(error.message, "error");
      }
      button.disabled = false;
    }
  }

  async function loadRanking(scope) {
    ui.rankingScope = scope;
    const position = preserveInteraction();
    render();
    restoreInteraction(position);
    if (betting.rankings?.[scope]) return;
    try {
      const payload = await optionalJSON(`/api/bets/leaderboard?scope=${encodeURIComponent(scope)}`);
      if (!payload) return;
      betting.rankings = {
        ...betting.rankings,
        [scope]: payload.leaderboard || payload.rows || (Array.isArray(payload) ? payload : []),
      };
      render();
      restoreInteraction(position);
    } catch (error) {
      showToast("Não foi possível carregar este ranking.", "error");
    }
  }

  function askConfirm(title, message, actionLabel, trigger = null) {
    confirmTrigger = trigger || document.activeElement;
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
    if (dom.confirmDialog.open) dom.confirmDialog.close("cancel");
  }

  dom.content.addEventListener("submit", (event) => {
    const form = event.target;
    if (form.matches("#bettor-login-form")) {
      event.preventDefault();
      submitAccess(form, "login");
    } else if (form.matches("#bettor-register-form")) {
      event.preventDefault();
      submitAccess(form, "register");
    } else if (form.matches("[data-bet-form]")) {
      event.preventDefault();
      submitBet(form);
    } else if (form.matches("#bettor-profile-form")) {
      event.preventDefault();
      saveProfile(form);
    }
  });

  dom.content.addEventListener("input", (event) => {
    const form = event.target.closest("[data-bet-form]");
    if (!form) return;
    if (event.target.matches("input[name='stake']")) updateLocalPreview(form);
    const review = form.querySelector("[data-bet-review]");
    if (review && !review.hidden) review.hidden = true;
  });

  dom.content.addEventListener("change", (event) => {
    if (event.target.matches("#pool-player-filter")) {
      ui.playerFilter = event.target.value;
      ui.matchLimit = 12;
      render();
      return;
    }
    if (event.target.matches("[data-bet-form] input[name='winner']")) {
      const form = event.target.closest("[data-bet-form]");
      form.querySelectorAll(".pool-pick").forEach((option) => {
        const selected = option.contains(event.target) && event.target.checked;
        option.classList.toggle("is-selected", selected);
        option.querySelector("small").textContent = selected ? "Escolhido" : "Escolher vencedor";
      });
    }
  });

  dom.content.addEventListener("click", (event) => {
    const button = event.target.closest("[data-pool-action]");
    if (!button) return;
    const action = button.dataset.poolAction;
    if (action === "retry-load" || action === "refresh-conflict") loadAll();
    else if (action === "scroll-rules") document.querySelector("#pool-rules")?.scrollIntoView({ behavior: "smooth" });
    else if (action === "logout") {
      saveToken("");
      betting.profile = null;
      betting.myBets = [];
      ui.profileEditorOpen = false;
      showToast("Você saiu do bolão.");
      loadAll({ quiet: true });
    } else if (action === "switch-panel") {
      ui.activePanel = button.dataset.panel;
      window.history.pushState({ panel: ui.activePanel }, "", `#${ui.activePanel}`);
      render();
      dom.content.querySelector(".pool-panel")?.focus?.();
    } else if (action === "filter-matches") {
      ui.matchFilter = button.dataset.filter;
      ui.matchLimit = 12;
      render();
    } else if (action === "show-more-matches") {
      ui.matchLimit += 12;
      render();
    } else if (action === "filter-history") {
      ui.historyFilter = button.dataset.filter;
      render();
    } else if (action === "ranking-scope") {
      loadRanking(button.dataset.scope);
    } else if (action === "open-match") {
      ui.activePanel = "matches";
      window.history.pushState({ panel: "matches" }, "", "#matches");
      ui.matchFilter = "all";
      render();
      document.querySelector(`#match-${CSS.escape(button.dataset.matchId)}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    } else if (action === "review-bet") reviewBet(button.closest("[data-bet-form]"));
    else if (action === "close-review") {
      const review = button.closest("[data-bet-review]");
      review.hidden = true;
      button.closest("[data-bet-form]")?.querySelector("input:checked")?.focus();
    } else if (action === "toggle-timeline") {
      ui.expandedBetId = ui.expandedBetId === button.dataset.betId ? "" : button.dataset.betId;
      render();
      dom.content.querySelector(`[data-bet-id="${CSS.escape(button.dataset.betId)}"]`)?.focus();
    } else if (action === "edit-profile") {
      ui.profileEditorOpen = true;
      render();
      document.querySelector("#profile-editor-title")?.scrollIntoView({ behavior: "smooth" });
    } else if (action === "close-profile") {
      ui.profileEditorOpen = false;
      render();
    } else if (action === "cancel-bet") cancelBet(button);
  });

  document.querySelectorAll("[data-close-confirm]").forEach((button) => {
    button.addEventListener("click", closeConfirm);
  });

  dom.confirmDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeConfirm();
  });

  dom.confirmDialog.addEventListener("close", () => {
    if (confirmResolver) {
      const resolver = confirmResolver;
      confirmResolver = null;
      resolver(dom.confirmDialog.returnValue === "confirm");
    }
    confirmTrigger?.focus?.();
    confirmTrigger = null;
  });

  window.addEventListener("online", () => loadAll({ quiet: true }));
  window.addEventListener("offline", () => setConnectionStatus(
    "offline",
    "Você está offline. Os últimos dados continuam visíveis; confirmações estão pausadas.",
  ));
  window.addEventListener("storage", (event) => {
    if (event.key === TOKEN_KEY) loadAll({ quiet: true });
  });
  window.addEventListener("popstate", () => {
    const panel = window.location.hash.slice(1);
    ui.activePanel = ["matches", "history", "ranking", "performance"].includes(panel) ? panel : "matches";
    render();
  });

  if ("serviceWorker" in navigator && window.isSecureContext) {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((error) => {
      console.warn("O modo offline do bolão não pôde ser ativado.", error);
    });
  }

  loadAll();
  window.setInterval(() => {
    updateCountdowns();
    if (document.hidden || document.activeElement?.closest?.("form, dialog")) return;
    loadAll({ quiet: true });
  }, SYNC_INTERVAL_MS);
})();

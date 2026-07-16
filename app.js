(() => {
  "use strict";

  const STORAGE_KEY = "sinuca-da-firma-v3-cache";
  const LEGACY_STORAGE_KEY = "sinuca-da-firma-v1";
  const NEWS_VISITOR_STORAGE_KEY = "sinuca-news-visitor-v1";
  const APP_VERSION = 4;
  const SYNC_INTERVAL_MS = 4000;
  const MAX_PLAYERS = 32;
  const MAX_BALLS_PER_PLAYER = 8;
  const BALANCE_BALLS_PER_PLAYER = 8;
  const BASE_MATCH_GAP = 120;
  const MAX_NEWS_IMAGE_BYTES = 900 * 1024;
  const HIDDEN_VIEWS = new Set(["draw", "matches", "ranking"]);

  const INITIAL_NAMES = [
    "Johnny",
    "Rodolfo",
    "Rafael",
    "Matheus",
    "João Paulo",
    "Léo",
    "Marcelo",
    "Vello",
    "Lucas Passos",
    "Lucas Kane",
  ];

  const ADMIN_ACTIONS = new Set([
    "generate-league",
    "generate-draw",
    "open-score",
    "edit-player",
    "delete-player",
    "import-data",
    "reset-data",
    "toggle-match-live",
    "edit-news",
    "delete-news",
    "delete-news-comment",
  ]);

  const VIEW_META = {
    dashboard: {
      title: "Visão geral",
      subtitle: "Acompanhe o andamento do campeonato.",
    },
    players: {
      title: "Jogadores",
      subtitle: "Cadastre e organize os participantes.",
    },
    league: {
      title: "Liga por pontos",
      subtitle: "Todos se enfrentam e a classificação define o campeão.",
    },
    "league-ranking": {
      title: "Ranking da liga",
      subtitle: "Classificação por pontos, vitórias e saldo de bolas.",
    },
    news: {
      title: "Notícias",
      subtitle: "Histórias, resultados e bastidores do campeonato.",
    },
    draw: {
      title: "Mata-mata",
      subtitle: "Módulo eliminatório opcional, preservado no sistema.",
    },
    matches: {
      title: "Partidas do mata-mata",
      subtitle: "Registre placares e consulte os confrontos eliminatórios.",
    },
    ranking: {
      title: "Ranking do mata-mata",
      subtitle: "Pontuação calculada a partir da chave eliminatória.",
    },
    settings: {
      title: "Configurações",
      subtitle: "Personalize regras, pontuação e dados persistentes.",
    },
  };

  const dom = {
    content: document.querySelector("#app-content"),
    pageTitle: document.querySelector("#page-title"),
    pageSubtitle: document.querySelector("#page-subtitle"),
    brandTitle: document.querySelector("#brand-title"),
    publicBrandTitle: document.querySelector("#public-brand-title"),
    menuButton: document.querySelector("#menu-button"),
    drawerBackdrop: document.querySelector("#drawer-backdrop"),
    quickDraw: document.querySelector("#quick-draw"),
    quickExport: document.querySelector("#quick-export"),
    authActions: document.querySelector("#auth-actions"),
    scoreDialog: document.querySelector("#score-dialog"),
    scoreForm: document.querySelector("#score-form"),
    scoreRound: document.querySelector("#score-round"),
    scoreTitle: document.querySelector("#score-title"),
    scoreMatchId: document.querySelector("#score-match-id"),
    scoreMatchKind: document.querySelector("#score-match-kind"),
    scorePlayerA: document.querySelector("#score-player-a"),
    scorePlayerB: document.querySelector("#score-player-b"),
    scoreA: document.querySelector("#score-a"),
    scoreB: document.querySelector("#score-b"),
    scoreBallsPlayerA: document.querySelector("#score-balls-player-a"),
    scoreBallsPlayerB: document.querySelector("#score-balls-player-b"),
    scoreBallsA: document.querySelector("#score-balls-a"),
    scoreBallsB: document.querySelector("#score-balls-b"),
    scoreHelp: document.querySelector("#score-help"),
    scoreError: document.querySelector("#score-error"),
    deleteScore: document.querySelector("#delete-score"),
    confirmDialog: document.querySelector("#confirm-dialog"),
    confirmTitle: document.querySelector("#confirm-title"),
    confirmMessage: document.querySelector("#confirm-message"),
    confirmAction: document.querySelector("#confirm-action"),
    newsPreviewDialog: document.querySelector("#news-preview-dialog"),
    newsPreviewContent: document.querySelector("#news-preview-content"),
    importFile: document.querySelector("#import-file"),
    toastRegion: document.querySelector("#toast-region"),
    storageStatus: document.querySelector("#storage-status"),
    storageStatusDot: document.querySelector("#storage-status-dot"),
    storageStatusText: document.querySelector("#storage-status-text"),
    storageStatusSubtext: document.querySelector("#storage-status-subtext"),
  };

  const ui = {
    currentView: "dashboard",
    matchFilter: "all",
    leagueRoundFilter: "all",
    leagueMatchFilter: "all",
    playerSearch: "",
    editingNewsId: null,
    selectedNewsId: null,
    moderatingNewsId: null,
    editingPlayerId: null,
    confirmResolver: null,
  };

  let state = createDefaultState();
  let newsItems = [];
  let newsLoading = true;
  let newsError = "";
  let newsEngagement = {};
  let auth = { authenticated: false, username: null };
  let serverRevision = 0;
  let pendingSaves = 0;
  let saveQueue = Promise.resolve();
  let syncInProgress = false;
  let lastSyncErrorToastAt = 0;

  function createDefaultState() {
    const now = new Date().toISOString();
    return {
      version: APP_VERSION,
      settings: {
        title: "Sinuca da Firma",
        scoreMode: "frames",
        framesToWin: 2,
        thirdPlace: true,
        league: {
          winPoints: 3,
          lossPoints: 0,
        },
        ranking: {
          participation: 1,
          win: 3,
          champion: 10,
          runnerUp: 7,
          semifinal: 5,
          quarterfinal: 3,
          roundOf16: 1,
        },
      },
      players: INITIAL_NAMES.map((name, index) => ({
        id: `player-${index + 1}`,
        name,
        createdAt: now,
      })),
      league: null,
      tournament: null,
      activity: [
        {
          id: createId("activity"),
          type: "setup",
          text: "Campeonato criado com 10 jogadores",
          detail: "Lista inicial carregada",
          at: now,
        },
      ],
    };
  }

  function loadCachedState() {
    const fallback = createDefaultState();
    try {
      const raw =
        localStorage.getItem(STORAGE_KEY) ||
        localStorage.getItem(LEGACY_STORAGE_KEY);
      if (!raw) return fallback;
      return normalizeLoadedState(JSON.parse(raw), fallback);
    } catch (error) {
      console.warn("Não foi possível carregar o cache local.", error);
      return fallback;
    }
  }

  function normalizeLoadedState(parsed, fallback) {
    if (!parsed || typeof parsed !== "object") return fallback;
    const settings = parsed.settings || {};
    const ranking = settings.ranking || {};
    const leagueSettings = settings.league || {};
    const players = Array.isArray(parsed.players)
      ? parsed.players
          .filter((player) => player && typeof player.name === "string")
          .map((player) => ({
            id: player.id || createId("player"),
            name: player.name.trim(),
            createdAt: player.createdAt || new Date().toISOString(),
          }))
          .filter((player) => player.name)
      : fallback.players;

    return {
      version: APP_VERSION,
      settings: {
        ...fallback.settings,
        ...settings,
        league: {
          ...fallback.settings.league,
          ...leagueSettings,
        },
        ranking: {
          ...fallback.settings.ranking,
          ...ranking,
        },
      },
      players,
      league:
        parsed.league && typeof parsed.league === "object"
          ? parsed.league
          : null,
      tournament:
        parsed.tournament && typeof parsed.tournament === "object"
          ? parsed.tournament
          : null,
      activity: Array.isArray(parsed.activity)
        ? parsed.activity.slice(0, 80)
        : fallback.activity,
    };
  }

  function cacheState(snapshot = state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch (error) {
      console.warn("Não foi possível atualizar o cache do navegador.", error);
    }
  }

  function setStorageStatus(status, detail = "") {
    if (!dom.storageStatusText || !dom.storageStatusSubtext) return;
    dom.storageStatus?.classList.toggle("is-offline", status === "offline");
    dom.storageStatus?.classList.toggle("is-saving", status === "saving");

    if (status === "online") {
      dom.storageStatusText.textContent = auth.authenticated
        ? "Dados salvos no servidor"
        : "Modo público · somente leitura";
      dom.storageStatusSubtext.textContent = detail || "Dados compartilhados com segurança";
      return;
    }
    if (status === "saving") {
      dom.storageStatusText.textContent = "Salvando no banco...";
      dom.storageStatusSubtext.textContent = "Não feche o servidor durante a gravação";
      return;
    }
    dom.storageStatusText.textContent = "Servidor indisponível";
    dom.storageStatusSubtext.textContent = detail || "Usando cache deste navegador";
  }

  function notifySyncError(message) {
    const now = Date.now();
    if (now - lastSyncErrorToastAt < 12000) return;
    lastSyncErrorToastAt = now;
    showToast(message, "error");
  }

  function isAdmin() {
    return Boolean(auth.authenticated);
  }

  function loginUrl() {
    const next = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    return `/login?next=${encodeURIComponent(next)}`;
  }

  function requireAdmin() {
    if (isAdmin()) return true;
    showToast("Entre como administrador para alterar o campeonato.", "error");
    return false;
  }

  async function readAuthFromServer() {
    const response = await fetch("/api/auth", { cache: "no-store" });
    if (!response.ok) throw new Error(`Falha ao consultar login: HTTP ${response.status}`);
    return response.json();
  }

  function updateAuthUI() {
    if (!dom.authActions) return;
    if (isAdmin()) {
      dom.authActions.innerHTML = `
        <span class="admin-badge" title="Alterações liberadas">● Admin</span>
        <button class="button button-small button-ghost" type="button" id="logout-button">Sair</button>
      `;
      return;
    }
    dom.authActions.innerHTML = `<a class="button button-small button-ghost" href="${loginUrl()}">Login admin</a>`;
  }

  function applyAuthorizationToView() {
    updateAuthUI();
    document.body.classList.toggle("is-admin", isAdmin());
    document.body.classList.toggle("is-public", !isAdmin());

    if (isAdmin()) return;

    const protectedSelector = [
      '[data-action="generate-league"]',
      '[data-action="generate-draw"]',
      '[data-action="open-score"]',
      '[data-action="edit-player"]',
      '[data-action="delete-player"]',
      '[data-action="import-data"]',
      '[data-action="reset-data"]',
    ].join(",");

    dom.content.querySelectorAll(protectedSelector).forEach((control) => {
      if ("disabled" in control) control.disabled = true;
      control.classList.add("admin-locked");
      control.setAttribute("title", "Somente o administrador pode usar esta ação");
      control.setAttribute("aria-disabled", "true");
    });

    dom.content.querySelectorAll("#add-player-form input, #add-player-form button, #settings-form input, #settings-form select, #settings-form button, #news-form input, #news-form textarea, #news-form select, #news-form button").forEach((control) => {
      control.disabled = true;
      control.classList.add("admin-locked");
    });

  }

  async function logoutAdmin() {
    try {
      await fetch("/api/logout", { method: "POST" });
    } catch (error) {
      console.warn("Falha ao encerrar a sessão no servidor.", error);
    }
    auth = { authenticated: false, username: null };
    closeScoreDialog();
    closeConfirmDialog();
    render();
    setStorageStatus("online", `Banco compartilhado · revisão ${serverRevision}`);
    showToast("Sessão administrativa encerrada.");
  }

  function saveState() {
    if (!requireAdmin()) return;
    state.version = APP_VERSION;
    const snapshot = JSON.parse(JSON.stringify(state));
    cacheState(snapshot);
    updateBrand();
    pendingSaves += 1;
    setStorageStatus("saving");

    saveQueue = saveQueue
      .catch(() => undefined)
      .then(async () => {
        const response = await fetch("/api/state", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: snapshot }),
        });
        if (!response.ok) {
          const error = new Error(`Falha ao salvar: HTTP ${response.status}`);
          error.status = response.status;
          throw error;
        }
        const payload = await response.json();
        serverRevision = Number(payload.revision) || serverRevision;
        setStorageStatus("online", `Banco compartilhado · revisão ${serverRevision}`);
      })
      .catch(async (error) => {
        console.error("Erro ao salvar no banco.", error);
        if (error.status === 401) {
          auth = { authenticated: false, username: null };
          try {
            const payload = await readStateFromServer();
            state = normalizeLoadedState(payload.state, createDefaultState());
            serverRevision = Number(payload.revision) || serverRevision;
            cacheState(state);
          } catch (reloadError) {
            console.warn("Não foi possível restaurar o estado do servidor.", reloadError);
          }
          setStorageStatus("online", `Banco compartilhado · revisão ${serverRevision}`);
          render();
          showToast("Sua sessão expirou. Entre novamente para salvar alterações.", "error");
          return;
        }
        setStorageStatus("offline", "Alterações mantidas apenas no cache local");
        notifySyncError("Não foi possível salvar no banco do servidor.");
      })
      .finally(() => {
        pendingSaves = Math.max(0, pendingSaves - 1);
      });
  }

  async function readStateFromServer() {
    const response = await fetch("/api/state", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Falha ao carregar: HTTP ${response.status}`);
    }
    return response.json();
  }

  async function readNewsFromServer() {
    newsError = "";
    const response = await fetch("/api/news", { cache: "no-store" });
    if (!response.ok) throw new Error(`Falha ao carregar notícias: HTTP ${response.status}`);
    const payload = await response.json();
    newsItems = Array.isArray(payload.articles) ? payload.articles : [];
    newsLoading = false;
  }

  function newsVisitorId() {
    let visitor = localStorage.getItem(NEWS_VISITOR_STORAGE_KEY);
    if (visitor && /^[a-zA-Z0-9._-]{16,100}$/.test(visitor)) return visitor;
    visitor = `visitor-${createId("news").replace(/[^a-zA-Z0-9-]/g, "")}`;
    localStorage.setItem(NEWS_VISITOR_STORAGE_KEY, visitor);
    return visitor;
  }

  async function readNewsEngagement(articleId) {
    if (!articleId) return null;
    const response = await fetch(`/api/news/engagement?id=${encodeURIComponent(articleId)}`, {
      cache: "no-store",
      headers: { "X-News-Visitor": newsVisitorId() },
    });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 404 && newsItems.some((article) => article.id === articleId)) {
      const empty = { comments: [], rating: { count: 0, average: 0, userScore: 0 } };
      newsEngagement[articleId] = empty;
      return empty;
    }
    if (!response.ok) throw new Error(payload.error || "Não foi possível carregar os comentários.");
    newsEngagement[articleId] = payload;
    return payload;
  }

  async function initializeApp() {
    const cachedState = loadCachedState();
    state = cachedState;
    updateBrand();
    setStorageStatus("saving", "Conectando ao banco do campeonato");
    const authRequest = readAuthFromServer();
    const stateRequest = readStateFromServer();
    const newsRequest = readNewsFromServer();

    try {
      const authPayload = await authRequest;
      auth = {
        authenticated: Boolean(authPayload.authenticated),
        username: authPayload.username || null,
      };
    } catch (error) {
      console.warn("Não foi possível consultar o login administrativo.", error);
      auth = { authenticated: false, username: null };
    }

    try {
      const payload = await stateRequest;
      serverRevision = Number(payload.revision) || 0;
      if (payload.state) {
        state = normalizeLoadedState(payload.state, createDefaultState());
        cacheState(state);
        setStorageStatus("online", `Banco compartilhado · revisão ${serverRevision}`);
      } else {
        state = cachedState;
        saveState();
      }
    } catch (error) {
      console.error("Banco do servidor indisponível.", error);
      state = cachedState;
      setStorageStatus("offline", "Usando cache deste navegador");
      notifySyncError("Servidor indisponível; os dados ainda não estão compartilhados.");
    }

    try {
      await newsRequest;
    } catch (error) {
      console.warn("Não foi possível carregar as notícias.", error);
      newsLoading = false;
      newsError = "Não foi possível buscar as notícias agora.";
    }

    const requestedParts = window.location.hash.slice(1).split("/");
    const requestedView = requestedParts[0];
    if (requestedView === "news" && requestedParts[1]) {
      ui.selectedNewsId = decodeURIComponent(requestedParts.slice(1).join("/"));
      try {
        await readNewsEngagement(ui.selectedNewsId);
      } catch (error) {
        console.warn("Não foi possível carregar a conversa da notícia.", error);
      }
    }
    if (VIEW_META[requestedView] && !HIDDEN_VIEWS.has(requestedView) && (isAdmin() || ["league", "league-ranking", "news"].includes(requestedView))) {
      ui.currentView = requestedView;
    } else if (HIDDEN_VIEWS.has(requestedView)) {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#league`);
      ui.currentView = "league";
    }
    updateBrand();
    render();
    if (ui.currentView === "league-ranking" && !isAdmin()) {
      window.requestAnimationFrame(() => document.querySelector("#public-league-ranking")?.scrollIntoView({ block: "start" }));
    }
    window.setInterval(syncFromServer, SYNC_INTERVAL_MS);
  }

  async function syncFromServer() {
    if (
      syncInProgress ||
      pendingSaves > 0 ||
      document.hidden ||
      dom.scoreDialog.open ||
      dom.confirmDialog.open
    ) {
      return;
    }

    syncInProgress = true;
    try {
      const payload = await readStateFromServer();
      const incomingRevision = Number(payload.revision) || 0;
      setStorageStatus("online", `Banco compartilhado · revisão ${incomingRevision}`);
      if (payload.state && incomingRevision > serverRevision) {
        state = normalizeLoadedState(payload.state, createDefaultState());
        serverRevision = incomingRevision;
        cacheState(state);
        render();
        showToast("Dados atualizados por outro usuário.");
      }
      if (ui.currentView === "news") await readNewsFromServer();
    } catch (error) {
      console.warn("Sincronização temporariamente indisponível.", error);
      setStorageStatus("offline", "Tentando reconectar automaticamente");
    } finally {
      syncInProgress = false;
    }
  }

  function createId(prefix = "id") {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return `${prefix}-${window.crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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

  function formatDateTime(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(date);
  }

  function formatRelativeTime(value) {
    if (!value) return "";
    const time = new Date(value).getTime();
    const diffMinutes = Math.round((time - Date.now()) / 60000);
    const formatter = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });
    if (Math.abs(diffMinutes) < 60) return formatter.format(diffMinutes, "minute");
    const diffHours = Math.round(diffMinutes / 60);
    if (Math.abs(diffHours) < 24) return formatter.format(diffHours, "hour");
    return formatter.format(Math.round(diffHours / 24), "day");
  }

  function getInitials(name) {
    return String(name || "?")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("");
  }

  function playerById(id) {
    return state.players.find((player) => player.id === id) || null;
  }

  function playerName(id, fallback = "A definir") {
    return playerById(id)?.name || fallback;
  }

  function updateBrand() {
    const title = state.settings.title.trim() || "Sinuca da Firma";
    dom.brandTitle.textContent = title;
    if (dom.publicBrandTitle) dom.publicBrandTitle.textContent = title;
    document.title = title;
  }

  function logActivity(type, text, detail = "") {
    state.activity.unshift({
      id: createId("activity"),
      type,
      text,
      detail,
      at: new Date().toISOString(),
    });
    state.activity = state.activity.slice(0, 80);
  }

  function showToast(message, kind = "success") {
    const toast = document.createElement("div");
    toast.className = `toast${kind === "error" ? " is-error" : ""}`;
    toast.innerHTML = `<span>${kind === "error" ? "!" : "✓"}</span><span>${escapeHTML(message)}</span>`;
    dom.toastRegion.append(toast);
    window.setTimeout(() => toast.remove(), 3300);
  }

  function updateNavigationState(view) {
    document.querySelectorAll(".nav-item[data-view], .public-nav [data-view]").forEach((button) => {
      const active = button.dataset.view === view;
      button.classList.toggle("is-active", active);
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    document.querySelectorAll('.public-nav [data-action="navigate-public-ranking"]').forEach((button) => {
      const active = view === "league-ranking";
      button.classList.toggle("is-active", active);
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
  }

  function navigate(view, options = {}) {
    if (!VIEW_META[view]) return;
    if (HIDDEN_VIEWS.has(view)) view = "league";
    if (!isAdmin() && !["dashboard", "league", "league-ranking", "news"].includes(view)) {
      view = "dashboard";
    }
    ui.currentView = view;
    const nextHash = view === "dashboard" ? "" : `#${view}`;
    const historyMethod = options.replace ? "replaceState" : "pushState";
    window.history[historyMethod](null, "", `${window.location.pathname}${window.location.search}${nextHash}`);
    updateNavigationState(view);
    const meta = VIEW_META[view];
    dom.pageTitle.textContent = meta.title;
    dom.pageSubtitle.textContent = meta.subtitle;
    document.body.dataset.view = view;
    closeMenu();
    render();
    dom.content.focus({ preventScroll: true });
    if (options.scrollToTop !== false) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  function navigateToPublicLeagueRanking() {
    navigate("league-ranking", { scrollToTop: false });
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const ranking = document.querySelector("#public-league-ranking");
        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (!ranking) {
          window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
          return;
        }
        ranking.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
        ranking.focus({ preventScroll: true });
      });
    });
  }

  function openMenu() {
    document.body.classList.add("menu-open");
  }

  function closeMenu() {
    document.body.classList.remove("menu-open");
  }

  function render() {
    try {
      if (HIDDEN_VIEWS.has(ui.currentView)) ui.currentView = "league";
      document.body.dataset.view = ui.currentView;
      const viewMeta = VIEW_META[ui.currentView];
      dom.pageTitle.textContent = viewMeta.title;
      dom.pageSubtitle.textContent = viewMeta.subtitle;
      updateNavigationState(ui.currentView);
      normalizeLeagueResults();
      normalizeTournamentResults();
      updateBrand();
      updateQuickActions();

      const renderers = {
        dashboard: renderDashboard,
        players: renderPlayers,
        league: renderLeague,
        "league-ranking": renderLeagueRanking,
        news: renderNews,
        draw: renderDraw,
        matches: renderMatches,
        ranking: renderRanking,
        settings: renderSettings,
      };
      dom.content.innerHTML = renderers[ui.currentView]();
      applyAuthorizationToView();
      setupPublicMotion();
    } catch (error) {
      console.error("Erro ao renderizar a tela.", error);
      dom.content.innerHTML = `
        <section class="card">
          <div class="empty-state">
            <div class="empty-state-icon">!</div>
            <h3>Não foi possível abrir esta tela</h3>
            <p>Atualize a página. Se o problema continuar, exporte o backup e consulte o console do navegador.</p>
            <button class="button button-primary" data-action="navigate" data-view="dashboard">Voltar à visão geral</button>
          </div>
        </section>
      `;
    }
  }

  function updateQuickActions() {
    if (state.league) {
      dom.quickDraw.textContent = "Ver liga";
      dom.quickDraw.disabled = false;
      dom.quickDraw.title = "Abrir a liga por pontos";
    } else if (isAdmin()) {
      dom.quickDraw.textContent = "Gerar liga";
      dom.quickDraw.disabled = false;
      dom.quickDraw.title = "Criar a tabela todos contra todos";
    } else {
      dom.quickDraw.textContent = "Liga não iniciada";
      dom.quickDraw.disabled = true;
      dom.quickDraw.title = "O administrador ainda não gerou a liga";
    }
    updateAuthUI();
  }

  function createLeagueSchedule() {
    const participantIds = secureShuffle(state.players.map((player) => player.id));
    const rotation = [...participantIds];
    if (rotation.length % 2 === 1) rotation.push(null);

    const slotCount = rotation.length;
    const roundCount = Math.max(0, slotCount - 1);
    const rounds = [];
    let lineup = [...rotation];

    for (let roundIndex = 0; roundIndex < roundCount; roundIndex += 1) {
      const matches = [];
      let byePlayerId = null;

      for (let pairIndex = 0; pairIndex < slotCount / 2; pairIndex += 1) {
        let playerAId = lineup[pairIndex];
        let playerBId = lineup[slotCount - 1 - pairIndex];

        if (!playerAId || !playerBId) {
          byePlayerId = playerAId || playerBId || null;
          continue;
        }

        if ((roundIndex + pairIndex) % 2 === 1) {
          [playerAId, playerBId] = [playerBId, playerAId];
        }

        matches.push({
          id: `league-r${roundIndex + 1}-m${matches.length + 1}`,
          playerAId,
          playerBId,
        });
      }

      rounds.push({
        number: roundIndex + 1,
        matches,
        byePlayerId,
      });

      lineup = [lineup[0], lineup[slotCount - 1], ...lineup.slice(1, slotCount - 1)];
    }

    return {
      id: createId("league"),
      createdAt: new Date().toISOString(),
      playerIds: participantIds,
      rounds,
      results: {},
      inProgress: {},
    };
  }

  function canExpandLeagueIncrementally() {
    if (!state.league || !window.SinucaLeague?.planIncrementalExpansion) return false;
    try {
      window.SinucaLeague.planIncrementalExpansion({
        league: state.league,
        playerIds: state.players.map((player) => player.id),
        newPlayerId: "player-expansion-preview",
      });
      return true;
    } catch (_error) {
      return false;
    }
  }

  async function generateLeague() {
    if (!requireAdmin()) return;
    if (state.players.length < 2) {
      showToast("Cadastre pelo menos dois jogadores.", "error");
      navigate("players");
      return;
    }
    if (state.players.length > MAX_PLAYERS) {
      showToast(`O limite deste projeto é ${MAX_PLAYERS} jogadores.`, "error");
      return;
    }

    if (state.league) {
      const confirmed = await askConfirm(
        "Gerar novamente a liga?",
        "A ordem das rodadas será refeita e todos os placares da liga serão apagados.",
        "Gerar nova tabela",
      );
      if (!confirmed) return;
    }

    state.league = createLeagueSchedule();
    const totalMatches = flattenLeagueMatches().length;
    logActivity(
      "league",
      "Tabela da liga gerada",
      `${state.players.length} jogadores, ${state.league.rounds.length} rodadas e ${totalMatches} partidas`,
    );
    saveState();
    showToast("Liga todos contra todos criada.");
    navigate("league");
  }

  function normalizeLeagueResults() {
    const league = state.league;
    if (!league) return;
    if (!Array.isArray(league.rounds)) {
      state.league = null;
      return;
    }
    league.results = league.results && typeof league.results === "object" ? league.results : {};
    league.inProgress = league.inProgress && typeof league.inProgress === "object" ? league.inProgress : {};
    const validPlayers = new Set(state.players.map((player) => player.id));
    const validMatches = new Map();

    league.rounds.forEach((round, roundIndex) => {
      round.number = Number(round.number) || roundIndex + 1;
      round.matches = Array.isArray(round.matches) ? round.matches : [];
      round.matches.forEach((match) => {
        if (!match || !match.id || !validPlayers.has(match.playerAId) || !validPlayers.has(match.playerBId)) return;
        validMatches.set(match.id, match);
      });
    });

    Object.keys(league.results).forEach((matchId) => {
      const match = validMatches.get(matchId);
      const result = league.results[matchId];
      const valid =
        match &&
        result &&
        result.playerAId === match.playerAId &&
        result.playerBId === match.playerBId &&
        [match.playerAId, match.playerBId].includes(result.winnerId) &&
        Number.isFinite(Number(result.scoreA)) &&
        Number.isFinite(Number(result.scoreB)) &&
        Number(result.scoreA) !== Number(result.scoreB);
      if (!valid) delete league.results[matchId];
      else {
        normalizeResultBallCounts(result);
        if (result.winnerId === result.playerAId) {
          result.scoreA = 1;
          result.scoreB = 0;
        } else {
          result.scoreA = 0;
          result.scoreB = 1;
        }
        delete league.inProgress[matchId];
      }
    });
    Object.keys(league.inProgress).forEach((matchId) => {
      if (!validMatches.has(matchId) || league.results[matchId] || !league.inProgress[matchId]) {
        delete league.inProgress[matchId];
      } else {
        league.inProgress[matchId] = true;
      }
    });
  }

  function flattenLeagueMatches() {
    if (!state.league?.rounds) return [];
    return state.league.rounds.flatMap((round) =>
      round.matches.map((match, matchIndex) => ({
        ...match,
        kind: "league",
        roundNumber: round.number,
        roundName: `Liga · Rodada ${round.number}`,
        matchIndex,
        result: state.league.results?.[match.id] || null,
        inProgress: Boolean(state.league.inProgress?.[match.id]),
        isReady: true,
      })),
    );
  }

  function getLeagueStats() {
    const matches = flattenLeagueMatches();
    const completed = matches.filter((match) => match.result).length;
    const total = matches.length;
    return {
      total,
      completed,
      pending: Math.max(0, total - completed),
      progress: total ? Math.round((completed / total) * 100) : 0,
      isComplete: total > 0 && completed === total,
    };
  }

  function findNextLeagueMatch() {
    const pending = flattenLeagueMatches().filter((match) => !match.result);
    return pending.find((match) => match.inProgress) || pending[0] || null;
  }

  function calculateLeagueStandings() {
    const settings = state.settings.league || createDefaultState().settings.league;
    const rows = new Map(
      state.players.map((player) => [
        player.id,
        {
          id: player.id,
          name: player.name,
          played: 0,
          wins: 0,
          losses: 0,
          scoreFor: 0,
          scoreAgainst: 0,
          differential: 0,
          ballsMade: 0,
          ballsLeft: 0,
          ballBalance: 0,
          points: 0,
          percentage: 0,
          stage: state.league ? "Em disputa" : "Inscrito",
        },
      ]),
    );

    flattenLeagueMatches()
      .filter((match) => match.result)
      .forEach((match) => {
        const result = match.result;
        const playerA = rows.get(match.playerAId);
        const playerB = rows.get(match.playerBId);
        if (!playerA || !playerB) return;

        playerA.played += 1;
        playerB.played += 1;
        playerA.scoreFor += Number(result.scoreA) || 0;
        playerA.scoreAgainst += Number(result.scoreB) || 0;
        playerB.scoreFor += Number(result.scoreB) || 0;
        playerB.scoreAgainst += Number(result.scoreA) || 0;
        const ballsA = Math.min(MAX_BALLS_PER_PLAYER, normalizeBallCount(result.ballsA));
        const ballsB = Math.min(MAX_BALLS_PER_PLAYER, normalizeBallCount(result.ballsB));
        const ballsLeftA = ballsLeftForResult(result, match.playerAId);
        const ballsLeftB = ballsLeftForResult(result, match.playerBId);
        playerA.ballsMade += ballsA;
        playerB.ballsMade += ballsB;
        playerA.ballsLeft += ballsLeftA;
        playerB.ballsLeft += ballsLeftB;
        if (result.winnerId === match.playerAId) {
          playerA.ballBalance += ballsLeftB;
          playerB.ballBalance -= ballsLeftB;
        } else {
          playerA.ballBalance -= ballsLeftA;
          playerB.ballBalance += ballsLeftA;
        }

        const winner = rows.get(result.winnerId);
        const loserId = result.winnerId === match.playerAId ? match.playerBId : match.playerAId;
        const loser = rows.get(loserId);
        if (winner) {
          winner.wins += 1;
          winner.points += Number(settings.winPoints) || 0;
        }
        if (loser) {
          loser.losses += 1;
        }
      });

    rows.forEach((row) => {
      row.differential = row.scoreFor - row.scoreAgainst;
      row.percentage = row.played ? Math.round((row.wins / row.played) * 100) : 0;
    });

    const sorted = [...rows.values()].sort(sortLeagueStandings);
    const stats = getLeagueStats();
    sorted.forEach((row, index) => {
      if (stats.isComplete && index === 0) row.stage = "Campeão da liga";
      else if (index === 0 && row.played > 0) row.stage = "Líder";
      else if (state.league) row.stage = stats.isComplete ? "Classificado" : "Em disputa";
    });
    return sorted;
  }

  function sortLeagueStandings(a, b) {
    return (
      b.points - a.points ||
      b.wins - a.wins ||
      b.ballBalance - a.ballBalance ||
      b.ballsMade - a.ballsMade ||
      a.name.localeCompare(b.name, "pt-BR")
    );
  }

  function renderPublicViewHeader(section, title, description, facts = []) {
    return `
      <header class="public-view-hero">
        <div class="public-view-hero-inner">
          <a class="public-view-back" href="/" data-action="navigate" data-view="dashboard">← Início</a>
          <div>
            <span>${escapeHTML(section)}</span>
            <h1>${escapeHTML(title)}</h1>
            <p>${escapeHTML(description)}</p>
          </div>
          <dl>${facts.map((fact) => `<div><dt>${escapeHTML(fact.label)}</dt><dd>${escapeHTML(fact.value)}</dd></div>`).join("")}</dl>
        </div>
      </header>
    `;
  }

  function renderPublicLeague() {
    const stats = getLeagueStats();
    const standings = calculateLeagueStandings();
    const rounds = state.league?.rounds || [];
    const facts = [
      { label: "Jogadores", value: String(state.players.length) },
      { label: "Progresso", value: state.league ? `${stats.progress}%` : "—" },
      { label: "Partidas", value: state.league ? `${stats.completed}/${stats.total}` : "Aguardando" },
    ];

    if (!state.league) {
      return `<div class="public-view">
        ${renderPublicViewHeader("Liga por pontos", "Todos contra todos.", "A tabela da temporada ainda será aberta pelo administrador.", facts)}
        <section class="public-view-empty">
          <span class="public-brand-ball" aria-hidden="true">8</span>
          <div><h2>A primeira rodada vem aí.</h2><p>Quando a liga for gerada, confrontos, resultados e classificação aparecerão nesta página.</p></div>
          <a class="button button-primary" href="/bolao">Conhecer o bolão</a>
        </section>
      </div>`;
    }

    return `<div class="public-view">
      ${renderPublicViewHeader("Liga por pontos", "A corrida pela liderança.", "Cada rodada recalcula a disputa. Acompanhe pontos, saldo de bolas e todos os confrontos da temporada.", facts)}
      <div class="public-view-content">
        <section class="public-view-section public-league-board" id="public-league-ranking" tabindex="-1">
          <div class="public-block-title"><div><span class="public-overline">Tabela atual</span><h2>Classificação</h2></div><p>Vitória +${Number(state.settings.league.winPoints) || 0} · derrota +0 · desempate pelo saldo de bolas.</p></div>
          ${renderPublicStandings(standings)}
        </section>
        <section class="public-view-section">
          <div class="public-block-title"><div><span class="public-overline">Calendário</span><h2>Rodada por rodada</h2></div><span class="public-live-pill public-live-pill-dark"><i></i>${stats.pending} jogo(s) pendente(s)</span></div>
          <div class="public-round-list">${rounds.map((round, index) => renderPublicLeagueRound(round, index === 0)).join("")}</div>
        </section>
      </div>
      <footer class="public-subpage-footer"><a href="/">← Voltar ao início</a><a href="/bolao">Fazer um palpite →</a></footer>
    </div>`;
  }

  function renderPublicLeagueRound(round, open) {
    const matches = round.matches.map((match) => ({
      ...match,
      roundNumber: round.number,
      result: state.league.results?.[match.id] || null,
      inProgress: Boolean(state.league.inProgress?.[match.id]),
    }));
    const completed = matches.filter((match) => match.result).length;
    return `<details class="public-round" ${open ? "open" : ""}>
      <summary><span>Rodada ${String(round.number).padStart(2, "0")}</span><strong>${completed}/${matches.length} concluídas</strong><i aria-hidden="true">+</i></summary>
      <div>${matches.map((match) => {
        const result = match.result;
        return `<article class="public-round-match">
          <span>${result ? "Final" : match.inProgress ? "Em andamento" : "A jogar"}</span>
          <div><strong>${escapeHTML(playerName(match.playerAId))}</strong><b>${result ? result.scoreA : "—"}</b></div>
          <div><strong>${escapeHTML(playerName(match.playerBId))}</strong><b>${result ? result.scoreB : "—"}</b></div>
          ${result ? `<small>${formatBallSummary(result)}</small>` : `<small>${scoreRuleLabel("league")}</small>`}
        </article>`;
      }).join("")}</div>
    </details>`;
  }

  function renderPublicDraw() {
    const tournamentStats = getTournamentStats();
    const facts = [
      { label: "Formato", value: "Eliminatório" },
      { label: "Jogos concluídos", value: String(tournamentStats.completed) },
      { label: "Progresso", value: `${tournamentStats.progress}%` },
    ];
    if (!state.tournament) {
      return `<div class="public-view">
        ${renderPublicViewHeader("Mata-mata", "Uma chance por rodada.", "A chave eliminatória ainda não foi sorteada. A liga continua disponível normalmente.", facts)}
        <section class="public-view-empty"><span class="public-brand-ball" aria-hidden="true">8</span><div><h2>A chave ainda está fechada.</h2><p>Assim que o sorteio acontecer, todo o caminho até a final ficará disponível aqui.</p></div><button class="button button-primary" data-action="navigate" data-view="league">Acompanhar a liga</button></section>
      </div>`;
    }
    const bracket = buildBracket();
    const finalMatch = bracket.rounds[bracket.rounds.length - 1]?.matches[0];
    return `<div class="public-view">
      ${renderPublicViewHeader("Mata-mata", finalMatch?.winnerId ? `${playerName(finalMatch.winnerId)} levou a copa.` : "O caminho até a final.", "Acompanhe cada avanço da chave eliminatória, da primeira fase à decisão.", facts)}
      <div class="public-view-content">
        <section class="public-view-section public-bracket-section">
          <div class="public-block-title"><div><span class="public-overline">Chave oficial</span><h2>Confrontos</h2></div><p>Arraste horizontalmente em telas menores para ver todas as fases.</p></div>
          <div class="bracket-scroll public-bracket-scroll"><div class="bracket-canvas" style="--round-count:${bracket.rounds.length};--bracket-height:${(bracket.rounds[0]?.matches.length || 1) * BASE_MATCH_GAP + 70}px">${bracket.rounds.map((round) => renderBracketRound(round)).join("")}</div></div>
        </section>
      </div>
      <footer class="public-subpage-footer"><a href="/">← Voltar ao início</a><button data-action="navigate" data-view="ranking">Ver ranking →</button></footer>
    </div>`;
  }

  function renderPublicKnockoutRanking() {
    const rows = calculateRanking();
    const leader = rows[0];
    const facts = [
      { label: "Participantes", value: String(rows.length) },
      { label: "Líder", value: leader ? leader.name : "—" },
      { label: "Pontos do líder", value: leader ? String(leader.points) : "—" },
    ];
    return `<div class="public-view">
      ${renderPublicViewHeader("Ranking mata-mata", "Cada vitória deixa marca.", "Pontuação acumulada no módulo eliminatório, com campanha, saldo e estágio alcançado.", facts)}
      <div class="public-view-content">
        <section class="public-view-section public-ranking-stage">
          <div class="public-block-title"><div><span class="public-overline">Destaques</span><h2>Pódio atual</h2></div><p>${scoreRuleLabel()} · ${state.settings.ranking.win} pontos por vitória.</p></div>
          ${renderPodium(rows.slice(0, 3))}
        </section>
        <section class="public-view-section public-league-board">
          <div class="public-block-title"><div><span class="public-overline">Posições</span><h2>Ranking completo</h2></div></div>
          ${renderPublicStandings(rows)}
        </section>
      </div>
      <footer class="public-subpage-footer"><a href="/">← Voltar ao início</a><button data-action="navigate" data-view="draw">Ver chave →</button></footer>
    </div>`;
  }

  function renderLeague() {
    if (!isAdmin()) return renderPublicLeague();
    const expectedMatches = (state.players.length * (state.players.length - 1)) / 2;
    if (!state.league) {
      return `
        <div class="page-grid dashboard-grid workspace-page league-workspace">
          ${renderWorkspaceHeader("Liga por pontos", "Gere uma temporada em turno único, com todos os participantes se enfrentando.", `${state.players.length} jogadores · ${expectedMatches} partidas previstas`)}
          <section class="card col-12 league-setup-card">
            <div class="hero-content">
              <div>
                <span class="eyebrow">Formato todos contra todos</span>
                <h2>Liga por pontos</h2>
                <p>Cada jogador enfrenta todos os outros uma vez. Com os ${state.players.length} participantes atuais, serão ${expectedMatches} partidas.</p>
                <div class="hero-actions">
                  <button class="button button-primary" data-action="generate-league">Gerar tabela da liga</button>
                </div>
              </div>
              <div class="trophy-orb" aria-hidden="true">●</div>
            </div>
          </section>
          <section class="card col-12">
            <div class="card-header"><div><h2>Como funciona</h2><p>Temporada única e classificação contínua.</p></div></div>
            <div class="card-body rules-summary">
              <div><strong>1</strong><span>Todos jogam contra todos uma vez.</span></div>
              <div><strong>${Number(state.settings.league.winPoints) || 0}</strong><span>Pontos por vitória.</span></div>
              <div><strong>0</strong><span>Empates não são permitidos.</span></div>
              <div><strong>↕</strong><span>Desempate por vitórias, saldo de bolas, bolas matadas e nome.</span></div>
            </div>
          </section>
        </div>
      `;
    }

    const stats = getLeagueStats();
    const rounds = state.league.rounds || [];
    const selectedRound = ui.leagueRoundFilter === "all" ? null : Number(ui.leagueRoundFilter);
    const roundsToRender = selectedRound
      ? rounds.filter((round) => Number(round.number) === selectedRound)
      : rounds;

    return `
      <div class="page-grid dashboard-grid workspace-page league-workspace">
        ${renderWorkspaceHeader("Temporada em andamento", "Filtre as rodadas e registre cada resultado da liga.", `${stats.completed} de ${stats.total} partidas`, `<button class="button button-primary" data-action="navigate" data-view="league-ranking">Ver ranking</button>`)}
        <section class="card col-12 league-summary-card">
          <div class="card-header">
            <div>
              <span class="eyebrow">Todos contra todos · turno único</span>
              <h2>Liga por pontos</h2>
              <p>${state.players.length} jogadores · ${rounds.length} rodadas · ${stats.total} partidas.</p>
            </div>
          </div>
        </section>

        ${renderStatCard("Jogos da liga", stats.total, `${stats.completed} concluído(s)`, "◆", "col-3")}
        ${renderStatCard("Pendentes", stats.pending, "resultados a registrar", "◷", "col-3")}
        ${renderStatCard("Rodadas", rounds.length, "todos contra todos", "↻", "col-3")}
        ${renderStatCard("Progresso", `${stats.progress}%`, "da temporada", "↗", "col-3", stats.progress)}

        <section class="card col-12">
          <div class="card-header">
            <div><h2>Rodadas e partidas</h2><p>Registre os resultados conforme os jogos forem acontecendo.</p></div>
          </div>
          <div class="card-body">
            <div class="toolbar league-toolbar">
              <div class="toolbar-group">
                <label class="field">
                  <span>Rodada</span>
                  <select id="league-round-filter">
                    <option value="all" ${ui.leagueRoundFilter === "all" ? "selected" : ""}>Todas as rodadas</option>
                    ${rounds.map((round) => `<option value="${round.number}" ${String(round.number) === ui.leagueRoundFilter ? "selected" : ""}>Rodada ${round.number}</option>`).join("")}
                  </select>
                </label>
                <label class="field">
                  <span>Status</span>
                  <select id="league-match-filter">
                    <option value="all" ${ui.leagueMatchFilter === "all" ? "selected" : ""}>Todas</option>
                    <option value="pending" ${ui.leagueMatchFilter === "pending" ? "selected" : ""}>Pendentes</option>
                    <option value="completed" ${ui.leagueMatchFilter === "completed" ? "selected" : ""}>Concluídas</option>
                  </select>
                </label>
              </div>
            </div>
          </div>
          <div class="league-rounds">
            ${roundsToRender.map((round) => renderLeagueRound(round)).join("") || '<div class="empty-state"><p>Nenhuma rodada encontrada.</p></div>'}
          </div>
        </section>
      </div>
    `;
  }

  function renderLeagueRanking() {
    if (!isAdmin()) return renderPublicLeague();
    if (!state.league) {
      return `
        <div class="page-grid dashboard-grid workspace-page league-ranking-workspace">
          ${renderWorkspaceHeader("Ranking da liga", "A classificação aparecerá depois que a tabela da liga for criada.", `${state.players.length} jogadores`, `<button class="button button-primary" data-action="navigate" data-view="league">Abrir liga por pontos</button>`)}
          <section class="card col-12">
            <div class="empty-state">
              <div class="empty-state-icon">↕</div>
              <h3>Ranking ainda não disponível</h3>
              <p>Gere a liga para começar a acompanhar pontos, vitórias e saldo de bolas.</p>
              <button class="button button-primary" data-action="navigate" data-view="league">Ir para a liga</button>
            </div>
          </section>
        </div>
      `;
    }

    const stats = getLeagueStats();
    const standings = calculateLeagueStandings();
    return `
      <div class="page-grid dashboard-grid workspace-page league-ranking-workspace">
        ${renderWorkspaceHeader("Ranking da liga", "Acompanhe a classificação completa e os critérios de desempate.", `${stats.completed} de ${stats.total} partidas concluídas`, `<button class="button button-ghost" data-action="navigate" data-view="league">Ver partidas</button>`)}
        <section class="card col-12">
          <div class="card-header">
            <div>
              <h2>Classificação</h2>
              <p>${Number(state.settings.league.winPoints) || 0} pontos por vitória · desempate por vitórias, saldo de bolas e bolas matadas.</p>
            </div>
          </div>
          <div class="table-wrap mt-20">
            ${renderLeagueStandingsTable(standings)}
          </div>
        </section>
      </div>
    `;
  }

  function renderLeagueStandingsTable(rows) {
    return `
      <table class="league-table">
        <thead>
          <tr>
            <th>Pos.</th>
            <th>Jogador</th>
            <th>Pts</th>
            <th>J</th>
            <th>V</th>
            <th>D</th>
            <th>Matadas</th>
            <th>Na mesa</th>
            <th>Saldo</th>
            <th>Aprov.</th>
            <th>Situação</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row, index) => `
            <tr>
              <td><span class="ranking-position pos-${index + 1}">${index + 1}</span></td>
              <td><div class="player-cell"><span class="avatar ${index === 0 ? "gold" : ""}">${escapeHTML(getInitials(row.name))}</span><strong>${escapeHTML(row.name)}</strong></div></td>
              <td><strong>${row.points}</strong></td>
              <td>${row.played}</td>
              <td>${row.wins}</td>
              <td>${row.losses}</td>
              <td><strong>${row.ballsMade}</strong></td>
              <td>${row.ballsLeft}</td>
              <td><strong>${row.ballBalance > 0 ? "+" : ""}${row.ballBalance}</strong></td>
              <td>${row.percentage}%</td>
              <td><span class="badge ${row.stage === "Campeão da liga" ? "badge-gold" : row.stage === "Líder" ? "badge-green" : ""}">${escapeHTML(row.stage)}</span></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  }

  function renderLeagueRound(round) {
    let matches = round.matches.map((match) => ({
      ...match,
      kind: "league",
      roundNumber: round.number,
      roundName: `Liga · Rodada ${round.number}`,
      result: state.league.results?.[match.id] || null,
      inProgress: Boolean(state.league.inProgress?.[match.id]),
    }));
    if (ui.leagueMatchFilter === "pending") matches = matches.filter((match) => !match.result);
    if (ui.leagueMatchFilter === "completed") matches = matches.filter((match) => Boolean(match.result));

    return `
      <section class="league-round">
        <div class="league-round-header">
          <div><span class="eyebrow">Rodada ${round.number}</span><strong>${round.matches.length} partida(s)</strong></div>
          ${round.byePlayerId ? `<span class="badge">Folga: ${escapeHTML(playerName(round.byePlayerId))}</span>` : ""}
        </div>
        <div class="match-list">
          ${matches.length ? matches.map((match) => renderLeagueMatchRow(match)).join("") : '<div class="league-filter-empty">Nenhuma partida neste filtro.</div>'}
        </div>
      </section>
    `;
  }

  function renderLeagueMatchRow(match) {
    const result = match.result;
    const status = result
      ? '<span class="badge badge-green">Concluída</span>'
      : match.inProgress
        ? '<span class="badge badge-live"><i></i> Em andamento</span>'
        : '<span class="badge badge-gold">Pendente</span>';
    return `
      <article class="match-row league-match-row">
        <div class="match-meta"><strong>Rodada ${match.roundNumber}</strong><br>${status}</div>
        <div class="match-versus">
          <strong class="left">${escapeHTML(playerName(match.playerAId))}</strong>
          <span class="match-result-summary">
            <span class="result-score">${result ? `${result.scoreA} × ${result.scoreB}` : "×"}</span>
            ${result ? `<small>${formatBallSummary(result)}</small>` : ""}
          </span>
          <strong>${escapeHTML(playerName(match.playerBId))}</strong>
        </div>
        <div class="match-row-actions">
          ${result ? "" : `<button class="button button-small ${match.inProgress ? "button-live" : "button-ghost"}" data-action="toggle-match-live" data-match-id="${match.id}">${match.inProgress ? "Encerrar andamento" : "Iniciar partida"}</button>`}
          <button class="button button-small button-primary" data-action="open-score" data-match-id="${match.id}" data-match-kind="league">${result ? "Editar" : "Placar"}</button>
        </div>
        ${result ? `<div class="match-audit">Atualizado por ${escapeHTML(result.updatedBy || "Administrador")} · ${escapeHTML(formatDateTime(result.updatedAt || result.playedAt))}</div>` : `<form class="quick-score-form" data-match-id="${match.id}">
          <label><span>Vencedor</span><select name="winner" required><option value="">Selecione</option><option value="${match.playerAId}">${escapeHTML(playerName(match.playerAId))}</option><option value="${match.playerBId}">${escapeHTML(playerName(match.playerBId))}</option></select></label>
          <label><span>Bolas ${escapeHTML(playerName(match.playerAId))}</span><input name="ballsA" type="number" min="0" max="8" required inputmode="numeric"></label>
          <label><span>Bolas ${escapeHTML(playerName(match.playerBId))}</span><input name="ballsB" type="number" min="0" max="8" required inputmode="numeric"></label>
          <button class="button button-small button-primary" type="submit">Salvar rápido</button>
        </form>`}
      </article>
    `;
  }

  function nextPowerOfTwo(value) {
    if (value <= 2) return 2;
    return 2 ** Math.ceil(Math.log2(value));
  }

  function randomInt(maxExclusive) {
    if (maxExclusive <= 1) return 0;
    if (window.crypto?.getRandomValues) {
      const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive;
      const array = new Uint32Array(1);
      do {
        window.crypto.getRandomValues(array);
      } while (array[0] >= limit);
      return array[0] % maxExclusive;
    }
    return Math.floor(Math.random() * maxExclusive);
  }

  function secureShuffle(items) {
    const copy = [...items];
    for (let index = copy.length - 1; index > 0; index -= 1) {
      const randomIndex = randomInt(index + 1);
      [copy[index], copy[randomIndex]] = [copy[randomIndex], copy[index]];
    }
    return copy;
  }

  function buildBalancedRandomSeeds(playerIds) {
    const shuffledPlayers = secureShuffle(playerIds);
    const bracketSize = nextPowerOfTwo(shuffledPlayers.length);
    const matchCount = bracketSize / 2;
    const matchIndexes = secureShuffle(
      Array.from({ length: matchCount }, (_, index) => index),
    );
    const seeds = Array(bracketSize).fill(null);

    const firstWave = shuffledPlayers.slice(0, matchCount);
    firstWave.forEach((playerId, index) => {
      const matchIndex = matchIndexes[index];
      const side = randomInt(2);
      seeds[matchIndex * 2 + side] = playerId;
    });

    const remaining = shuffledPlayers.slice(matchCount);
    const occupiedMatches = secureShuffle(matchIndexes).slice(0, remaining.length);
    remaining.forEach((playerId, index) => {
      const matchIndex = occupiedMatches[index];
      const firstSlot = matchIndex * 2;
      const openSlot = seeds[firstSlot] ? firstSlot + 1 : firstSlot;
      seeds[openSlot] = playerId;
    });

    return { seeds, bracketSize };
  }

  function createTournament() {
    const { seeds, bracketSize } = buildBalancedRandomSeeds(
      state.players.map((player) => player.id),
    );
    return {
      id: createId("tournament"),
      createdAt: new Date().toISOString(),
      bracketSize,
      seeds,
      results: {},
      thirdPlaceResult: null,
    };
  }

  async function generateDraw() {
    if (!requireAdmin()) return;
    if (state.players.length < 2) {
      showToast("Cadastre pelo menos dois jogadores.", "error");
      navigate("players");
      return;
    }
    if (state.players.length > MAX_PLAYERS) {
      showToast(`O limite deste projeto é ${MAX_PLAYERS} jogadores.`, "error");
      return;
    }

    if (state.tournament) {
      const confirmed = await askConfirm(
        "Refazer o sorteio?",
        "Todos os placares atuais serão apagados e uma nova chave será criada.",
        "Sortear novamente",
      );
      if (!confirmed) return;
    }

    state.tournament = createTournament();
    const byes = state.tournament.bracketSize - state.players.length;
    logActivity(
      "draw",
      "Chave sorteada",
      `${state.players.length} jogadores e ${byes} avanço(s) automático(s)`,
    );
    saveState();
    showToast("Sorteio concluído.");
    navigate("draw");
  }

  function getRoundCount() {
    return state.tournament ? Math.log2(state.tournament.bracketSize) : 0;
  }

  function getRoundName(matchCount) {
    const names = {
      1: "Final",
      2: "Semifinais",
      4: "Quartas de final",
      8: "Oitavas de final",
      16: "Primeira fase",
    };
    return names[matchCount] || `Rodada de ${matchCount * 2}`;
  }

  function getRoundShort(matchCount) {
    const names = {
      1: "Final",
      2: "Semi",
      4: "Quartas",
      8: "Oitavas",
      16: "1ª fase",
    };
    return names[matchCount] || `R${matchCount * 2}`;
  }

  function buildBracket() {
    const tournament = state.tournament;
    if (!tournament) return { rounds: [], thirdPlace: null };

    const rounds = [];
    const roundCount = Math.log2(tournament.bracketSize);
    let previousRound = null;

    for (let roundIndex = 0; roundIndex < roundCount; roundIndex += 1) {
      const matchCount = tournament.bracketSize / 2 ** (roundIndex + 1);
      const round = {
        index: roundIndex,
        name: getRoundName(matchCount),
        shortName: getRoundShort(matchCount),
        matchCount,
        matches: [],
      };

      for (let matchIndex = 0; matchIndex < matchCount; matchIndex += 1) {
        const id = `r${roundIndex}m${matchIndex}`;
        let playerAId = null;
        let playerBId = null;

        if (roundIndex === 0) {
          playerAId = tournament.seeds[matchIndex * 2] || null;
          playerBId = tournament.seeds[matchIndex * 2 + 1] || null;
        } else {
          playerAId = previousRound.matches[matchIndex * 2]?.winnerId || null;
          playerBId = previousRound.matches[matchIndex * 2 + 1]?.winnerId || null;
        }

        const saved = tournament.results[id] || null;
        const hasTwoPlayers = Boolean(playerAId && playerBId);
        // Folga só existe na primeira rodada. Nas demais, um lado vazio
        // normalmente significa que a partida alimentadora ainda não terminou.
        const isBye =
          roundIndex === 0 && Boolean(playerAId) !== Boolean(playerBId);
        const isEmpty = !playerAId && !playerBId;
        let winnerId = null;
        let automatic = false;
        let result = null;

        if (isBye) {
          winnerId = playerAId || playerBId;
          automatic = true;
        } else if (hasTwoPlayers && saved) {
          const sameParticipants =
            saved.playerAId === playerAId && saved.playerBId === playerBId;
          const validWinner = [playerAId, playerBId].includes(saved.winnerId);
          if (sameParticipants && validWinner) {
            winnerId = saved.winnerId;
            result = saved;
          }
        }

        const loserId =
          result && winnerId
            ? winnerId === playerAId
              ? playerBId
              : playerAId
            : null;

        round.matches.push({
          id,
          roundIndex,
          matchIndex,
          roundName: round.name,
          playerAId,
          playerBId,
          winnerId,
          loserId,
          result,
          automatic,
          isBye,
          isEmpty,
          isReady: hasTwoPlayers && !result,
          isComplete: Boolean(winnerId),
        });
      }

      rounds.push(round);
      previousRound = round;
    }

    let thirdPlace = null;
    if (state.settings.thirdPlace && rounds.length >= 2) {
      const semifinals = rounds[rounds.length - 2];
      const playerAId = semifinals.matches[0]?.loserId || null;
      const playerBId = semifinals.matches[1]?.loserId || null;
      const saved = tournament.thirdPlaceResult;
      const hasPlayers = Boolean(playerAId && playerBId);
      const validSaved =
        saved &&
        saved.playerAId === playerAId &&
        saved.playerBId === playerBId &&
        [playerAId, playerBId].includes(saved.winnerId);
      thirdPlace = {
        id: "third-place",
        roundName: "Disputa de 3º lugar",
        playerAId,
        playerBId,
        winnerId: validSaved ? saved.winnerId : null,
        loserId:
          validSaved && saved.winnerId
            ? saved.winnerId === playerAId
              ? playerBId
              : playerAId
            : null,
        result: validSaved ? saved : null,
        isReady: hasPlayers && !validSaved,
        isComplete: Boolean(validSaved),
      };
    }

    return { rounds, thirdPlace };
  }

  function normalizeTournamentResults() {
    const tournament = state.tournament;
    if (!tournament) return;
    tournament.results = tournament.results || {};
    Object.values(tournament.results).forEach(normalizeResultBallCounts);
    normalizeResultBallCounts(tournament.thirdPlaceResult);

    const maxPasses = Math.log2(tournament.bracketSize || 2) + 2;
    for (let pass = 0; pass < maxPasses; pass += 1) {
      const bracket = buildBracket();
      const validMatchIds = new Set();
      let changed = false;

      bracket.rounds.forEach((round) => {
        round.matches.forEach((match) => {
          validMatchIds.add(match.id);
          if (tournament.results[match.id] && !match.result) {
            delete tournament.results[match.id];
            changed = true;
          }
        });
      });

      Object.keys(tournament.results).forEach((id) => {
        if (!validMatchIds.has(id)) {
          delete tournament.results[id];
          changed = true;
        }
      });

      if (!changed) break;
    }

    const refreshed = buildBracket();
    const third = refreshed.thirdPlace;
    const savedThird = tournament.thirdPlaceResult;
    if (savedThird) {
      const valid =
        third &&
        savedThird.playerAId === third.playerAId &&
        savedThird.playerBId === third.playerBId &&
        [third.playerAId, third.playerBId].includes(savedThird.winnerId);
      if (!valid) tournament.thirdPlaceResult = null;
    }
  }

  function getTournamentStats() {
    const bracket = buildBracket();
    const completed = flattenMatches().filter((match) => match.result).length;
    const thirdPlaceMatch = state.settings.thirdPlace && state.players.length >= 4 ? 1 : 0;
    const total = state.tournament
      ? Math.max(0, state.players.length - 1) + thirdPlaceMatch
      : 0;
    const pending = Math.max(0, total - completed);
    const finalMatch = bracket.rounds[bracket.rounds.length - 1]?.matches[0] || null;
    return {
      total,
      completed,
      pending,
      progress: total ? Math.round((completed / total) * 100) : 0,
      championId: finalMatch?.winnerId || null,
      finalComplete: Boolean(finalMatch?.result),
    };
  }

  function renderDashboard() {
    return isAdmin() ? renderAdminDashboard() : renderPublicDashboard();
  }

  function renderPublicDashboard() {
    const leagueStats = getLeagueStats();
    const standings = calculateLeagueStandings();
    const pendingMatches = flattenLeagueMatches().filter((match) => !match.result).slice(0, 3);
    const leader = standings[0] || null;
    const title = escapeHTML(state.settings.title || "Sinuca da Firma");
    const statusLabel = leagueStats.isComplete
      ? "Temporada concluída"
      : state.league
        ? `Liga em andamento · ${leagueStats.progress}%`
        : "Nova temporada";

    return `
      <div class="public-home">
        <section class="public-hero" aria-labelledby="public-hero-title">
          <div class="public-hero-shade"></div>
          <div class="public-hero-copy">
            <span class="public-kicker"><i aria-hidden="true"></i>${escapeHTML(statusLabel)}</span>
            <h1 id="public-hero-title">O campeonato<br>acontece <em>aqui.</em></h1>
            <p>${title} reúne cada confronto, cada ponto e a disputa pela liderança em um só lugar.</p>
            <div class="public-hero-actions">
              <button class="button public-button-light" data-action="navigate" data-view="league">Acompanhar a liga <span aria-hidden="true">↗</span></button>
              <a class="public-text-link" href="/bolao">Entrar no bolão <span aria-hidden="true">→</span></a>
            </div>
          </div>
          <div class="public-hero-meta" aria-label="Resumo do campeonato">
            <span><strong>${state.players.length}</strong> jogadores</span>
            <span><strong>${state.league ? leagueStats.completed : 0}</strong> partidas realizadas</span>
            <span><strong>${leader && leader.played ? escapeHTML(leader.name) : "—"}</strong> ${leagueStats.isComplete ? "campeão" : "líder atual"}</span>
          </div>
          <a class="public-scroll-cue" href="#panorama"><span>Role para acompanhar</span><i aria-hidden="true"></i></a>
        </section>

        <section class="public-panorama" id="panorama">
          <div class="public-section-heading reveal">
            <span class="public-kicker public-kicker-dark">Panorama da liga</span>
            <h2>A mesa muda<br>a cada rodada.</h2>
            <p>Classificação, ritmo da competição e próximos confrontos atualizados com os dados reais do campeonato.</p>
          </div>

          <div class="public-progress-card reveal">
            <div class="public-progress-ring" style="--progress:${leagueStats.progress}">
              <span><strong>${state.league ? leagueStats.progress : 0}%</strong> concluído</span>
            </div>
            <div class="public-progress-copy">
              <span class="public-overline">Ritmo da temporada</span>
              <h3>${state.league ? `${leagueStats.completed} de ${leagueStats.total} jogos já decididos` : "A tabela ainda será aberta"}</h3>
              <p>${state.league ? `${leagueStats.pending} confronto(s) ainda podem mudar a classificação.` : "Assim que o administrador gerar a liga, o calendário aparece aqui."}</p>
              <button class="public-inline-action" data-action="navigate" data-view="league">Ver tabela completa <span>→</span></button>
            </div>
          </div>

          <section class="public-standings reveal" aria-labelledby="standings-title">
            <div class="public-block-title">
              <div><span class="public-overline">Classificação</span><h2 id="standings-title">Quem está na frente</h2></div>
              <button data-action="navigate" data-view="league">Tabela completa <span aria-hidden="true">↗</span></button>
            </div>
            ${renderPublicStandings(standings.slice(0, 5))}
          </section>

          <section class="public-upcoming reveal" aria-labelledby="upcoming-title">
            <div class="public-block-title public-block-title-light">
              <div><span class="public-overline">Na sequência</span><h2 id="upcoming-title">Próximas partidas</h2></div>
              <span class="public-live-pill"><i></i>${state.league ? "Tabela atualizada" : "Aguardando tabela"}</span>
            </div>
            <div class="public-match-list">${renderPublicMatches(pendingMatches)}</div>
          </section>

          <section class="public-story reveal" aria-label="Jornada do campeonato">
            <div class="public-story-line" aria-hidden="true"><span></span><i>8</i></div>
            <div><span>01</span><strong>A tabela abre</strong><p>Todos se enfrentam. Cada partida começa uma nova possibilidade.</p></div>
            <div><span>02</span><strong>A liderança muda</strong><p>Pontos, vitórias e saldo de bolas revelam quem chega mais forte.</p></div>
            <div><span>03</span><strong>A última bola decide</strong><p>No fim, a história da temporada fica registrada aqui.</p></div>
          </section>

          <section class="public-pool-cta reveal">
            <div><span class="public-kicker">Palpite também entra em jogo</span><h2>Tem ficha virtual<br>na mesa.</h2></div>
            <div><p>Escolha um confronto, confie no seu favorito e acompanhe o ranking do bolão sem gastar nada.</p><a class="button public-button-light" href="/bolao">Abrir o bolão <span aria-hidden="true">↗</span></a></div>
          </section>
        </section>

        <footer class="public-footer">
          <span class="public-brand-ball" aria-hidden="true">8</span>
          <p>${title} · feito para a resenha, organizado como campeonato.</p>
          <a href="/login">Acesso administrativo</a>
        </footer>
      </div>
    `;
  }

  function renderPublicStandings(rows) {
    if (!rows.length) return `<p class="public-empty">Os jogadores aparecerão aqui assim que forem cadastrados.</p>`;
    return `<ol class="public-ranking-list">${rows.map((row, index) => `
      <li>
        <span class="public-rank-number">${String(index + 1).padStart(2, "0")}</span>
        <span class="avatar">${escapeHTML(getInitials(row.name))}</span>
        <span class="public-rank-player"><strong>${escapeHTML(row.name)}</strong><small>${escapeHTML(row.stage)}</small></span>
        <span><strong>${row.wins}</strong><small>vitórias</small></span>
        <span><strong>${row.ballsMade}</strong><small>matadas</small></span>
        <span><strong>${row.ballsLeft}</strong><small>na mesa</small></span>
        <span class="public-rank-balls"><strong>${row.ballBalance > 0 ? "+" : ""}${row.ballBalance}</strong><small>saldo</small></span>
        <span class="public-rank-points"><strong>${row.points}</strong><small>pontos</small></span>
      </li>`).join("")}</ol>`;
  }

  function renderPublicMatches(matches) {
    if (!state.league) return `<div class="public-match-empty"><span>8</span><div><strong>A primeira rodada vem aí.</strong><p>O calendário aparece aqui quando a liga for gerada.</p></div></div>`;
    if (!matches.length) return `<div class="public-match-empty"><span>✓</span><div><strong>Todas as partidas foram concluídas.</strong><p>Confira a classificação final da temporada.</p></div></div>`;
    return matches.map((match) => `
      <article class="public-match-row">
        <span class="public-match-round">Rodada ${match.roundNumber}</span>
        <div><strong>${escapeHTML(playerName(match.playerAId))}</strong><span class="avatar">${escapeHTML(getInitials(playerName(match.playerAId)))}</span></div>
        <b>×</b>
        <div><span class="avatar">${escapeHTML(getInitials(playerName(match.playerBId)))}</span><strong>${escapeHTML(playerName(match.playerBId))}</strong></div>
        <span class="public-match-status ${match.inProgress ? "is-live" : ""}">${match.inProgress ? "Em andamento" : "A jogar"}</span>
      </article>`).join("");
  }

  function setupPublicMotion() {
    if (isAdmin() || !dom.content.querySelector(".public-home")) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const items = dom.content.querySelectorAll(".reveal");
    if (reducedMotion || !("IntersectionObserver" in window)) {
      items.forEach((item) => item.classList.add("is-visible"));
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.14, rootMargin: "0px 0px -8%" });
    items.forEach((item) => observer.observe(item));
  }

  function renderAdminDashboard() {
    const leagueStats = getLeagueStats();
    const standings = calculateLeagueStandings();
    const nextMatch = findNextLeagueMatch();
    const title = escapeHTML(state.settings.title || "Sinuca da Firma");
    const champion = leagueStats.isComplete ? standings[0] : null;

    let heroTitle = "Liga todos contra todos";
    let heroText = `Gere a tabela para que os ${state.players.length} jogadores se enfrentem uma vez cada.`;
    let heroButton = `<button class="button button-primary" data-action="generate-league">Gerar liga</button>`;

    if (champion) {
      heroTitle = `${escapeHTML(champion.name)} é o campeão da liga!`;
      heroText = "Todas as partidas foram concluídas e a classificação final está disponível.";
      heroButton = `<button class="button button-primary" data-action="navigate" data-view="league-ranking">Ver classificação final</button>`;
    } else if (state.league) {
      heroTitle = nextMatch ? "Liga em andamento" : "Tabela da liga preparada";
      heroText = nextMatch
        ? `Próximo confronto pendente: ${escapeHTML(playerName(nextMatch.playerAId))} contra ${escapeHTML(playerName(nextMatch.playerBId))}.`
        : "Acompanhe as rodadas e registre os resultados da temporada.";
      heroButton = `<button class="button button-primary" data-action="navigate" data-view="league">Abrir liga</button>`;
    }

    return `
      <div class="page-grid dashboard-grid workspace-page admin-dashboard-workspace">
        ${renderWorkspaceHeader("Sala de controle", "Acompanhe o campeonato e chegue rapidamente às ações que precisam de atenção.", `Revisão ${serverRevision} · ${state.players.length} jogadores`, `<button class="button button-primary" data-action="navigate" data-view="league">Abrir liga</button>`)}
        <section class="card col-12 admin-season-brief">
          <div class="hero-content">
            <div>
              <span class="eyebrow">${title}</span>
              <h2>${heroTitle}</h2>
              <p>${heroText}</p>
              <div class="hero-actions">
                ${heroButton}
              </div>
            </div>
            <div class="trophy-orb" aria-hidden="true">🏆</div>
          </div>
        </section>

        ${renderStatCard("Jogadores", state.players.length, "inscritos", "♟", "col-3")}
        ${renderStatCard("Jogos da liga", state.league ? leagueStats.total : "—", state.league ? `${leagueStats.completed} concluído(s)` : "tabela não gerada", "◆", "col-3")}
        ${renderStatCard("Pendentes", state.league ? leagueStats.pending : "—", state.league ? "resultados a registrar" : "aguardando liga", "◷", "col-3")}
        ${renderStatCard("Progresso", state.league ? `${leagueStats.progress}%` : "0%", "da liga", "↗", "col-3", leagueStats.progress)}

        <section class="card col-7">
          <div class="card-header"><div><h2>Próxima partida da liga</h2><p>Primeiro confronto ainda sem resultado.</p></div></div>
          <div class="card-body">${renderNextLeagueMatch(nextMatch)}</div>
        </section>

        <section class="card col-5">
          <div class="card-header">
            <div><h2>Classificação da liga</h2><p>Pontos, vitórias e saldo de bolas.</p></div>
            <button class="button button-small button-ghost" data-action="navigate" data-view="league-ranking">Ver ranking</button>
          </div>
          <div class="card-body">${renderRankingPreview(standings.slice(0, 5))}</div>
        </section>

        <section class="card col-12">
          <div class="card-header"><div><h2>Atividade recente</h2><p>Tabelas, sorteios, cadastros e resultados.</p></div></div>
          <div class="card-body">${renderActivity()}</div>
        </section>
      </div>
    `;
  }

  function renderStatCard(label, value, caption, icon, column, progress = null) {
    return `
      <section class="card stat-card ${column}">
        <div class="stat-label">
          <span>${escapeHTML(label)}</span>
          <span class="stat-icon" aria-hidden="true">${icon}</span>
        </div>
        <strong class="stat-value">${escapeHTML(value)}</strong>
        <span class="stat-caption">${escapeHTML(caption)}</span>
        ${
          progress === null
            ? ""
            : `<div class="progress-track"><span style="width:${Math.max(0, Math.min(100, progress))}%"></span></div>`
        }
      </section>
    `;
  }

  function renderNextLeagueMatch(match) {
    if (!state.league) {
      return `
        <div class="empty-state">
          <div class="empty-state-icon">↻</div>
          <h3>A liga ainda não foi gerada</h3>
          <p>O sistema distribuirá todos os confrontos em rodadas, sem eliminar ninguém.</p>
          <button class="button button-primary" data-action="generate-league">Gerar liga agora</button>
        </div>
      `;
    }

    if (!match) {
      const standings = calculateLeagueStandings();
      const stats = getLeagueStats();
      return `
        <div class="empty-state">
          <div class="empty-state-icon">${stats.isComplete ? "🏆" : "✓"}</div>
          <h3>${stats.isComplete ? "Liga concluída" : "Nenhuma partida pendente"}</h3>
          <p>${stats.isComplete && standings[0] ? `Campeão: ${escapeHTML(standings[0].name)}.` : "Consulte a tabela completa da liga."}</p>
          <button class="button button-ghost" data-action="navigate" data-view="league">Ver liga</button>
        </div>
      `;
    }

    return `
      <div class="compact-match">
        <div class="compact-player"><span class="avatar">${escapeHTML(getInitials(playerName(match.playerAId)))}</span><strong>${escapeHTML(playerName(match.playerAId))}</strong></div>
        <span class="versus">CONTRA</span>
        <div class="compact-player"><strong>${escapeHTML(playerName(match.playerBId))}</strong><span class="avatar">${escapeHTML(getInitials(playerName(match.playerBId)))}</span></div>
        <button class="button button-primary" data-action="open-score" data-match-id="${match.id}" data-match-kind="league">Registrar placar</button>
      </div>
      <div class="notice mt-20"><span aria-hidden="true">●</span><span><strong>Rodada ${match.roundNumber}${match.inProgress ? " · Em andamento" : ""}</strong> · ${scoreRuleLabel("league")}</span></div>
    `;
  }

  function renderRankingPreview(rows) {
    if (!rows.length) {
      return `<p class="text-muted m-0">Nenhum jogador cadastrado.</p>`;
    }
    return `
      <ul class="list-clean activity-list">
        ${rows
          .map(
            (row, index) => `
              <li class="activity-item">
                <span class="ranking-position pos-${index + 1}">${index + 1}</span>
                <div>
                  <strong>${escapeHTML(row.name)}</strong>
                  <span>${row.wins} vitória(s) · saldo ${row.ballBalance > 0 ? "+" : ""}${row.ballBalance} · ${escapeHTML(row.stage)}</span>
                </div>
                <strong>${row.points} pts</strong>
              </li>
            `,
          )
          .join("")}
      </ul>
    `;
  }

  function renderActivity() {
    const items = state.activity.filter(
      (item) => item.type !== "draw" && !/mata-mata|chave eliminatória/i.test(`${item.text} ${item.detail || ""}`),
    );
    items.sort((a, b) => new Date(b.at) - new Date(a.at));

    if (!items.length) {
      return `<p class="text-muted m-0">Nenhuma atividade registrada.</p>`;
    }

    const icons = {
      setup: "⚙",
      league: "↻",
      draw: "⤨",
      player: "♟",
      score: "◆",
      settings: "✓",
      import: "⇩",
    };

    return `
      <ul class="list-clean activity-list">
        ${items
          .slice(0, 8)
          .map(
            (item) => `
              <li class="activity-item">
                <span class="activity-icon">${icons[item.type] || "•"}</span>
                <div>
                  <strong>${escapeHTML(item.text)}</strong>
                  <span>${escapeHTML(item.detail || "")}</span>
                </div>
                <time datetime="${escapeHTML(item.at)}" title="${escapeHTML(formatDateTime(item.at))}">${escapeHTML(formatRelativeTime(item.at))}</time>
              </li>
            `,
          )
          .join("")}
      </ul>
    `;
  }

  function renderWorkspaceHeader(title, description, context, actions = "") {
    return `<section class="workspace-header col-12">
      <div><span>${escapeHTML(context)}</span><h2>${escapeHTML(title)}</h2><p>${escapeHTML(description)}</p></div>
      ${actions ? `<div class="workspace-header-actions">${actions}</div>` : ""}
    </section>`;
  }

  function renderPlayers() {
    const query = ui.playerSearch.trim().toLocaleLowerCase("pt-BR");
    const filtered = state.players.filter((player) =>
      player.name.toLocaleLowerCase("pt-BR").includes(query),
    );
    const incrementalExpansionAvailable = canExpandLeagueIncrementally();
    const additionBlocked = Boolean(state.league) && !incrementalExpansionAvailable;

    return `
      <div class="page-grid dashboard-grid workspace-page players-workspace">
        ${renderWorkspaceHeader("Elenco do campeonato", "Cadastre e acompanhe os participantes da liga.", `${state.players.length} de ${MAX_PLAYERS} vagas`, `<button class="button button-primary" data-action="generate-league" ${state.players.length < 2 ? "disabled" : ""}>Gerar liga</button>`)}
        <section class="card col-4">
          <div class="card-header">
            <div>
              <h2>Novo jogador</h2>
              <p>Adicione um participante à lista.</p>
            </div>
          </div>
          <div class="card-body">
            <form id="add-player-form" class="field">
              <label for="new-player-name">Nome</label>
              <input id="new-player-name" name="name" maxlength="60" autocomplete="off" placeholder="Ex.: Danilo" ${additionBlocked ? "disabled" : ""} required>
              <span class="field-help">${incrementalExpansionAvailable ? "O novo jogador enfrentará todos os participantes atuais. O sistema aproveita espaços livres e cria rodadas retroativas quando necessário." : additionBlocked ? "A tabela atual precisa ser revisada antes de receber outro jogador." : `Máximo de ${MAX_PLAYERS} participantes.`}</span>
              <button class="button button-primary mt-12" type="submit" ${additionBlocked ? "disabled" : ""}>${state.league ? "Adicionar à liga" : "Adicionar jogador"}</button>
            </form>
          </div>
        </section>

        <section class="card col-8">
          <div class="card-header">
            <div>
              <h2>Participantes</h2>
              <p>${state.players.length} jogador(es) cadastrado(s).</p>
            </div>
          </div>
          <div class="card-body">
            <div class="toolbar">
              <div class="search-box">
                <input class="search-input" id="player-search" value="${escapeHTML(ui.playerSearch)}" placeholder="Buscar jogador" aria-label="Buscar jogador">
              </div>
              <button class="button button-primary" data-action="generate-league" ${state.players.length < 2 ? "disabled" : ""}>Gerar liga</button>
            </div>
          </div>
          <div class="table-wrap">
            ${renderPlayersTable(filtered)}
          </div>
        </section>

        <section class="card col-12">
          <div class="card-body">
            <div class="notice ${state.league ? "notice-warning" : ""}">
              <span aria-hidden="true">${state.league ? "!" : "i"}</span>
              <span>${
                state.league
                  ? "A liga está em andamento. Use o fluxo de inclusão segura para preservar confrontos e resultados existentes."
                  : `Na liga, todos se enfrentam uma vez (${(state.players.length * (state.players.length - 1)) / 2} partidas com a lista atual).`
              }</span>
            </div>
          </div>
        </section>
      </div>
    `;
  }

  function renderPlayersTable(players) {
    if (!players.length) {
      return `
        <div class="empty-state">
          <div class="empty-state-icon">⌕</div>
          <h3>Nenhum jogador encontrado</h3>
          <p>Altere a busca ou cadastre um novo participante.</p>
        </div>
      `;
    }

    return `
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Jogador</th>
            <th>Cadastro</th>
            <th>Status</th>
            <th class="text-center">Ações</th>
          </tr>
        </thead>
        <tbody>
          ${players
            .map((player) => {
              const originalIndex = state.players.findIndex((item) => item.id === player.id);
              const editing = ui.editingPlayerId === player.id;
              return `
                <tr>
                  <td>${originalIndex + 1}</td>
                  <td>
                    <div class="player-cell ${editing ? "player-cell-editing" : ""}">
                      <span class="avatar">${escapeHTML(getInitials(player.name))}</span>
                      ${editing ? `<form class="inline-player-form" data-player-id="${player.id}"><input name="name" maxlength="60" value="${escapeHTML(player.name)}" required aria-label="Novo nome de ${escapeHTML(player.name)}"><button class="button button-small button-primary" type="submit">Salvar</button><button class="button button-small button-ghost" type="button" data-action="cancel-player-edit">Cancelar</button></form>` : `<strong>${escapeHTML(player.name)}</strong>`}
                    </div>
                  </td>
                  <td>${escapeHTML(formatDateTime(player.createdAt))}</td>
                  <td><span class="badge badge-green">Inscrito</span></td>
                  <td>
                    <div class="table-actions">
                      ${editing ? "" : `<button class="button button-small button-ghost" data-action="edit-player" data-player-id="${player.id}">Editar</button>`}
                      <button class="button button-small button-danger button-ghost" data-action="delete-player" data-player-id="${player.id}">Excluir</button>
                    </div>
                  </td>
                </tr>
              `;
            })
            .join("")}
        </tbody>
      </table>
    `;
  }

  function renderDraw() {
    if (!isAdmin()) return renderPublicDraw();
    if (!state.tournament) {
      return `
        <div class="page-grid workspace-page draw-workspace">
          ${renderWorkspaceHeader("Sorteio eliminatório", "Monte uma copa separada sem alterar resultados ou classificação da liga.", `${state.players.length} participantes`)}
          <section class="card">
            <div class="card-body draw-panel">
              <div class="draw-summary">
                <span class="eyebrow">Sorteio aleatório</span>
                <h2>Crie a chave do campeonato</h2>
                <p>Com ${state.players.length} jogador(es), será criada uma chave de ${nextPowerOfTwo(Math.max(2, state.players.length))} posições. O sistema espalha as folgas para não gerar confronto entre duas posições vazias.</p>
                <div class="card-actions mt-20">
                  <button class="button button-primary" data-action="generate-draw" ${state.players.length < 2 ? "disabled" : ""}>Sortear confrontos</button>
                  <button class="button button-ghost" data-action="navigate" data-view="players">Revisar jogadores</button>
                </div>
              </div>
              <div class="draw-orb" aria-hidden="true">?</div>
            </div>
          </section>
          <section class="card">
            <div class="card-header">
              <div>
                <h2>Jogadores no sorteio</h2>
                <p>A ordem abaixo não interfere no resultado.</p>
              </div>
            </div>
            <div class="card-body">
              <div class="toolbar-group">
                ${state.players
                  .map(
                    (player) => `<span class="badge"><span class="avatar" style="width:22px;height:22px">${escapeHTML(getInitials(player.name))}</span>${escapeHTML(player.name)}</span>`,
                  )
                  .join("") || '<span class="text-muted">Nenhum jogador cadastrado.</span>'}
              </div>
            </div>
          </section>
        </div>
      `;
    }

    const bracket = buildBracket();
    const firstRoundMatches = bracket.rounds[0]?.matches.length || 1;
    const bracketHeight = firstRoundMatches * BASE_MATCH_GAP + 70;
    const byes = state.tournament.bracketSize - state.players.length;

    return `
      <div class="page-grid workspace-page draw-workspace">
        ${renderWorkspaceHeader("Chave mata-mata", "Acompanhe avanços, registre placares e conduza a copa até a final.", `Chave de ${state.tournament.bracketSize}`, `<button class="button button-ghost" data-action="print-bracket">Imprimir chave</button>`)}
        <section class="card">
          <div class="bracket-toolbar">
            <div>
              <strong>Chave de ${state.tournament.bracketSize}</strong>
              <div class="bracket-legend mt-12">
                <span class="legend-item"><span class="legend-swatch winner"></span> Resultado definido</span>
                <span class="legend-item"><span class="legend-swatch pending"></span> Aguardando placar</span>
                <span class="legend-item"><span class="legend-swatch bye"></span> Avanço automático</span>
              </div>
            </div>
            <div class="card-actions">
              <button class="button button-ghost" data-action="print-bracket">Imprimir</button>
              <button class="button button-danger button-ghost" data-action="generate-draw">Refazer sorteio</button>
            </div>
          </div>
          <div class="bracket-scroll">
            <div class="bracket-canvas" style="--round-count:${bracket.rounds.length};--bracket-height:${bracketHeight}px">
              ${bracket.rounds.map((round) => renderBracketRound(round)).join("")}
            </div>
          </div>
        </section>

        ${renderThirdPlace(bracket.thirdPlace)}

        <section class="card">
          <div class="card-body">
            <div class="notice">
              <span aria-hidden="true">i</span>
              <span>Sorteio realizado em ${escapeHTML(formatDateTime(state.tournament.createdAt))}. Esta chave possui ${byes} avanço(s) automático(s). Clique em <strong>Registrar</strong> em uma partida liberada para informar o placar.</span>
            </div>
          </div>
        </section>
      </div>
    `;
  }

  function renderBracketRound(round) {
    const step = BASE_MATCH_GAP * 2 ** round.index;
    return `
      <section class="bracket-round" aria-label="${escapeHTML(round.name)}">
        <div class="round-heading">
          <span>${escapeHTML(round.name)}</span>
          <span>${round.matchCount} jogo(s)</span>
        </div>
        ${round.matches
          .map((match) => {
            const top = step / 2 - 44 + match.matchIndex * step;
            return renderBracketMatch(match, top);
          })
          .join("")}
      </section>
    `;
  }

  function renderBracketMatch(match, top) {
    const result = match.result;
    const classes = ["match-card"];
    if (match.isReady) classes.push("is-ready");
    if (match.isComplete) classes.push("is-complete");
    if (match.isBye || match.isEmpty) classes.push("is-bye");

    const scoreA = result ? result.scoreA : "";
    const scoreB = result ? result.scoreB : "";
    const ballsA = result ? normalizeBallCount(result.ballsA) : "";
    const ballsB = result ? normalizeBallCount(result.ballsB) : "";
    const status = result
      ? "Finalizada"
      : match.isBye
        ? "Folga"
        : match.isReady
          ? "Liberada"
          : "Aguardando";

    return `
      <article class="${classes.join(" ")}" style="--top:${top}px">
        <div class="match-topline"><span>Jogo ${match.matchIndex + 1}</span><span>·</span><span>${status}</span></div>
        ${renderMatchPlayer(match.playerAId, scoreA, ballsA, match, "a")}
        ${renderMatchPlayer(match.playerBId, scoreB, ballsB, match, "b")}
        ${
          match.playerAId && match.playerBId
            ? `<button class="match-button" data-action="open-score" data-match-id="${match.id}" data-match-kind="bracket">${result ? "Editar placar" : "Registrar"}</button>`
            : ""
        }
      </article>
    `;
  }

  function renderMatchPlayer(playerId, score, ballsMade, match, side) {
    const isWinner = match.winnerId && match.winnerId === playerId;
    const isLoser = match.loserId && match.loserId === playerId;
    const classes = ["match-player"];
    if (!playerId) classes.push("is-empty");
    if (isWinner) classes.push("is-winner");
    if (isLoser) classes.push("is-loser");

    let name = playerName(playerId, "A definir");
    if (!playerId && match.roundIndex === 0) name = "Folga";
    const winnerMark = isWinner ? " ✓" : "";

    return `
      <div class="${classes.join(" ")}">
        <span class="match-name">${escapeHTML(name)}${winnerMark}</span>
        <span class="match-score-wrap">
          <span class="match-score">${score === "" ? "" : escapeHTML(score)}</span>
          ${ballsMade === "" ? "" : `<small class="match-balls">${ballsMade} bola(s)</small>`}
        </span>
      </div>
    `;
  }

  function renderThirdPlace(match) {
    if (!state.settings.thirdPlace || !match) return "";
    const playerA = playerName(match.playerAId);
    const playerB = playerName(match.playerBId);
    const result = match.result;

    return `
      <section class="third-place-card">
        <h3>🥉 Disputa de 3º lugar</h3>
        <div class="compact-match">
          <div class="compact-player">
            <span class="avatar">${escapeHTML(getInitials(playerA))}</span>
            <strong>${escapeHTML(playerA)}</strong>
          </div>
          <span class="match-result-summary">
            <span class="versus">${result ? `${result.scoreA} × ${result.scoreB}` : "CONTRA"}</span>
            ${result ? `<small>${formatBallSummary(result)}</small>` : ""}
          </span>
          <div class="compact-player">
            <strong>${escapeHTML(playerB)}</strong>
            <span class="avatar">${escapeHTML(getInitials(playerB))}</span>
          </div>
          <button class="button ${match.isReady || result ? "button-primary" : "button-ghost"}" data-action="open-score" data-match-id="third-place" data-match-kind="third" ${!match.playerAId || !match.playerBId ? "disabled" : ""}>${result ? "Editar placar" : "Registrar"}</button>
        </div>
      </section>
    `;
  }

  function flattenMatches() {
    const bracket = buildBracket();
    const matches = bracket.rounds.reduce(
      (all, round) => all.concat(
        round.matches.map((match) => ({ ...match, kind: "bracket" })),
      ),
      [],
    );
    if (bracket.thirdPlace) {
      matches.push({ ...bracket.thirdPlace, kind: "third" });
    }
    return matches;
  }

  function findNextMatch() {
    return (
      flattenMatches().find(
        (match) => match.playerAId && match.playerBId && !match.result,
      ) || null
    );
  }

  function getCompletedMatches() {
    return flattenMatches()
      .filter((match) => match.result)
      .sort((a, b) => new Date(b.result.playedAt) - new Date(a.result.playedAt));
  }

  function renderMatches() {
    if (!state.tournament) {
      return `
        <div class="page-grid workspace-page matches-workspace">
          ${renderWorkspaceHeader("Central de partidas", "Os confrontos eliminatórios aparecerão aqui depois do sorteio.", "Mata-mata ainda não iniciado")}
          <section class="card workspace-empty-card">${renderEmptyState("◆", "Nenhuma partida criada", "Faça o sorteio para gerar os confrontos do campeonato.", "Sortear chave", "generate-draw")}</section>
        </div>
      `;
    }

    const allMatches = flattenMatches();
    const filtered = allMatches.filter((match) => {
      if (ui.matchFilter === "pending") {
        return match.playerAId && match.playerBId && !match.result;
      }
      if (ui.matchFilter === "completed") return Boolean(match.result);
      if (ui.matchFilter === "automatic") return match.automatic;
      return true;
    });

    return `
      <div class="page-grid workspace-page matches-workspace">
        ${renderWorkspaceHeader("Central de partidas", "Filtre confrontos e registre resultados sem precisar percorrer toda a chave.", `${allMatches.length} confrontos`, `<button class="button button-ghost" data-action="navigate" data-view="draw">Abrir chave</button>`)}
        <section class="card">
          <div class="card-header">
            <div>
              <h2>Todos os confrontos</h2>
              <p>${allMatches.filter((match) => match.result).length} resultado(s) registrado(s).</p>
            </div>
          </div>
          <div class="card-body">
            <div class="toolbar">
              <div class="toolbar-group">
                <label class="field">
                  <span>Exibir</span>
                  <select id="match-filter">
                    <option value="all" ${ui.matchFilter === "all" ? "selected" : ""}>Todas</option>
                    <option value="pending" ${ui.matchFilter === "pending" ? "selected" : ""}>Pendentes</option>
                    <option value="completed" ${ui.matchFilter === "completed" ? "selected" : ""}>Concluídas</option>
                    <option value="automatic" ${ui.matchFilter === "automatic" ? "selected" : ""}>Avanços automáticos</option>
                  </select>
                </label>
              </div>
              <div class="toolbar-group">
                <button class="button button-ghost" data-action="navigate" data-view="draw">Ver chave</button>
              </div>
            </div>
          </div>
          <div class="card-body" style="padding-top:0">
            ${renderMatchList(filtered)}
          </div>
        </section>
      </div>
    `;
  }

  function renderMatchList(matches) {
    if (!matches.length) {
      return `<div class="empty-state"><div class="empty-state-icon">⌕</div><h3>Nenhuma partida neste filtro</h3><p>Escolha outro status para visualizar os confrontos.</p></div>`;
    }

    return `
      <div class="match-list">
        ${matches
          .map((match) => {
            const result = match.result;
            const hasPlayers = match.playerAId && match.playerBId;
            const status = result
              ? '<span class="badge badge-green">Concluída</span>'
              : match.automatic
                ? '<span class="badge">Automática</span>'
                : hasPlayers
                  ? '<span class="badge badge-gold">Pendente</span>'
                  : '<span class="badge">Aguardando</span>';
            return `
              <article class="match-row">
                <div class="match-meta">
                  <strong>${escapeHTML(match.roundName)}</strong><br>
                  ${status}
                </div>
                <div class="match-versus">
                  <strong class="left">${escapeHTML(playerName(match.playerAId, match.roundIndex === 0 ? "Folga" : "A definir"))}</strong>
                  <span class="match-result-summary">
                    <span class="result-score">${result ? `${result.scoreA} × ${result.scoreB}` : "×"}</span>
                    ${result ? `<small>${formatBallSummary(result)}</small>` : ""}
                  </span>
                  <strong>${escapeHTML(playerName(match.playerBId, match.roundIndex === 0 ? "Folga" : "A definir"))}</strong>
                </div>
                <button class="button button-small ${hasPlayers ? "button-primary" : "button-ghost"}" data-action="open-score" data-match-id="${match.id}" data-match-kind="${match.kind}" ${!hasPlayers ? "disabled" : ""}>${result ? "Editar" : "Placar"}</button>
              </article>
            `;
          })
          .join("")}
      </div>
    `;
  }

  function calculateRanking() {
    const rankingSettings = state.settings.ranking || createDefaultState().settings.ranking;
    const rows = new Map(
      state.players.map((player) => [
        player.id,
        {
          id: player.id,
          name: player.name,
          played: 0,
          wins: 0,
          losses: 0,
          scoreFor: 0,
          scoreAgainst: 0,
          differential: 0,
          ballsMade: 0,
          points: state.tournament ? Number(rankingSettings.participation) || 0 : 0,
          stage: state.tournament ? "Em disputa" : "Inscrito",
          placement: 99,
        },
      ]),
    );

    if (!state.tournament) return [...rows.values()].sort(sortRanking);

    const bracket = buildBracket();
    const completed = bracket.rounds
      .reduce((all, round) => all.concat(round.matches), [])
      .filter((match) => match.result && match.playerAId && match.playerBId);
    if (
      bracket.thirdPlace?.result &&
      bracket.thirdPlace.playerAId &&
      bracket.thirdPlace.playerBId
    ) {
      completed.push(bracket.thirdPlace);
    }

    completed.forEach((match) => {
      const result = match.result;
      const playerA = rows.get(match.playerAId);
      const playerB = rows.get(match.playerBId);
      if (!playerA || !playerB) return;

      playerA.played += 1;
      playerB.played += 1;
      playerA.scoreFor += Number(result.scoreA);
      playerA.scoreAgainst += Number(result.scoreB);
      playerB.scoreFor += Number(result.scoreB);
      playerB.scoreAgainst += Number(result.scoreA);
      playerA.ballsMade += normalizeBallCount(result.ballsA);
      playerB.ballsMade += normalizeBallCount(result.ballsB);

      const winner = rows.get(match.winnerId);
      const loser = rows.get(match.loserId);
      if (winner) {
        winner.wins += 1;
        winner.points += Number(rankingSettings.win) || 0;
      }
      if (loser) loser.losses += 1;
    });

    const roundCount = bracket.rounds.length;
    bracket.rounds.forEach((round) => {
      round.matches.forEach((match) => {
        if (!match.result || !match.loserId) return;
        const loser = rows.get(match.loserId);
        if (!loser) return;
        const distanceFromFinal = roundCount - 1 - round.index;
        if (distanceFromFinal === 0) {
          loser.stage = "Vice-campeão";
          loser.placement = 2;
          loser.points += Number(rankingSettings.runnerUp) || 0;
        } else if (distanceFromFinal === 1) {
          loser.stage = "Semifinalista";
          loser.placement = 4;
          loser.points += Number(rankingSettings.semifinal) || 0;
        } else if (distanceFromFinal === 2) {
          loser.stage = "Quartas de final";
          loser.placement = 8;
          loser.points += Number(rankingSettings.quarterfinal) || 0;
        } else {
          loser.stage = "Oitavas de final";
          loser.placement = 16;
          loser.points += Number(rankingSettings.roundOf16) || 0;
        }
      });
    });

    const finalMatch = bracket.rounds[bracket.rounds.length - 1]?.matches[0];
    if (finalMatch?.result && finalMatch.winnerId) {
      const champion = rows.get(finalMatch.winnerId);
      if (champion) {
        champion.stage = "Campeão";
        champion.placement = 1;
        champion.points += Number(rankingSettings.champion) || 0;
      }
    }

    if (bracket.thirdPlace?.result) {
      const third = rows.get(bracket.thirdPlace.winnerId);
      const fourth = rows.get(bracket.thirdPlace.loserId);
      if (third) {
        third.stage = "3º lugar";
        third.placement = 3;
      }
      if (fourth) {
        fourth.stage = "4º lugar";
        fourth.placement = 4;
      }
    }

    rows.forEach((row) => {
      row.differential = row.scoreFor - row.scoreAgainst;
    });

    return [...rows.values()].sort(sortRanking);
  }

  function sortRanking(a, b) {
    return (
      b.points - a.points ||
      b.wins - a.wins ||
      b.differential - a.differential ||
      b.ballsMade - a.ballsMade ||
      a.placement - b.placement ||
      a.name.localeCompare(b.name, "pt-BR")
    );
  }

  function renderRanking() {
    if (!isAdmin()) return renderPublicKnockoutRanking();
    const rows = calculateRanking();
    return `
      <div class="page-grid dashboard-grid workspace-page ranking-workspace">
        ${renderWorkspaceHeader("Desempenho no mata-mata", "Veja a campanha completa e os bônus acumulados em cada fase eliminatória.", `${rows.length} jogadores`, `<button class="button button-ghost" data-action="navigate" data-view="settings">Ajustar pontuação</button>`)}
        <section class="card col-12">
          <div class="card-header">
            <div>
              <h2>Pódio atual</h2>
              <p>Ordenado por pontos, vitórias, saldo de placar e bolas matadas.</p>
            </div>
          </div>
          ${renderPodium(rows.slice(0, 3))}
        </section>

        <section class="card col-12">
          <div class="card-header">
            <div>
              <h2>Classificação completa</h2>
              <p>${scoreRuleLabel()} · ${state.settings.ranking.win} pontos por vitória.</p>
            </div>
            <button class="button button-small button-ghost" data-action="navigate" data-view="settings">Editar pontuação</button>
          </div>
          <div class="table-wrap mt-20">
            ${renderRankingTable(rows)}
          </div>
        </section>
      </div>
    `;
  }

  function renderPodium(rows) {
    if (!rows.length) {
      return `<div class="empty-state"><p>Nenhum jogador cadastrado.</p></div>`;
    }
    const ordered = [rows[1], rows[0], rows[2]];
    const places = [2, 1, 3];
    return `
      <div class="podium">
        ${ordered
          .map((row, index) => {
            if (!row) return `<div class="podium-place"></div>`;
            const place = places[index];
            return `
              <div class="podium-place place-${place}">
                <div class="podium-avatar">${escapeHTML(getInitials(row.name))}</div>
                <strong>${escapeHTML(row.name)}</strong>
                <span>${row.points} pts</span>
                <div class="podium-block">${place}º</div>
              </div>
            `;
          })
          .join("")}
      </div>
    `;
  }

  function renderRankingTable(rows) {
    return `
      <table>
        <thead>
          <tr>
            <th>Pos.</th>
            <th>Jogador</th>
            <th>Pontos</th>
            <th>J</th>
            <th>V</th>
            <th>D</th>
            <th>Pró</th>
            <th>Contra</th>
            <th>Saldo</th>
            <th>Bolas</th>
            <th>Situação</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (row, index) => `
                <tr>
                  <td><span class="ranking-position pos-${index + 1}">${index + 1}</span></td>
                  <td>
                    <div class="player-cell">
                      <span class="avatar ${index === 0 ? "gold" : ""}">${escapeHTML(getInitials(row.name))}</span>
                      <strong>${escapeHTML(row.name)}</strong>
                    </div>
                  </td>
                  <td><strong>${row.points}</strong></td>
                  <td>${row.played}</td>
                  <td>${row.wins}</td>
                  <td>${row.losses}</td>
                  <td>${row.scoreFor}</td>
                  <td>${row.scoreAgainst}</td>
                  <td>${row.differential > 0 ? "+" : ""}${row.differential}</td>
                  <td><strong>${row.ballsMade}</strong></td>
                  <td><span class="badge ${row.stage === "Campeão" ? "badge-gold" : row.stage === "Em disputa" ? "badge-green" : ""}">${escapeHTML(row.stage)}</span></td>
                </tr>
              `,
            )
            .join("")}
        </tbody>
      </table>
    `;
  }

  function formatNewsDate(value, long = false) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Data não informada";
    return new Intl.DateTimeFormat("pt-BR", long
      ? { day: "numeric", month: "long", year: "numeric" }
      : { day: "2-digit", month: "short", year: "numeric" }).format(date);
  }

  function newsDateInputValue(value) {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) return "";
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  }

  function renderNewsImage(article, className = "") {
    if (!article.imageUrl) {
      return `<div class="news-image-placeholder ${className}" aria-hidden="true"><span>8</span><small>Sinuca da Firma</small></div>`;
    }
    const separator = article.imageUrl.includes("?") ? "&" : "?";
    return `<img class="${className}" src="${escapeHTML(article.imageUrl)}${separator}v=${encodeURIComponent(article.updatedAt || "1")}" alt="${escapeHTML(article.imageAlt || article.title)}" loading="lazy">`;
  }

  function newsVideoEmbed(value) {
    if (!value) return "";
    try {
      const url = new URL(value);
      let embed = "";
      if (url.hostname === "youtu.be") {
        embed = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(url.pathname.slice(1))}`;
      } else if (url.hostname.endsWith("youtube.com")) {
        const id = url.searchParams.get("v") || url.pathname.split("/").filter(Boolean).pop();
        if (id) embed = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}`;
      } else if (url.hostname.endsWith("vimeo.com")) {
        const id = url.pathname.split("/").filter(Boolean).pop();
        if (id && /^\d+$/.test(id)) embed = `https://player.vimeo.com/video/${id}`;
      }
      if (!embed) return "";
      return `<div class="news-video"><iframe src="${embed}" title="Vídeo da notícia" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div>`;
    } catch (error) {
      return "";
    }
  }

  function renderNewsMeta(article) {
    return `
      <div class="news-meta">
        <span class="news-category">${escapeHTML(article.category)}</span>
        <span>Por ${escapeHTML(article.author)}</span>
        <time datetime="${escapeHTML(article.publishedAt)}">${formatNewsDate(article.publishedAt)}</time>
      </div>
    `;
  }

  function renderNewsSignals(article) {
    const ratingCount = Number(article.ratingCount) || 0;
    const commentCount = Number(article.commentCount) || 0;
    return `
      <div class="news-signals" aria-label="Interações da notícia">
        <span><b aria-hidden="true">★</b> ${ratingCount ? `${Number(article.ratingAverage).toFixed(1)} (${ratingCount})` : "Sem avaliações"}</span>
        <span><b aria-hidden="true">◌</b> ${commentCount} ${commentCount === 1 ? "comentário" : "comentários"}</span>
      </div>
    `;
  }

  function renderNews() {
    if (isAdmin()) return renderNewsAdmin();
    if (ui.selectedNewsId) {
      const selected = newsItems.find((article) => article.id === ui.selectedNewsId);
      if (selected) return renderNewsArticle(selected);
      ui.selectedNewsId = null;
    }
    return renderNewsPublic();
  }

  function renderNewsPublic() {
    if (newsLoading) {
      return `<div class="public-view"><section class="news-loading" aria-label="Carregando notícias"><span></span><span></span><span></span></section></div>`;
    }
    if (newsError) {
      return `<div class="public-view"><section class="public-view-empty" role="alert"><span class="public-brand-ball" aria-hidden="true">!</span><div><h2>As notícias não carregaram</h2><p>${escapeHTML(newsError)} Seus outros dados continuam disponíveis.</p></div><button class="button button-primary" data-action="retry-news">Tentar novamente</button></section></div>`;
    }
    if (!newsItems.length) {
      return `
        <div class="public-view news-public">
          ${renderPublicViewHeader("Notícias", "O campeonato também acontece fora da mesa.", "Resultados, bastidores e histórias da competição serão publicados aqui.", [])}
          <section class="public-view-empty"><span class="public-brand-ball" aria-hidden="true">8</span><div><h2>A redação está preparando a primeira matéria.</h2><p>Volte em breve para acompanhar as novidades da Sinuca da Firma.</p></div><button class="button button-primary" data-action="navigate" data-view="league">Ver a liga</button></section>
        </div>
      `;
    }
    const featured = newsItems.find((article) => article.featured) || newsItems[0];
    const latest = newsItems;
    return `
      <div class="public-view news-public">
        <section class="news-masthead">
          <div class="news-masthead-inner">
            <div class="news-masthead-copy">
              ${renderNewsMeta(featured)}
              ${renderNewsSignals(featured)}
              <h1>${escapeHTML(featured.title)}</h1>
              <p>${escapeHTML(featured.summary)}</p>
              <button class="button public-button-light" data-action="open-news" data-news-id="${escapeHTML(featured.id)}">Ler matéria <span aria-hidden="true">→</span></button>
            </div>
            <button class="news-featured-media" data-action="open-news" data-news-id="${escapeHTML(featured.id)}" aria-label="Abrir: ${escapeHTML(featured.title)}">
              ${renderNewsImage(featured)}
            </button>
          </div>
        </section>
        <section class="news-index">
          <div class="news-index-heading"><div><h2>Últimas notícias</h2><p>Informação oficial para ninguém perder uma tacada.</p></div><span>${newsItems.length} ${newsItems.length === 1 ? "publicação" : "publicações"}</span></div>
          <div class="news-grid news-latest-grid">${latest.map((article) => `
            <article class="news-card">
              <button class="news-card-media" data-action="open-news" data-news-id="${escapeHTML(article.id)}" aria-label="Abrir: ${escapeHTML(article.title)}">${renderNewsImage(article)}</button>
              <div class="news-card-copy">
                <div class="news-card-kicker"><span class="news-category">${escapeHTML(article.category)}</span><time datetime="${escapeHTML(article.publishedAt)}">${formatNewsDate(article.publishedAt)}</time></div>
                <h3><button data-action="open-news" data-news-id="${escapeHTML(article.id)}">${escapeHTML(article.title)}</button></h3>
                ${renderNewsSignals(article)}
                <button class="news-read-link" data-action="open-news" data-news-id="${escapeHTML(article.id)}">Continuar lendo <span aria-hidden="true">→</span></button>
              </div>
            </article>`).join("")}</div>
        </section>
      </div>
    `;
  }

  function renderRatingStars(articleId, engagement) {
    const rating = engagement?.rating || { count: 0, average: 0, userScore: 0 };
    return `
      <div class="news-rating-panel">
        <div>
          <span class="news-rating-label">Avalie esta notícia</span>
          <strong>${rating.count ? Number(rating.average).toFixed(1) : "—"}</strong>
          <small>${rating.count} ${rating.count === 1 ? "avaliação" : "avaliações"}</small>
        </div>
        <div class="news-stars" role="group" aria-label="Avaliação de 1 a 5 estrelas">
          ${[1, 2, 3, 4, 5].map((score) => `<button type="button" class="news-star ${score <= rating.userScore ? "is-selected" : ""}" data-action="rate-news" data-news-id="${escapeHTML(articleId)}" data-score="${score}" aria-label="Dar nota ${score} de 5" aria-pressed="${score === rating.userScore}">★</button>`).join("")}
        </div>
        <p>${rating.userScore ? `Sua nota atual é ${rating.userScore}. Você pode alterá-la.` : "Sua avaliação é anônima e pode ser alterada depois."}</p>
      </div>
    `;
  }

  function renderNewsComments(article) {
    const engagement = newsEngagement[article.id];
    if (!engagement) {
      return `<section class="news-conversation"><div class="news-conversation-heading"><h2>Comentários</h2><button class="button button-ghost" data-action="reload-news-engagement" data-news-id="${escapeHTML(article.id)}">Carregar conversa</button></div></section>`;
    }
    const comments = Array.isArray(engagement.comments) ? engagement.comments : [];
    return `
      <section class="news-conversation" id="news-comments">
        ${renderRatingStars(article.id, engagement)}
        <div class="news-conversation-heading"><div><h2>Conversa da rodada</h2><p>${comments.length ? `${comments.length} ${comments.length === 1 ? "comentário publicado" : "comentários publicados"}` : "Seja o primeiro a comentar."}</p></div></div>
        <form id="news-comment-form" class="news-comment-form">
          <div class="community-rules"><strong>Regras da conversa</strong><p>Comente sobre a partida com respeito. Não publique ataques pessoais, dados privados, discriminação ou conteúdo ofensivo. Comentários podem ser denunciados e removidos pela organização.</p></div>
          <input type="hidden" name="articleId" value="${escapeHTML(article.id)}">
          <label class="field"><span>Seu nome <small>(opcional)</small></span><input name="author" maxlength="50" autocomplete="name" placeholder="Deixe vazio para comentar como Anônimo"></label>
          <label class="field"><span>Comentário</span><textarea name="body" minlength="2" maxlength="500" required placeholder="O que você achou da partida ou da notícia?"></textarea></label>
          <label class="news-honeypot" aria-hidden="true">Site<input name="website" tabindex="-1" autocomplete="off"></label>
          <div class="news-comment-actions"><span id="news-comment-status" role="status"></span><button class="button button-primary" type="submit">Publicar comentário</button></div>
        </form>
        <div class="news-comment-list">
          ${comments.length ? comments.map((comment) => `
            <article class="news-comment">
              <div class="news-comment-avatar" aria-hidden="true">${escapeHTML(getInitials(comment.author || "Anônimo"))}</div>
              <div><div class="news-comment-meta"><strong>${escapeHTML(comment.author || "Anônimo")}</strong><time datetime="${escapeHTML(comment.createdAt)}">${formatRelativeTime(comment.createdAt)}</time></div><p>${escapeHTML(comment.body).replace(/\n/g, "<br>")}</p><button class="news-report-button" type="button" data-action="report-news-comment" data-comment-id="${escapeHTML(comment.id)}">Denunciar</button></div>
            </article>`).join("") : `<div class="news-comments-empty"><span aria-hidden="true">◌</span><p>A conversa ainda está silenciosa. Deixe a primeira opinião.</p></div>`}
        </div>
      </section>
    `;
  }

  function renderNewsArticle(article) {
    const related = newsItems.filter((item) => item.id !== article.id).slice(0, 3);
    const paragraphs = String(article.body)
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.replace(/\s*\n\s*/g, " ").replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .map((paragraph) => `<p>${escapeHTML(paragraph)}</p>`)
      .join("");
    return `
      <article class="public-view news-article">
        <header class="news-article-header">
          <div class="news-article-heading">
            <button class="public-view-back" data-action="close-news">← Todas as notícias</button>
            ${renderNewsMeta(article)}
            <h1>${escapeHTML(article.title)}</h1>
            <p>${escapeHTML(article.summary)}</p>
          </div>
        </header>
        <div class="news-article-layout">
          <div class="news-article-main">
            <figure class="news-article-cover">${renderNewsImage(article)}${article.imageAlt ? `<figcaption>${escapeHTML(article.imageAlt)}</figcaption>` : ""}</figure>
            <div class="news-article-body">${paragraphs}</div>
            ${newsVideoEmbed(article.videoUrl)}
            ${renderNewsComments(article)}
          </div>
          <aside class="news-article-aside">
            <span>Publicado por</span><strong>${escapeHTML(article.author)}</strong><time datetime="${escapeHTML(article.publishedAt)}">${formatNewsDate(article.publishedAt, true)}</time>
            <button class="button button-ghost" data-action="share-news">Compartilhar notícia</button>
          </aside>
        </div>
        ${related.length ? `<section class="news-related"><div class="news-index-heading"><div><h2>Continue acompanhando</h2></div></div><div class="news-grid">${related.map((item) => `<article class="news-card"><button class="news-card-media" data-action="open-news" data-news-id="${escapeHTML(item.id)}">${renderNewsImage(item)}</button><div class="news-card-copy">${renderNewsMeta(item)}<h3><button data-action="open-news" data-news-id="${escapeHTML(item.id)}">${escapeHTML(item.title)}</button></h3></div></article>`).join("")}</div></section>` : ""}
      </article>
    `;
  }

  function renderNewsAdminItem(article) {
    const moderating = ui.moderatingNewsId === article.id;
    const engagement = newsEngagement[article.id];
    const comments = engagement?.comments || [];
    return `
      <article class="news-admin-item ${moderating ? "is-moderating" : ""}">
        <div class="news-admin-thumb">${renderNewsImage(article)}</div>
        <div>
          <div class="news-admin-item-meta"><span class="badge ${article.status === "published" ? "badge-green" : ""}">${article.status === "published" ? "Publicada" : "Rascunho"}</span>${article.featured ? '<span class="badge badge-gold">Destaque</span>' : ""}</div>
          <h3>${escapeHTML(article.title)}</h3>
          <p>${formatNewsDate(article.publishedAt)} · ${escapeHTML(article.category)} · ★ ${Number(article.ratingAverage || 0).toFixed(1)} · ${Number(article.commentCount) || 0} comentário(s)</p>
          <p class="news-admin-history">Criada ${formatDateTime(article.createdAt)} · última alteração ${formatDateTime(article.updatedAt)} · por ${escapeHTML(article.author)}</p>
          <div class="news-admin-actions"><button class="button button-small button-ghost" data-action="edit-news" data-news-id="${escapeHTML(article.id)}">Editar</button><button class="button button-small button-ghost" data-action="moderate-news" data-news-id="${escapeHTML(article.id)}">${moderating ? "Fechar comentários" : "Comentários"}</button><button class="button button-small button-danger button-ghost" data-action="delete-news" data-news-id="${escapeHTML(article.id)}">Excluir</button></div>
        </div>
        ${moderating ? `<div class="news-admin-comments">
          <strong>Moderação</strong>
          ${engagement ? (comments.length ? comments.map((comment) => `<div class="news-admin-comment"><div><b>${escapeHTML(comment.author)}</b><span>${escapeHTML(comment.body)}</span>${Number(comment.reportCount) ? `<em>${Number(comment.reportCount)} denúncia(s)</em>` : ""}</div><button class="button button-small button-danger button-ghost" data-action="delete-news-comment" data-comment-id="${escapeHTML(comment.id)}" data-news-id="${escapeHTML(article.id)}">Excluir</button></div>`).join("") : "<p>Nenhum comentário nesta notícia.</p>") : "<p>Carregando comentários...</p>"}
        </div>` : ""}
      </article>
    `;
  }

  function renderNewsAdmin() {
    const editing = newsItems.find((article) => article.id === ui.editingNewsId) || null;
    return `
      <div class="workspace-page news-workspace">
        ${renderWorkspaceHeader("Central de notícias", "Publique resultados, histórias e bastidores sem mexer no código do site.", `${newsItems.length} ${newsItems.length === 1 ? "matéria cadastrada" : "matérias cadastradas"}`)}
        <div class="news-admin-layout">
          <section class="card news-editor-card">
            <div class="card-header"><div><h2>${editing ? "Editar notícia" : "Nova notícia"}</h2><p>Campos com * são obrigatórios.</p></div>${editing ? `<button class="button button-small button-ghost" data-action="cancel-news-edit">Cancelar edição</button>` : ""}</div>
            <div class="card-body">
              <div class="editorial-guidance"><strong>Publicação responsável</strong><p>Relate fatos verificáveis, resultados e contexto da competição. Evite humilhação, ataques pessoais e brincadeiras que possam expor colegas. Na descrição da imagem, diga objetivamente quem ou o que aparece.</p></div>
              <form id="news-form" class="form-grid">
                <input type="hidden" name="id" value="${escapeHTML(editing?.id || "")}">
                <label class="field col-8"><span>Título *</span><input name="title" maxlength="140" required value="${escapeHTML(editing?.title || "")}" placeholder="Ex.: Rodada decisiva muda a liderança"></label>
                <label class="field col-4"><span>Categoria *</span><input name="category" maxlength="40" required value="${escapeHTML(editing?.category || "Campeonato")}" placeholder="Campeonato"></label>
                <label class="field col-12"><span>Resumo *</span><textarea name="summary" maxlength="320" required placeholder="Uma chamada curta que explica por que vale a leitura.">${escapeHTML(editing?.summary || "")}</textarea><small class="field-help">Aparece na capa e na lista de notícias.</small></label>
                <label class="field col-12"><span>Texto da notícia *</span><textarea class="news-body-input" name="body" maxlength="20000" required placeholder="Conte o que aconteceu. Separe os parágrafos com uma linha em branco.">${escapeHTML(editing?.body || "")}</textarea></label>
                <label class="field col-6"><span>Autor *</span><input name="author" maxlength="80" required value="${escapeHTML(editing?.author || "Organização")}"></label>
                <label class="field col-6"><span>Data de publicação *</span><input name="publishedAt" type="datetime-local" required value="${newsDateInputValue(editing?.publishedAt)}"></label>
                <label class="field col-6"><span>Imagem de capa</span><input name="image" type="file" accept="image/jpeg,image/png,image/webp"><small class="field-help">JPG, PNG ou WebP. A imagem é otimizada antes do envio.</small></label>
                <label class="field col-6"><span>Descrição da imagem</span><input name="imageAlt" maxlength="180" value="${escapeHTML(editing?.imageAlt || "")}" placeholder="Ex.: Mind Rocha e Gracyanne Filth diante da mesa"><small class="field-help">Use uma descrição factual, sem julgamento sobre aparência.</small></label>
                ${editing?.imageUrl ? `<div class="news-admin-cover col-12">${renderNewsImage(editing)}<span>Capa atual — escolha outro arquivo apenas para substituir.</span></div>` : ""}
                <label class="field col-12"><span>Vídeo (opcional)</span><input name="videoUrl" type="url" value="${escapeHTML(editing?.videoUrl || "")}" placeholder="https://www.youtube.com/watch?v=..."><small class="field-help">Cole um link público do YouTube ou Vimeo.</small></label>
                <label class="field col-6"><span>Status</span><select name="status"><option value="draft" ${!editing || editing?.status === "draft" ? "selected" : ""}>Rascunho</option><option value="published" ${editing?.status === "published" ? "selected" : ""}>Publicada</option></select></label>
                <label class="news-check col-6"><input name="featured" type="checkbox" ${editing?.featured ? "checked" : ""}><span><strong>Destacar na capa</strong><small>A matéria ganha a posição principal.</small></span></label>
                <div class="news-form-actions col-12"><span id="news-form-status" role="status"></span><button class="button button-ghost" type="button" data-action="preview-news">Ver prévia completa</button><button class="button button-primary" type="submit">${editing ? "Salvar alterações" : "Salvar notícia"}</button></div>
              </form>
            </div>
          </section>
          <section class="card news-library-card">
            <div class="card-header"><div><h2>Publicações</h2><p>Edite ou remova o que já foi cadastrado.</p></div></div>
            <div class="news-admin-list">${newsItems.length ? newsItems.map(renderNewsAdminItem).join("") : `<div class="empty-state"><div class="empty-state-icon">▤</div><h3>Nenhuma notícia ainda</h3><p>Use o formulário ao lado para publicar a primeira matéria.</p></div>`}</div>
          </section>
        </div>
      </div>
    `;
  }

  function renderSettings() {
    const settings = state.settings;
    return `
      <div class="page-grid dashboard-grid workspace-page settings-workspace">
        ${renderWorkspaceHeader("Regras e persistência", "Controle a pontuação da liga e os dados permanentes do campeonato.", "Configuração administrativa")}
        <section class="card col-8">
          <div class="card-header">
            <div>
              <h2>Regras do campeonato</h2>
              <p>As alterações valem para a classificação da liga.</p>
            </div>
          </div>
          <div class="card-body">
            <form id="settings-form">
              <section class="settings-section">
                <h3>Identificação</h3>
                <p>Nome exibido no topo do sistema.</p>
                <div class="form-grid">
                  <label class="field col-12">
                    <span>Nome do campeonato</span>
                    <input name="title" maxlength="80" value="${escapeHTML(settings.title)}" required>
                  </label>
                </div>
              </section>

              <section class="settings-section">
                <h3>Liga por pontos</h3>
                <p>Vitória +${Number(settings.league.winPoints) || 0} · derrota +0. A classificação é recalculada automaticamente.</p>
                <div class="form-grid">
                  ${renderNumberField("Pontos por vitória", "league-winPoints", settings.league.winPoints, "col-12", true)}
                </div>
                <div class="notice mt-12"><span>↕</span><span>Derrota: 0 ponto. Desempates: pontos, vitórias, saldo de bolas, bolas matadas e nome.</span></div>
              </section>

              <div class="card-actions mt-20">
                <button class="button button-primary" type="submit">Salvar configurações</button>
              </div>
            </form>
          </div>
        </section>

        <section class="card col-4">
          <div class="card-header">
            <div>
              <h2>Dados persistentes</h2>
              <p>Banco de dados e backups do campeonato.</p>
            </div>
          </div>
          <div class="card-body">
            <div class="page-grid">
              <button class="button button-ghost" data-action="export-data">Exportar backup JSON</button>
              <button class="button button-ghost" data-action="import-data">Importar backup JSON</button>
              <button class="button button-danger button-ghost" data-action="reset-data">Restaurar dados iniciais</button>
            </div>
            <div class="notice mt-20">
              <span>✓</span>
              <span>Os dados são gravados no banco configurado no servidor e compartilhados com todos os acessos autorizados.</span>
            </div>
            <div class="notice notice-warning mt-20">
              <span>!</span>
              <span>Exporte periodicamente um backup JSON. No uso local, preserve também a pasta <strong>data</strong>.</span>
            </div>
          </div>
        </section>

      </div>
    `;
  }

  function renderNumberField(label, name, value, column, rawName = false) {
    return `
      <label class="field ${column}">
        <span>${escapeHTML(label)}</span>
        <input name="${rawName ? name : `ranking-${name}`}" type="number" min="0" max="999" value="${Number(value) || 0}" required>
      </label>
    `;
  }

  function renderEmptyState(icon, title, text, buttonLabel, action) {
    return `
      <div class="empty-state">
        <div class="empty-state-icon">${icon}</div>
        <h3>${escapeHTML(title)}</h3>
        <p>${escapeHTML(text)}</p>
        <button class="button button-primary" data-action="${action}">${escapeHTML(buttonLabel)}</button>
      </div>
    `;
  }

  function scoreRuleLabel(kind = "bracket") {
    if (kind === "league") return "Duelo único · vencedor 1 × 0";
    if (state.settings.scoreMode === "points") return "Placar por pontos livres";
    const target = Number(state.settings.framesToWin) || 2;
    return `Melhor de ${target * 2 - 1} frames (vence ao chegar a ${target})`;
  }

  function findMatch(matchId, kind = "bracket") {
    if (kind === "league") {
      return flattenLeagueMatches().find((match) => match.id === matchId) || null;
    }
    const bracket = buildBracket();
    if (kind === "third") return bracket.thirdPlace;
    return bracket.rounds
      .reduce((all, round) => all.concat(round.matches), [])
      .find((match) => match.id === matchId) || null;
  }

  function adjacentScoreMatch(matchId, kind, direction) {
    const matches = kind === "league"
      ? flattenLeagueMatches()
      : flattenMatches().filter((match) => match.kind === kind && match.playerAId && match.playerBId);
    const index = matches.findIndex((match) => match.id === matchId);
    if (index < 0) return null;
    const step = direction === "previous" ? -1 : 1;
    for (let cursor = index + step; cursor >= 0 && cursor < matches.length; cursor += step) {
      if (matches[cursor].playerAId && matches[cursor].playerBId) return matches[cursor];
    }
    return null;
  }

  function openScoreDialog(matchId, kind) {
    if (!requireAdmin()) return;
    const match = findMatch(matchId, kind);
    if (!match || !match.playerAId || !match.playerBId) {
      showToast("Esta partida ainda não está liberada.", "error");
      return;
    }

    dom.scoreMatchId.value = matchId;
    dom.scoreMatchKind.value = kind;
    dom.scoreRound.textContent = match.roundName;
    dom.scoreTitle.textContent = kind === "league" ? "Resultado da liga" : "Registrar placar";
    dom.scorePlayerA.textContent = playerName(match.playerAId);
    dom.scorePlayerB.textContent = playerName(match.playerBId);
    dom.scoreBallsPlayerA.textContent = playerName(match.playerAId);
    dom.scoreBallsPlayerB.textContent = playerName(match.playerBId);
    dom.scoreA.value = match.result?.scoreA ?? "";
    dom.scoreB.value = match.result?.scoreB ?? "";
    dom.scoreBallsA.value = match.result ? normalizeBallCount(match.result.ballsA) : "";
    dom.scoreBallsB.value = match.result ? normalizeBallCount(match.result.ballsB) : "";
    dom.scoreHelp.textContent = `${scoreRuleLabel(kind)} · empate não permitido`;
    dom.scoreError.textContent = "";
    dom.deleteScore.classList.toggle("hide", !match.result);
    dom.scoreDialog.showModal();
    window.setTimeout(() => dom.scoreA.focus(), 40);
  }

  function closeScoreDialog() {
    dom.scoreError.textContent = "";
    dom.scoreForm.reset();
    if (dom.scoreDialog.open) dom.scoreDialog.close();
  }

  function closeConfirmDialog() {
    if (!dom.confirmDialog.open) return;
    dom.confirmDialog.returnValue = "cancel";
    dom.confirmDialog.close("cancel");
  }

  function normalizeBallCount(value) {
    const number = Number(value);
    return Number.isInteger(number) && number >= 0 ? number : 0;
  }

  function ballsLeftForResult(result, playerId) {
    if (!result || result.winnerId === playerId) return 0;
    const ballsMade = playerId === result.playerAId
      ? normalizeBallCount(result.ballsA)
      : normalizeBallCount(result.ballsB);
    return Math.max(0, BALANCE_BALLS_PER_PLAYER - Math.min(BALANCE_BALLS_PER_PLAYER, ballsMade));
  }

  function formatBallSummary(result) {
    const ballsA = Math.min(MAX_BALLS_PER_PLAYER, normalizeBallCount(result.ballsA));
    const ballsB = Math.min(MAX_BALLS_PER_PLAYER, normalizeBallCount(result.ballsB));
    const leftA = ballsLeftForResult(result, result.playerAId);
    const leftB = ballsLeftForResult(result, result.playerBId);
    return `Matadas: ${ballsA} × ${ballsB} · na mesa: ${leftA} × ${leftB}`;
  }

  function normalizeResultBallCounts(result) {
    if (!result || typeof result !== "object") return;
    result.ballsA = normalizeBallCount(result.ballsA);
    result.ballsB = normalizeBallCount(result.ballsB);
  }

  function validateBallCounts(ballsA, ballsB) {
    if (!Number.isInteger(ballsA) || !Number.isInteger(ballsB)) {
      return "Informe números inteiros para as bolas matadas dos dois jogadores.";
    }
    if (ballsA < 0 || ballsB < 0) return "A quantidade de bolas matadas não pode ser negativa.";
    if (ballsA > MAX_BALLS_PER_PLAYER || ballsB > MAX_BALLS_PER_PLAYER) {
      return `Cada jogador pode matar no máximo ${MAX_BALLS_PER_PLAYER} bolas.`;
    }
    return "";
  }

  function validateScore(scoreA, scoreB, kind = "bracket") {
    if (!Number.isInteger(scoreA) || !Number.isInteger(scoreB)) {
      return "Informe números inteiros para os dois jogadores.";
    }
    if (scoreA < 0 || scoreB < 0) return "O placar não pode ser negativo.";
    if (scoreA === scoreB) return "A partida precisa ter um vencedor; empate não é permitido.";

    if (kind === "league") {
      if (!((scoreA === 1 && scoreB === 0) || (scoreA === 0 && scoreB === 1))) {
        return "Na liga cada duelo tem uma única partida: registre 1 × 0 para o vencedor.";
      }
      return "";
    }

    if (state.settings.scoreMode === "frames") {
      const target = Number(state.settings.framesToWin) || 2;
      const winnerScore = Math.max(scoreA, scoreB);
      const loserScore = Math.min(scoreA, scoreB);
      if (winnerScore !== target || loserScore >= target) {
        return `No modo frames, o vencedor deve ter exatamente ${target} e o perdedor menos que ${target}.`;
      }
    }
    return "";
  }

  function saveScoreFromDialog(event) {
    if (!requireAdmin()) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    const matchId = dom.scoreMatchId.value;
    const kind = dom.scoreMatchKind.value;
    const continuation = event.submitter?.value || "";
    const match = findMatch(matchId, kind);
    if (!match) return;

    const rawScoreA = dom.scoreA.value.trim();
    const rawScoreB = dom.scoreB.value.trim();
    if (rawScoreA === "" || rawScoreB === "") {
      dom.scoreError.textContent = "Preencha o placar dos dois jogadores.";
      return;
    }

    const rawBallsA = dom.scoreBallsA.value.trim();
    const rawBallsB = dom.scoreBallsB.value.trim();
    if (rawBallsA === "" || rawBallsB === "") {
      dom.scoreError.textContent = "Preencha a quantidade de bolas matadas pelos dois jogadores.";
      return;
    }

    const scoreA = Number(rawScoreA);
    const scoreB = Number(rawScoreB);
    const ballsA = Number(rawBallsA);
    const ballsB = Number(rawBallsB);
    const error = validateScore(scoreA, scoreB, kind) || validateBallCounts(ballsA, ballsB);
    if (error) {
      dom.scoreError.textContent = error;
      return;
    }

    const winnerId = scoreA > scoreB ? match.playerAId : match.playerBId;
    const result = {
      playerAId: match.playerAId,
      playerBId: match.playerBId,
      scoreA,
      scoreB,
      ballsA,
      ballsB,
      winnerId,
      playedAt: match.result?.playedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      updatedBy: auth.username || "Administrador",
    };

    if (kind === "league") {
      state.league.results[matchId] = result;
      delete state.league.inProgress[matchId];
      normalizeLeagueResults();
    } else if (kind === "third") {
      state.tournament.thirdPlaceResult = result;
    } else {
      state.tournament.results[matchId] = result;
      normalizeTournamentResults();
    }

    logActivity(
      "score",
      `${playerName(winnerId)} venceu`,
      `${match.roundName} · ${scoreA} × ${scoreB} · ${formatBallSummary(result).toLocaleLowerCase("pt-BR")}`,
    );
    saveState();
    dom.scoreDialog.close();
    showToast("Resultado salvo.");
    render();
    const adjacent = continuation ? adjacentScoreMatch(matchId, kind, continuation) : null;
    if (adjacent) window.setTimeout(() => openScoreDialog(adjacent.id, kind), 30);
  }

  function saveQuickLeagueScore(form) {
    if (!requireAdmin()) return;
    const match = findMatch(form.dataset.matchId, "league");
    if (!match) return;
    const values = new FormData(form);
    const winnerId = String(values.get("winner") || "");
    const ballsA = Number(values.get("ballsA"));
    const ballsB = Number(values.get("ballsB"));
    const error = ![match.playerAId, match.playerBId].includes(winnerId)
      ? "Escolha o vencedor."
      : validateBallCounts(ballsA, ballsB);
    if (error) {
      showToast(error, "error");
      return;
    }
    const now = new Date().toISOString();
    const result = {
      playerAId: match.playerAId, playerBId: match.playerBId,
      scoreA: winnerId === match.playerAId ? 1 : 0,
      scoreB: winnerId === match.playerBId ? 1 : 0,
      ballsA, ballsB, winnerId, playedAt: now, updatedAt: now,
      updatedBy: auth.username || "Administrador",
    };
    state.league.results[match.id] = result;
    delete state.league.inProgress[match.id];
    normalizeLeagueResults();
    logActivity("score", `${playerName(winnerId)} venceu`, `${match.roundName} · lançamento rápido · ${formatBallSummary(result).toLocaleLowerCase("pt-BR")}`);
    saveState();
    showToast("Resultado salvo. Próxima partida liberada para lançamento.");
    render();
  }

  async function deleteScoreFromDialog() {
    if (!requireAdmin()) return;
    const matchId = dom.scoreMatchId.value;
    const kind = dom.scoreMatchKind.value;
    const confirmed = await askConfirm(
      "Apagar este placar?",
      kind === "league"
        ? "A classificação da liga será recalculada imediatamente."
        : "Resultados de rodadas seguintes que dependem desta partida também poderão ser invalidados.",
      "Apagar placar",
    );
    if (!confirmed) return;

    if (kind === "league") {
      delete state.league.results[matchId];
      normalizeLeagueResults();
    } else if (kind === "third") {
      state.tournament.thirdPlaceResult = null;
    } else {
      delete state.tournament.results[matchId];
      normalizeTournamentResults();
    }
    saveState();
    dom.scoreDialog.close();
    showToast("Placar apagado.");
    render();
  }

  async function toggleLeagueMatchLive(matchId) {
    if (!requireAdmin()) return;
    const match = findMatch(matchId, "league");
    if (!match || match.result) {
      showToast("Esta partida não pode ser alterada.", "error");
      return;
    }
    state.league.inProgress = state.league.inProgress || {};
    const isLive = Boolean(state.league.inProgress[matchId]);
    const confirmed = await askConfirm(
      isLive ? "Encerrar o andamento?" : "Iniciar esta partida?",
      isLive
        ? "O duelo voltará a aceitar apostas até que seja iniciado novamente ou receba um placar."
        : "Assim que o duelo estiver em andamento, novos palpites, alterações e cancelamentos ficarão bloqueados.",
      isLive ? "Encerrar andamento" : "Iniciar e bloquear apostas",
    );
    if (!confirmed) return;
    if (isLive) delete state.league.inProgress[matchId];
    else state.league.inProgress[matchId] = true;
    logActivity(
      "match",
      isLive ? "Partida retirada de andamento" : "Partida em andamento",
      `${playerName(match.playerAId)} × ${playerName(match.playerBId)}`,
    );
    saveState();
    showToast(isLive ? "Partida reaberta para apostas." : "Partida iniciada; apostas bloqueadas.");
    render();
  }

  function askConfirm(title, message, actionLabel = "Confirmar") {
    dom.confirmTitle.textContent = title;
    dom.confirmMessage.textContent = message;
    dom.confirmAction.textContent = actionLabel;
    dom.confirmDialog.returnValue = "";
    dom.confirmDialog.showModal();
    return new Promise((resolve) => {
      ui.confirmResolver = resolve;
    });
  }

  function resolveConfirmation() {
    if (!ui.confirmResolver) return;
    const resolver = ui.confirmResolver;
    ui.confirmResolver = null;
    resolver(dom.confirmDialog.returnValue === "confirm");
  }

  async function prepareRosterChange(message) {
    if (!state.league) return true;
    return askConfirm(
      "Alterar participantes?",
      `${message} A tabela da liga e seus placares serão apagados para evitar confrontos inconsistentes.`,
      "Alterar e apagar a liga",
    );
  }

  async function addPlayer(form) {
    if (!requireAdmin()) return;
    const formData = new FormData(form);
    const name = String(formData.get("name") || "").trim();
    if (!name) return;
    if (state.players.length >= MAX_PLAYERS) {
      showToast(`Limite de ${MAX_PLAYERS} jogadores atingido.`, "error");
      return;
    }
    const duplicate = state.players.some(
      (player) => player.name.localeCompare(name, "pt-BR", { sensitivity: "base" }) === 0,
    );
    if (duplicate) {
      showToast("Já existe um jogador com esse nome.", "error");
      return;
    }
    const player = {
      id: createId("player"),
      name,
      createdAt: new Date().toISOString(),
    };

    let expansionPlan = null;
    if (state.league) {
      try {
        if (!window.SinucaLeague?.planIncrementalExpansion) throw new Error("Planejador da liga indisponível.");
        expansionPlan = window.SinucaLeague.planIncrementalExpansion({
          league: state.league,
          playerIds: state.players.map((item) => item.id),
          newPlayerId: player.id,
        });
      } catch (error) {
        console.error("Inclusão incremental bloqueada", error);
        showToast("A tabela atual precisa ser revisada antes dessa inclusão. Nenhum dado foi alterado.", "error");
        return;
      }

      const fittedCount = expansionPlan.additions.length;
      const newRoundCount = expansionPlan.newRounds.length;
      const placementSummary = newRoundCount
        ? `${fittedCount} em rodadas existentes e ${newRoundCount} em novas rodadas retroativas`
        : `${fittedCount} em rodadas existentes`;
      const allowed = await askConfirm(
        `Adicionar ${name} sem refazer a liga?`,
        `Serão criados ${expansionPlan.manifest.totalAdditions} novos duelos: ${placementSummary}. Os ${expansionPlan.previousMatchIds.length} confrontos atuais, resultados, bolas e apostas serão preservados.`,
        "Adicionar jogos retroativos",
      );
      if (!allowed) return;
    }

    state.players.push(player);
    if (expansionPlan) {
      expansionPlan.additions.forEach(({ roundIndex, match }) => {
        const round = state.league.rounds[roundIndex];
        round.matches.push(match);
        round.byePlayerId = null;
      });
      state.league.rounds.push(...expansionPlan.newRounds);
      state.league.playerIds = [...state.players.map((item) => item.id)];
      state.league.expandedAt = new Date().toISOString();
      normalizeLeagueResults();
      logActivity(
        "player",
        `${name} entrou na liga`,
        `${expansionPlan.manifest.totalAdditions} jogos retroativos adicionados; tabela anterior preservada`,
      );
    } else {
      logActivity("player", `${name} foi adicionado`, "Lista de jogadores atualizada");
    }
    saveState();
    showToast(expansionPlan ? `${name} entrou em ${expansionPlan.manifest.totalAdditions} novos duelos.` : "Jogador adicionado.");
    render();
    document.querySelector("#new-player-name")?.focus();
  }

  function startPlayerEdit(playerId) {
    if (!requireAdmin()) return;
    const player = playerById(playerId);
    if (!player) return;
    ui.editingPlayerId = playerId;
    render();
    window.setTimeout(() => document.querySelector(".inline-player-form input")?.select(), 20);
  }

  function savePlayerEdit(form) {
    if (!requireAdmin()) return;
    const playerId = form.dataset.playerId;
    const player = playerById(playerId);
    if (!player) return;
    const newName = String(new FormData(form).get("name") || "").trim();
    if (!newName) return;
    if (newName === player.name) {
      ui.editingPlayerId = null;
      render();
      return;
    }
    const duplicate = state.players.some(
      (item) =>
        item.id !== playerId &&
        item.name.localeCompare(newName, "pt-BR", { sensitivity: "base" }) === 0,
    );
    if (duplicate) {
      showToast("Já existe um jogador com esse nome.", "error");
      return;
    }
    const oldName = player.name;
    player.name = newName;
    ui.editingPlayerId = null;
    logActivity("player", `${oldName} agora é ${newName}`, "Nome atualizado sem alterar confrontos");
    saveState();
    showToast("Nome atualizado.");
    render();
  }

  async function deletePlayer(playerId) {
    if (!requireAdmin()) return;
    const player = playerById(playerId);
    if (!player) return;
    const allowed = await prepareRosterChange(`${player.name} será removido.`);
    if (!allowed) return;

    state.players = state.players.filter((item) => item.id !== playerId);
    if (state.tournament) state.tournament = null;
    if (state.league) state.league = null;
    logActivity("player", `${player.name} foi removido`, "Lista de jogadores atualizada");
    saveState();
    showToast("Jogador removido.");
    render();
  }

  function saveSettings(form) {
    if (!requireAdmin()) return;
    const formData = new FormData(form);
    state.settings.title = String(formData.get("title") || "Sinuca da Firma").trim();
    state.settings.league.winPoints = clampNumber(formData.get("league-winPoints"), 0, 999, 3);
    state.settings.league.lossPoints = 0;

    normalizeLeagueResults();
    normalizeTournamentResults();
    logActivity("settings", "Configurações atualizadas", `${state.settings.league.winPoints} pontos por vitória`);
    saveState();
    showToast("Configurações salvas.");
    render();
  }

  function clampNumber(value, min, max, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, Math.round(parsed)));
  }

  function exportData() {
    const payload = JSON.stringify(state, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `campeonato-sinuca-${date}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast("Backup exportado.");
  }

  function importData(file) {
    if (!requireAdmin()) return;
    if (!file) return;
    const reader = new FileReader();
    reader.addEventListener("load", async () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (!Array.isArray(parsed.players) || !parsed.settings) {
          throw new Error("Formato inválido");
        }
        const confirmed = await askConfirm(
          "Importar este backup?",
          "Os dados atuais serão substituídos pelo conteúdo do arquivo.",
          "Importar backup",
        );
        if (!confirmed) return;
        state = normalizeLoadedState(parsed, createDefaultState());
        normalizeLeagueResults();
        normalizeTournamentResults();
        logActivity("import", "Backup importado", `${state.players.length} jogador(es)`);
        saveState();
        showToast("Backup importado.");
        navigate("dashboard");
      } catch (error) {
        console.error(error);
        showToast("Arquivo de backup inválido.", "error");
      } finally {
        dom.importFile.value = "";
      }
    });
    reader.readAsText(file);
  }

  async function resetData() {
    if (!requireAdmin()) return;
    const confirmed = await askConfirm(
      "Restaurar dados iniciais?",
      "Todos os jogadores, placares e configurações atuais serão substituídos pela lista original.",
      "Restaurar tudo",
    );
    if (!confirmed) return;
    state = createDefaultState();
    saveState();
    showToast("Dados iniciais restaurados.");
    navigate("dashboard");
  }

  function dataUrlByteSize(dataUrl) {
    const encoded = String(dataUrl).split(",")[1] || "";
    return Math.ceil(encoded.length * 0.75);
  }

  function canvasDataUrl(canvas, quality) {
    return canvas.toDataURL("image/webp", quality);
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () => resolve(String(reader.result || "")));
      reader.addEventListener("error", () => reject(new Error("Não foi possível ler a imagem escolhida.")));
      reader.readAsDataURL(file);
    });
  }

  async function optimizeNewsImage(file) {
    if (!file) return "";
    if (!file.type.startsWith("image/")) throw new Error("Escolha um arquivo de imagem válido.");
    const source = await readFileAsDataUrl(file);
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("Não foi possível abrir a imagem escolhida."));
      image.src = source;
    });
    const scale = Math.min(1, 1600 / image.naturalWidth, 1000 / image.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    let quality = 0.84;
    let result = canvasDataUrl(canvas, quality);
    while (dataUrlByteSize(result) > MAX_NEWS_IMAGE_BYTES && quality > 0.5) {
      quality -= 0.08;
      result = canvasDataUrl(canvas, quality);
    }
    if (dataUrlByteSize(result) > MAX_NEWS_IMAGE_BYTES) {
      throw new Error("A imagem ainda ficou muito grande. Escolha uma foto menor.");
    }
    return result;
  }

  async function saveNews(form) {
    if (!requireAdmin()) return;
    const button = form.querySelector('button[type="submit"]');
    const status = form.querySelector("#news-form-status");
    const formData = new FormData(form);
    button.disabled = true;
    status.textContent = "Preparando publicação...";
    try {
      const imageFile = formData.get("image");
      const imageData = imageFile instanceof File && imageFile.size ? await optimizeNewsImage(imageFile) : "";
      const date = new Date(String(formData.get("publishedAt") || ""));
      if (Number.isNaN(date.getTime())) throw new Error("Informe uma data de publicação válida.");
      const payload = {
        id: String(formData.get("id") || "") || undefined,
        title: String(formData.get("title") || "").trim(),
        summary: String(formData.get("summary") || "").trim(),
        body: String(formData.get("body") || "").trim(),
        category: String(formData.get("category") || "").trim(),
        author: String(formData.get("author") || "").trim(),
        publishedAt: date.toISOString(),
        status: String(formData.get("status") || "draft"),
        featured: formData.get("featured") === "on",
        imageAlt: String(formData.get("imageAlt") || "").trim(),
        videoUrl: String(formData.get("videoUrl") || "").trim(),
        imageData,
      };
      status.textContent = "Salvando no banco...";
      const response = await fetch("/api/news", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Não foi possível salvar a notícia.");
      await readNewsFromServer();
      ui.editingNewsId = null;
      logActivity("news", payload.id ? "Notícia atualizada" : "Notícia publicada", payload.title);
      saveState();
      showToast(payload.status === "draft" ? "Rascunho salvo." : "Notícia publicada no site.");
      render();
    } catch (error) {
      console.error("Erro ao salvar notícia.", error);
      status.textContent = error.message;
      showToast(error.message, "error");
      button.disabled = false;
    }
  }

  async function previewNews() {
    const form = document.querySelector("#news-form");
    if (!form || !dom.newsPreviewDialog || !dom.newsPreviewContent) return;
    const values = new FormData(form);
    const body = String(values.get("body") || "").trim();
    const file = values.get("image");
    let imageUrl = newsItems.find((article) => article.id === String(values.get("id") || ""))?.imageUrl || "";
    if (file instanceof File && file.size) imageUrl = await readFileAsDataUrl(file);
    const paragraphs = body.split(/\n{2,}/).filter(Boolean).map((item) => `<p>${escapeHTML(item.replace(/\s*\n\s*/g, " "))}</p>`).join("");
    dom.newsPreviewContent.innerHTML = `<article class="news-preview-article">
      <span class="news-category">${escapeHTML(String(values.get("category") || "Campeonato"))}</span>
      <h1>${escapeHTML(String(values.get("title") || "Título da notícia"))}</h1>
      <p class="news-preview-summary">${escapeHTML(String(values.get("summary") || "O resumo aparecerá aqui."))}</p>
      <div class="news-preview-meta">Por ${escapeHTML(String(values.get("author") || "Organização"))}</div>
      ${imageUrl ? `<img src="${escapeHTML(imageUrl)}" alt="${escapeHTML(String(values.get("imageAlt") || ""))}">` : ""}
      <div class="news-article-body">${paragraphs || "<p>O texto completo aparecerá aqui.</p>"}</div>
    </article>`;
    dom.newsPreviewDialog.showModal();
  }

  async function deleteNews(articleId) {
    if (!requireAdmin()) return;
    const article = newsItems.find((item) => item.id === articleId);
    if (!article) return;
    const confirmed = await askConfirm(
      "Excluir esta notícia?",
      `“${article.title}” será removida do site e não poderá ser recuperada.`,
      "Excluir notícia",
    );
    if (!confirmed) return;
    const response = await fetch(`/api/news?id=${encodeURIComponent(articleId)}`, { method: "DELETE" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      showToast(result.error || "Não foi possível excluir a notícia.", "error");
      return;
    }
    await readNewsFromServer();
    if (ui.editingNewsId === articleId) ui.editingNewsId = null;
    logActivity("news", "Notícia excluída", article.title);
    saveState();
    showToast("Notícia excluída.");
    render();
  }

  async function shareNews() {
    const article = newsItems.find((item) => item.id === ui.selectedNewsId);
    const shareData = { title: article?.title || "Sinuca da Firma", text: article?.summary || "", url: window.location.href };
    try {
      if (navigator.share) await navigator.share(shareData);
      else {
        await navigator.clipboard.writeText(window.location.href);
        showToast("Link da notícia copiado.");
      }
    } catch (error) {
      if (error.name !== "AbortError") showToast("Não foi possível compartilhar agora.", "error");
    }
  }

  function applyNewsEngagement(articleId, payload) {
    newsEngagement[articleId] = payload;
    const article = newsItems.find((item) => item.id === articleId);
    if (!article) return;
    article.commentCount = Array.isArray(payload.comments) ? payload.comments.length : 0;
    article.ratingCount = Number(payload.rating?.count) || 0;
    article.ratingAverage = Number(payload.rating?.average) || 0;
  }

  async function loadAndShowNewsEngagement(articleId) {
    try {
      const payload = await readNewsEngagement(articleId);
      applyNewsEngagement(articleId, payload);
      render();
    } catch (error) {
      console.error("Erro ao carregar comentários.", error);
      showToast(error.message, "error");
    }
  }

  async function submitNewsComment(form) {
    const formData = new FormData(form);
    const articleId = String(formData.get("articleId") || "");
    const button = form.querySelector('button[type="submit"]');
    const status = form.querySelector("#news-comment-status");
    button.disabled = true;
    status.textContent = "Publicando...";
    try {
      const response = await fetch("/api/news/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-News-Visitor": newsVisitorId() },
        body: JSON.stringify({
          articleId,
          author: String(formData.get("author") || "").trim(),
          body: String(formData.get("body") || "").trim(),
          website: String(formData.get("website") || ""),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível publicar o comentário.");
      applyNewsEngagement(articleId, payload);
      showToast("Comentário publicado.");
      render();
      document.querySelector("#news-comments")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      status.textContent = error.message;
      showToast(error.message, "error");
      button.disabled = false;
    }
  }

  async function rateNews(articleId, score) {
    try {
      const response = await fetch("/api/news/ratings", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-News-Visitor": newsVisitorId() },
        body: JSON.stringify({ articleId, score }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível salvar sua avaliação.");
      applyNewsEngagement(articleId, payload);
      showToast(`Avaliação de ${score} estrela${score === 1 ? "" : "s"} salva.`);
      render();
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  async function reportNewsComment(commentId) {
    const confirmed = await askConfirm(
      "Denunciar este comentário?",
      "A organização receberá a denúncia para revisar o conteúdo. Use este recurso para ataques, exposição de dados, discriminação ou conteúdo ofensivo.",
      "Enviar denúncia",
    );
    if (!confirmed) return;
    try {
      const response = await fetch("/api/news/comments/report", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-News-Visitor": newsVisitorId() },
        body: JSON.stringify({ commentId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível enviar a denúncia.");
      showToast(payload.alreadyReported ? "Este comentário já havia sido denunciado por você." : "Denúncia enviada à organização.");
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  async function toggleNewsModeration(articleId) {
    if (ui.moderatingNewsId === articleId) {
      ui.moderatingNewsId = null;
      render();
      return;
    }
    ui.moderatingNewsId = articleId;
    render();
    await loadAndShowNewsEngagement(articleId);
  }

  async function deleteNewsComment(commentId, articleId) {
    if (!requireAdmin()) return;
    const confirmed = await askConfirm(
      "Excluir este comentário?",
      "O comentário será removido definitivamente da notícia.",
      "Excluir comentário",
    );
    if (!confirmed) return;
    const comment = newsEngagement[articleId]?.comments?.find((item) => item.id === commentId);
    const response = await fetch(`/api/news/comments?id=${encodeURIComponent(commentId)}`, { method: "DELETE" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      showToast(payload.error || "Não foi possível excluir o comentário.", "error");
      return;
    }
    await Promise.all([readNewsFromServer(), readNewsEngagement(articleId)]);
    logActivity("news", "Comentário removido na moderação", comment ? `${comment.author}: ${comment.body.slice(0, 80)}` : articleId);
    saveState();
    showToast("Comentário excluído.");
    render();
  }

  async function handleAction(button) {
    const action = button.dataset.action;
    if (!action) return;
    if (ADMIN_ACTIONS.has(action) && !requireAdmin()) return;

    switch (action) {
      case "navigate":
        navigate(button.dataset.view);
        break;
      case "navigate-public-ranking":
        navigateToPublicLeagueRanking();
        break;
      case "generate-league":
        await generateLeague();
        break;
      case "generate-draw":
        await generateDraw();
        break;
      case "open-score":
        openScoreDialog(button.dataset.matchId, button.dataset.matchKind || "bracket");
        break;
      case "toggle-match-live":
        await toggleLeagueMatchLive(button.dataset.matchId);
        break;
      case "edit-player":
        startPlayerEdit(button.dataset.playerId);
        break;
      case "cancel-player-edit":
        ui.editingPlayerId = null;
        render();
        break;
      case "delete-player":
        await deletePlayer(button.dataset.playerId);
        break;
      case "print-bracket":
        window.print();
        break;
      case "export-data":
        exportData();
        break;
      case "import-data":
        dom.importFile.click();
        break;
      case "reset-data":
        await resetData();
        break;
      case "open-news":
        ui.selectedNewsId = button.dataset.newsId;
        window.history.pushState(null, "", `${window.location.pathname}${window.location.search}#news/${encodeURIComponent(ui.selectedNewsId)}`);
        render();
        if (!newsEngagement[ui.selectedNewsId]) await loadAndShowNewsEngagement(ui.selectedNewsId);
        window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
        break;
      case "close-news":
        ui.selectedNewsId = null;
        navigate("news");
        break;
      case "share-news":
        await shareNews();
        break;
      case "preview-news":
        await previewNews();
        break;
      case "report-news-comment":
        await reportNewsComment(button.dataset.commentId);
        break;
      case "edit-news":
        ui.editingNewsId = button.dataset.newsId;
        render();
        window.scrollTo({ top: 0, behavior: "smooth" });
        break;
      case "cancel-news-edit":
        ui.editingNewsId = null;
        render();
        break;
      case "delete-news":
        await deleteNews(button.dataset.newsId);
        break;
      case "reload-news-engagement":
        await loadAndShowNewsEngagement(button.dataset.newsId);
        break;
      case "retry-news":
        newsLoading = true;
        newsError = "";
        render();
        try {
          await readNewsFromServer();
        } catch (error) {
          newsError = "Não foi possível buscar as notícias agora.";
        }
        newsLoading = false;
        render();
        break;
      case "rate-news":
        await rateNews(button.dataset.newsId, Number(button.dataset.score));
        break;
      case "moderate-news":
        await toggleNewsModeration(button.dataset.newsId);
        break;
      case "delete-news-comment":
        await deleteNewsComment(button.dataset.commentId, button.dataset.newsId);
        break;
      default:
        break;
    }
  }

  document.addEventListener("click", (event) => {
    const navButton = event.target.closest(".nav-item");
    if (navButton) {
      navigate(navButton.dataset.view);
      return;
    }

    const actionButton = event.target.closest("[data-action]");
    if (actionButton && !actionButton.disabled) {
      handleAction(actionButton);
    }
  });

  dom.content.addEventListener("submit", (event) => {
    if (event.target.matches("#add-player-form")) {
      event.preventDefault();
      if (requireAdmin()) addPlayer(event.target);
    }
    if (event.target.matches("#settings-form")) {
      event.preventDefault();
      if (requireAdmin()) saveSettings(event.target);
    }
    if (event.target.matches("#news-form")) {
      event.preventDefault();
      if (requireAdmin()) saveNews(event.target);
    }
    if (event.target.matches("#news-comment-form")) {
      event.preventDefault();
      submitNewsComment(event.target);
    }
    if (event.target.matches(".inline-player-form")) {
      event.preventDefault();
      savePlayerEdit(event.target);
    }
    if (event.target.matches(".quick-score-form")) {
      event.preventDefault();
      saveQuickLeagueScore(event.target);
    }
  });

  dom.content.addEventListener("input", (event) => {
    if (event.target.matches("#player-search")) {
      ui.playerSearch = event.target.value;
      const position = event.target.selectionStart;
      render();
      const refreshed = document.querySelector("#player-search");
      refreshed?.focus();
      refreshed?.setSelectionRange(position, position);
    }
  });

  dom.content.addEventListener("change", (event) => {
    if (event.target.matches("#match-filter")) {
      ui.matchFilter = event.target.value;
      render();
    }
    if (event.target.matches("#league-round-filter")) {
      ui.leagueRoundFilter = event.target.value;
      render();
    }
    if (event.target.matches("#league-match-filter")) {
      ui.leagueMatchFilter = event.target.value;
      render();
    }
    if (event.target.matches("#settings-score-mode")) {
      const input = document.querySelector('[name="framesToWin"]');
      if (input) input.disabled = event.target.value === "points";
    }
  });

  dom.menuButton.addEventListener("click", openMenu);
  dom.drawerBackdrop.addEventListener("click", closeMenu);
  dom.quickDraw.addEventListener("click", () => {
    if (state.league) navigate("league");
    else if (requireAdmin()) generateLeague();
  });
  dom.quickExport.addEventListener("click", exportData);
  dom.authActions?.addEventListener("click", (event) => {
    if (event.target.closest("#logout-button")) logoutAdmin();
  });
  dom.scoreForm.addEventListener("submit", saveScoreFromDialog);
  document.querySelectorAll("[data-close-score-dialog]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      closeScoreDialog();
    });
  });
  document.querySelectorAll("[data-close-confirm-dialog]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      closeConfirmDialog();
    });
  });
  document.querySelectorAll("[data-close-news-preview]").forEach((button) => {
    button.addEventListener("click", () => dom.newsPreviewDialog?.close());
  });
  dom.scoreDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeScoreDialog();
  });
  dom.confirmDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeConfirmDialog();
  });
  dom.deleteScore.addEventListener("click", deleteScoreFromDialog);
  dom.confirmDialog.addEventListener("close", resolveConfirmation);
  dom.importFile.addEventListener("change", () => {
    if (requireAdmin()) importData(dom.importFile.files?.[0]);
    else dom.importFile.value = "";
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenu();
    if (dom.scoreDialog.open && event.ctrlKey && event.key === "Enter") {
      event.preventDefault();
      dom.scoreForm.requestSubmit(dom.scoreForm.querySelector('[name="score-continuation"][value="next"]'));
    }
  });

  window.addEventListener("popstate", async () => {
    const parts = window.location.hash.slice(1).split("/");
    const requested = parts[0] || "dashboard";
    const allowed = VIEW_META[requested] && !HIDDEN_VIEWS.has(requested) && (isAdmin() || ["dashboard", "league", "league-ranking", "news"].includes(requested));
    ui.currentView = allowed ? requested : "dashboard";
    ui.selectedNewsId = requested === "news" && parts[1] ? decodeURIComponent(parts.slice(1).join("/")) : null;
    render();
    if (ui.selectedNewsId && !newsEngagement[ui.selectedNewsId]) await loadAndShowNewsEngagement(ui.selectedNewsId);
    window.scrollTo({ top: 0, behavior: "auto" });
  });

  initializeApp();
})();

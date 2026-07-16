(function initSinucaExpansionDomain(root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SinucaExpansionDomain = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createSinucaExpansionDomain() {
  "use strict";

  const PROGRAMMING_STATUSES = Object.freeze(["unscheduled", "scheduled", "postponed", "cancelled"]);
  const AVAILABILITY_STATUSES = Object.freeze(["available", "maybe", "unavailable", "unknown"]);
  const MAX_FEATURED_MATCHES = 3;
  const MAX_BALLS_PER_PLAYER = 8;
  const CARD_FORMATS = Object.freeze({
    square: Object.freeze({ id: "square", width: 1080, height: 1080, ratio: "1:1", name: "Quadrado" }),
    vertical: Object.freeze({ id: "vertical", width: 1080, height: 1350, ratio: "4:5", name: "Vertical" }),
    horizontal: Object.freeze({ id: "horizontal", width: 1600, height: 900, ratio: "16:9", name: "Horizontal" }),
  });

  const PROGRAMMING_STATUS_ALIASES = Object.freeze({
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
  });

  const AVAILABILITY_STATUS_ALIASES = Object.freeze({
    available: "available",
    disponivel: "available",
    livre: "available",
    yes: "available",
    sim: "available",
    maybe: "maybe",
    talvez: "maybe",
    uncertain: "maybe",
    indefinido: "maybe",
    unavailable: "unavailable",
    indisponivel: "unavailable",
    ocupado: "unavailable",
    no: "unavailable",
    nao: "unavailable",
    unknown: "unknown",
    uninformed: "unknown",
    "not-informed": "unknown",
    "nao-informado": "unknown",
  });

  const CARD_TYPE_ALIASES = Object.freeze({
    next: "next-match",
    "next-match": "next-match",
    featured: "featured-match",
    "featured-match": "featured-match",
    result: "result",
    ranking: "ranking",
    mvp: "mvp",
    champion: "champion",
  });

  function asObject(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  function asArray(value) {
    return Array.isArray(value) ? value : [];
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

  function finiteNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function integer(value, fallback = 0) {
    const number = Number(value);
    return Number.isInteger(number) ? number : fallback;
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function dateValue(value) {
    if (value instanceof Date) {
      const timestamp = value.getTime();
      return Number.isFinite(timestamp) ? timestamp : null;
    }
    if (typeof value !== "string" && typeof value !== "number") return null;
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  function normalizeDateTime(value) {
    if (value instanceof Date) {
      return Number.isFinite(value.getTime()) ? value.toISOString() : null;
    }
    const text = cleanText(value);
    return text && dateValue(text) !== null ? text : null;
  }

  function combineLegacyDateTime(entry) {
    const date = cleanText(entry.date || entry.scheduledDate || entry.dia);
    if (!date) return null;
    const time = cleanText(entry.time || entry.scheduledTime || entry.horario, "00:00");
    const offset = cleanText(entry.offset || entry.timezoneOffset || entry.utcOffset);
    return normalizeDateTime(`${date}T${time.length === 5 ? `${time}:00` : time}${offset}`);
  }

  function resolveState(source) {
    const object = asObject(source);
    return asObject(object.state).league || asObject(object.state).players
      ? asObject(object.state)
      : object;
  }

  function resolveLeague(source) {
    const state = resolveState(source);
    if (asObject(state.league).rounds) return asObject(state.league);
    return state.rounds ? state : {};
  }

  function resolvePlayers(source) {
    return asArray(resolveState(source).players);
  }

  function playerMap(source) {
    return new Map(resolvePlayers(source)
      .filter((player) => player && cleanText(player.id))
      .map((player) => [String(player.id), { ...player, id: String(player.id) }]));
  }

  function playerName(source, playerId, fallback = "Jogador removido") {
    return cleanText(playerMap(source).get(String(playerId))?.name, fallback);
  }

  function normalizeBallCount(value) {
    return clamp(integer(value, 0), 0, MAX_BALLS_PER_PLAYER);
  }

  function normalizeResult(match, result) {
    if (!match || !result || typeof result !== "object") return null;
    const playerAId = String(match.playerAId || "");
    const playerBId = String(match.playerBId || "");
    const resultPlayerA = cleanText(result.playerAId, playerAId);
    const resultPlayerB = cleanText(result.playerBId, playerBId);
    const winnerId = cleanText(result.winnerId || result.winner || result.vencedorId);
    if (resultPlayerA !== playerAId || resultPlayerB !== playerBId) return null;
    if (winnerId !== playerAId && winnerId !== playerBId) return null;

    let scoreA = Number(result.scoreA);
    let scoreB = Number(result.scoreB);
    if (!Number.isFinite(scoreA) || !Number.isFinite(scoreB) || scoreA === scoreB) {
      scoreA = winnerId === playerAId ? 1 : 0;
      scoreB = winnerId === playerBId ? 1 : 0;
    }

    return {
      ...result,
      playerAId,
      playerBId,
      winnerId,
      scoreA,
      scoreB,
      ballsA: normalizeBallCount(result.ballsA),
      ballsB: normalizeBallCount(result.ballsB),
      playedAt: normalizeDateTime(result.playedAt || result.completedAt || result.recordedAt),
    };
  }

  function flattenMatches(source) {
    const league = resolveLeague(source);
    const results = asObject(league.results);
    const inProgress = asObject(league.inProgress);
    const flattened = [];
    const seenIds = new Set();

    asArray(league.rounds).forEach((round, roundIndex) => {
      const roundNumber = finiteNumber(round?.number, roundIndex + 1);
      asArray(round?.matches).forEach((match, matchIndex) => {
        if (!match || !cleanText(match.id)) return;
        const id = String(match.id);
        if (seenIds.has(id)) return;
        seenIds.add(id);
        const normalized = {
          ...match,
          id,
          playerAId: cleanText(match.playerAId),
          playerBId: cleanText(match.playerBId),
          roundNumber,
          roundIndex,
          matchIndex,
          orderIndex: flattened.length,
          roundName: cleanText(round?.name, `Liga · Rodada ${roundNumber}`),
        };
        normalized.hasPlayers = Boolean(
          normalized.playerAId &&
          normalized.playerBId &&
          normalized.playerAId !== normalized.playerBId
        );
        normalized.result = normalizeResult(normalized, results[id] || match.result);
        normalized.completed = Boolean(normalized.result);
        normalized.inProgress = !normalized.completed && Boolean(inProgress[id] || match.inProgress);
        normalized.playedAt = normalized.result?.playedAt || null;
        flattened.push(normalized);
      });
    });

    if (!flattened.length && Array.isArray(league.matches)) {
      league.matches.forEach((match, matchIndex) => {
        if (!match || !cleanText(match.id) || seenIds.has(String(match.id))) return;
        const id = String(match.id);
        seenIds.add(id);
        const normalized = {
          ...match,
          id,
          playerAId: cleanText(match.playerAId),
          playerBId: cleanText(match.playerBId),
          roundNumber: finiteNumber(match.roundNumber || match.round, 1),
          roundIndex: integer(match.roundIndex, 0),
          matchIndex,
          orderIndex: flattened.length,
          roundName: cleanText(match.roundName, `Liga · Rodada ${finiteNumber(match.roundNumber || match.round, 1)}`),
        };
        normalized.hasPlayers = Boolean(
          normalized.playerAId &&
          normalized.playerBId &&
          normalized.playerAId !== normalized.playerBId
        );
        normalized.result = normalizeResult(normalized, results[id] || match.result);
        normalized.completed = Boolean(normalized.result);
        normalized.inProgress = !normalized.completed && Boolean(inProgress[id] || match.inProgress);
        normalized.playedAt = normalized.result?.playedAt || null;
        flattened.push(normalized);
      });
    }

    return flattened;
  }

  function matchMap(source) {
    return new Map(flattenMatches(source).map((match) => [match.id, match]));
  }

  function findMatchById(source, matchId) {
    const id = cleanText(matchId);
    return id ? matchMap(source).get(id) || null : null;
  }

  function normalizeProgrammingStatus(value, fallback = "unscheduled") {
    return PROGRAMMING_STATUS_ALIASES[normalizeKey(value)] || fallback;
  }

  function normalizeScheduleEntry(value) {
    const entry = typeof value === "string" ? { scheduledAt: value } : asObject(value);
    const scheduledAt = normalizeDateTime(
      entry.scheduledAt ||
      entry.dateTime ||
      entry.startsAt ||
      entry.start ||
      combineLegacyDateTime(entry),
    );
    const inferredStatus = scheduledAt ? "scheduled" : "unscheduled";
    let status = normalizeProgrammingStatus(entry.status || entry.state || entry.situacao, inferredStatus);
    if (status === "scheduled" && !scheduledAt) status = "unscheduled";

    return {
      scheduledAt,
      location: cleanText(entry.location || entry.venue || entry.local),
      status,
      priority: clamp(integer(entry.priority || entry.prioridade, 0), 0, 999),
      note: cleanText(entry.note || entry.internalNote || entry.observation || entry.observacao),
      publicNote: cleanText(entry.publicNote || entry.publicObservation || entry.observacaoPublica),
      updatedAt: normalizeDateTime(entry.updatedAt || entry.changedAt || entry.at),
      updatedBy: cleanText(entry.updatedBy || entry.changedBy || entry.admin || entry.author),
    };
  }

  function scheduleEntries(rawProgramming) {
    const raw = asObject(rawProgramming);
    const source = raw.matches || raw.schedule || raw.scheduledMatches || {};
    if (Array.isArray(source)) {
      return source
        .filter((entry) => entry && cleanText(entry.matchId || entry.id))
        .map((entry) => [String(entry.matchId || entry.id), entry]);
    }
    return Object.entries(asObject(source));
  }

  function eligiblePendingMatch(match) {
    return Boolean(match && match.hasPlayers && !match.completed);
  }

  function normalizeProgramming(rawProgramming, source) {
    const raw = asObject(rawProgramming);
    const matchesById = matchMap(source);
    const matches = {};

    scheduleEntries(raw).forEach(([matchId, entry]) => {
      const id = cleanText(matchId);
      const match = matchesById.get(id);
      if (!eligiblePendingMatch(match)) return;
      matches[id] = normalizeScheduleEntry(entry);
    });

    const candidateNext = cleanText(
      raw.nextMatchId ||
      raw.next_match_id ||
      raw.nextMatch?.id ||
      (typeof raw.nextMatch === "string" ? raw.nextMatch : ""),
    );
    const nextMatch = matchesById.get(candidateNext);
    const nextStatus = matches[candidateNext]?.status;
    const nextMatchId = eligiblePendingMatch(nextMatch) && nextStatus !== "cancelled"
      ? candidateNext
      : null;

    const legacyFeatured = raw.featuredMatchIds || raw.featuredMatches || raw.highlights || [];
    const featuredSource = Array.isArray(legacyFeatured)
      ? legacyFeatured
      : Object.keys(asObject(legacyFeatured)).filter((id) => legacyFeatured[id]);
    const featuredMatchIds = [];
    featuredSource.forEach((value) => {
      const id = cleanText(value?.id || value?.matchId || value);
      const match = matchesById.get(id);
      if (
        featuredMatchIds.length < MAX_FEATURED_MATCHES &&
        !featuredMatchIds.includes(id) &&
        eligiblePendingMatch(match) &&
        matches[id]?.status !== "cancelled"
      ) {
        featuredMatchIds.push(id);
      }
    });

    return { nextMatchId, featuredMatchIds, matches };
  }

  function normalizeAvailabilityStatus(value, fallback = "unknown") {
    if (typeof value === "boolean") return value ? "available" : "unavailable";
    return AVAILABILITY_STATUS_ALIASES[normalizeKey(value)] || fallback;
  }

  function normalizeAvailabilityEntry(value, playerId, index = 0) {
    const entry = typeof value === "string" || typeof value === "boolean"
      ? { status: value }
      : asObject(value);
    let startsAt = normalizeDateTime(entry.startsAt || entry.start || entry.from || entry.inicio);
    let endsAt = normalizeDateTime(entry.endsAt || entry.end || entry.to || entry.fim);
    if (startsAt && endsAt && dateValue(startsAt) > dateValue(endsAt)) {
      [startsAt, endsAt] = [endsAt, startsAt];
    }
    return {
      id: cleanText(entry.id, `availability-${playerId}-${index + 1}`),
      status: normalizeAvailabilityStatus(entry.status ?? entry.state ?? entry.available),
      startsAt,
      endsAt,
      note: cleanText(entry.note || entry.observation || entry.observacao),
      updatedAt: normalizeDateTime(entry.updatedAt || entry.changedAt || entry.at),
      updatedBy: cleanText(entry.updatedBy || entry.changedBy || entry.admin || entry.author),
    };
  }

  function normalizeAvailability(rawAvailability, source) {
    const knownPlayerIds = new Set(resolvePlayers(source).map((player) => String(player.id)));
    const hasKnownPlayers = knownPlayerIds.size > 0;
    const grouped = {};
    const raw = rawAvailability || {};

    if (Array.isArray(raw)) {
      raw.forEach((entry) => {
        const playerId = cleanText(entry?.playerId || entry?.player_id);
        if (!playerId || (hasKnownPlayers && !knownPlayerIds.has(playerId))) return;
        if (!grouped[playerId]) grouped[playerId] = [];
        grouped[playerId].push(entry);
      });
    } else {
      Object.entries(asObject(raw)).forEach(([playerId, entries]) => {
        if (hasKnownPlayers && !knownPlayerIds.has(playerId)) return;
        grouped[playerId] = Array.isArray(entries) ? entries : [entries];
      });
    }

    const normalized = {};
    Object.entries(grouped).forEach(([playerId, entries]) => {
      const usedIds = new Set();
      normalized[playerId] = entries.map((entry, index) => {
        const item = normalizeAvailabilityEntry(entry, playerId, index);
        let id = item.id;
        let suffix = 2;
        while (usedIds.has(id)) {
          id = `${item.id}-${suffix}`;
          suffix += 1;
        }
        usedIds.add(id);
        return { ...item, id };
      }).sort((a, b) => {
        const timeA = dateValue(a.startsAt);
        const timeB = dateValue(b.startsAt);
        if (timeA === null && timeB !== null) return -1;
        if (timeA !== null && timeB === null) return 1;
        return (timeA || 0) - (timeB || 0) || a.id.localeCompare(b.id, "pt-BR");
      });
    });
    return normalized;
  }

  function validationResult(errors, warnings, extra = {}) {
    return {
      valid: errors.length === 0,
      blocking: errors.length > 0,
      errors,
      warnings,
      ...extra,
    };
  }

  function validateNextMatch(matchId, source, programming) {
    const errors = [];
    const warnings = [];
    const match = findMatchById(source, matchId);
    if (!cleanText(matchId)) errors.push({ code: "MATCH_REQUIRED", message: "Escolha uma partida." });
    else if (!match) errors.push({ code: "MATCH_NOT_FOUND", message: "A partida escolhida não existe mais." });
    else {
      if (!match.hasPlayers) errors.push({ code: "PLAYERS_REQUIRED", message: "A partida precisa ter dois jogadores definidos." });
      if (match.completed) errors.push({ code: "MATCH_COMPLETED", message: "Uma partida concluída não pode ser o próximo jogo." });
      const schedule = normalizeProgramming(programming || resolveLeague(source).programming, source).matches[match.id];
      if (schedule?.status === "cancelled") errors.push({ code: "MATCH_CANCELLED", message: "Uma partida cancelada não pode ser o próximo jogo." });
      if (schedule?.status === "postponed") warnings.push({ code: "MATCH_POSTPONED", message: "A partida está marcada como adiada." });
      if (!schedule?.scheduledAt) warnings.push({ code: "DATE_NOT_SET", message: "O próximo jogo ainda não tem data e horário." });
    }
    return validationResult(errors, warnings, { match });
  }

  function validateFeaturedMatches(featuredMatchIds, source, programming) {
    const errors = [];
    const warnings = [];
    const accepted = [];
    const ids = asArray(featuredMatchIds);
    if (ids.length > MAX_FEATURED_MATCHES) {
      errors.push({
        code: "FEATURED_LIMIT",
        message: `Selecione no máximo ${MAX_FEATURED_MATCHES} partidas em destaque.`,
      });
    }
    ids.forEach((value) => {
      const id = cleanText(value?.id || value?.matchId || value);
      if (!id || accepted.includes(id)) return;
      const result = validateNextMatch(id, source, programming);
      const hardErrors = result.errors.filter((error) => error.code !== "MATCH_POSTPONED");
      if (hardErrors.length) errors.push(...hardErrors.map((error) => ({ ...error, matchId: id })));
      else accepted.push(id);
      warnings.push(...result.warnings.map((warning) => ({ ...warning, matchId: id })));
    });
    return validationResult(errors, warnings, {
      featuredMatchIds: accepted.slice(0, MAX_FEATURED_MATCHES),
    });
  }

  function availabilityEntryCovers(entry, timestamp) {
    const start = dateValue(entry.startsAt);
    const end = dateValue(entry.endsAt);
    return (start === null || start <= timestamp) && (end === null || end >= timestamp);
  }

  function availabilityAt(availability, playerId, scheduledAt) {
    const timestamp = dateValue(scheduledAt);
    if (timestamp === null) return { playerId, status: "unknown", entry: null };
    const severity = { unavailable: 3, maybe: 2, available: 1, unknown: 0 };
    const entries = asArray(availability?.[playerId])
      .filter((entry) => availabilityEntryCovers(entry, timestamp))
      .sort((a, b) => {
        return severity[b.status] - severity[a.status]
          || (dateValue(b.updatedAt) || 0) - (dateValue(a.updatedAt) || 0);
      });
    const entry = entries[0] || null;
    return { playerId, status: entry?.status || "unknown", entry };
  }

  function detectAvailabilityConflicts(matchOrId, scheduledAtOrEntry, rawAvailability, source) {
    const match = typeof matchOrId === "string"
      ? findMatchById(source, matchOrId)
      : matchOrId;
    const schedule = typeof scheduledAtOrEntry === "object"
      ? normalizeScheduleEntry(scheduledAtOrEntry)
      : { scheduledAt: normalizeDateTime(scheduledAtOrEntry) };
    const availability = normalizeAvailability(rawAvailability, source);
    const conflicts = [];
    const warnings = [];
    const players = [];

    if (!match) {
      return {
        hasConflicts: false,
        blocking: false,
        conflicts,
        warnings: [{ code: "MATCH_NOT_FOUND", message: "Não foi possível verificar a disponibilidade da partida." }],
        players,
      };
    }
    if (!schedule.scheduledAt) {
      return {
        hasConflicts: false,
        blocking: false,
        conflicts,
        warnings: [{ code: "DATE_NOT_SET", message: "Defina data e horário para verificar a disponibilidade." }],
        players,
      };
    }

    [match.playerAId, match.playerBId].filter(Boolean).forEach((playerId) => {
      const status = availabilityAt(availability, playerId, schedule.scheduledAt);
      players.push(status);
      if (status.status === "unavailable") {
        conflicts.push({
          code: "PLAYER_UNAVAILABLE",
          playerId,
          status: status.status,
          note: status.entry?.note || "",
          message: `${playerName(source, playerId)} está indisponível nesse horário.`,
        });
      } else if (status.status === "maybe") {
        warnings.push({
          code: "PLAYER_MAYBE",
          playerId,
          status: status.status,
          note: status.entry?.note || "",
          message: `${playerName(source, playerId)} marcou disponibilidade como “Talvez”.`,
        });
      } else if (status.status === "unknown") {
        warnings.push({
          code: "AVAILABILITY_UNKNOWN",
          playerId,
          status: status.status,
          message: `${playerName(source, playerId)} não informou disponibilidade para esse horário.`,
        });
      }
    });

    return {
      hasConflicts: conflicts.length > 0,
      blocking: false,
      conflicts,
      warnings,
      players,
    };
  }

  function validateSchedule(matchId, scheduleValue, source, rawAvailability) {
    const errors = [];
    const warnings = [];
    const match = findMatchById(source, matchId);
    const raw = typeof scheduleValue === "string" ? { scheduledAt: scheduleValue } : asObject(scheduleValue);
    const schedule = normalizeScheduleEntry(raw);
    const requestedDate = raw.scheduledAt || raw.dateTime || raw.startsAt || raw.start || combineLegacyDateTime(raw);

    if (!match) errors.push({ code: "MATCH_NOT_FOUND", message: "A partida escolhida não existe mais." });
    else if (!match.hasPlayers) errors.push({ code: "PLAYERS_REQUIRED", message: "A partida precisa ter dois jogadores definidos." });
    else if (match.completed) errors.push({ code: "MATCH_COMPLETED", message: "Partidas concluídas não podem permanecer na agenda futura." });
    if (!PROGRAMMING_STATUSES.includes(schedule.status)) {
      errors.push({ code: "INVALID_STATUS", message: "O estado do agendamento é inválido." });
    }
    if (requestedDate && !schedule.scheduledAt) {
      errors.push({ code: "INVALID_DATE", message: "Informe uma data e horário válidos." });
    }
    if (schedule.status === "scheduled" && !schedule.scheduledAt) {
      errors.push({ code: "DATE_REQUIRED", message: "Partidas agendadas precisam de data e horário." });
    }
    if (schedule.status === "cancelled" && schedule.scheduledAt) {
      warnings.push({ code: "CANCELLED_WITH_DATE", message: "A data será mantida apenas como referência do cancelamento." });
    }
    if (match && schedule.scheduledAt && rawAvailability) {
      const availability = detectAvailabilityConflicts(match, schedule, rawAvailability, source);
      warnings.push(...availability.conflicts, ...availability.warnings);
    }
    return validationResult(errors, warnings, { match, schedule });
  }

  function calendarDayKey(value, timeZone = "America/Sao_Paulo") {
    const timestamp = dateValue(value);
    if (timestamp === null) return "";
    try {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(timestamp));
    } catch (_error) {
      return new Date(timestamp).toISOString().slice(0, 10);
    }
  }

  function sortPublicSchedule(source, rawProgramming, options = {}) {
    const programming = normalizeProgramming(rawProgramming || resolveLeague(source).programming, source);
    const now = normalizeDateTime(options.now) || new Date(0).toISOString();
    const timeZone = cleanText(options.timeZone, "America/Sao_Paulo");
    const includeCompleted = options.includeCompleted !== false;
    const historyLimit = Math.max(0, integer(options.historyLimit, 5));
    const featuredOrder = new Map(programming.featuredMatchIds.map((id, index) => [id, index]));
    const completed = [];
    const pending = [];

    flattenMatches(source).forEach((match) => {
      const schedule = programming.matches[match.id] || normalizeScheduleEntry({});
      if (match.completed) {
        if (includeCompleted) {
          completed.push({
            ...match,
            schedule,
            agendaGroup: "completed",
            agendaOrder: 5,
            isNext: false,
            isFeatured: false,
            isToday: false,
          });
        }
        return;
      }
      if (schedule.status === "cancelled" && options.includeCancelled !== true) return;
      const isNext = programming.nextMatchId === match.id;
      const isFeatured = featuredOrder.has(match.id);
      const isToday = Boolean(schedule.scheduledAt)
        && calendarDayKey(schedule.scheduledAt, timeZone) === calendarDayKey(now, timeZone);
      let agendaGroup = "pending";
      let agendaOrder = 4;
      if (match.inProgress) {
        agendaGroup = "in-progress";
        agendaOrder = 0;
      } else if (isNext) {
        agendaGroup = "next";
        agendaOrder = 1;
      } else if (schedule.scheduledAt) {
        agendaGroup = "scheduled";
        agendaOrder = 2;
      } else if (isFeatured) {
        agendaGroup = "featured";
        agendaOrder = 3;
      }
      pending.push({ ...match, schedule, agendaGroup, agendaOrder, isNext, isFeatured, isToday });
    });

    pending.sort((a, b) => {
      const scheduledA = dateValue(a.schedule.scheduledAt);
      const scheduledB = dateValue(b.schedule.scheduledAt);
      return a.agendaOrder - b.agendaOrder
        || (scheduledA === null ? 1 : 0) - (scheduledB === null ? 1 : 0)
        || (scheduledA || 0) - (scheduledB || 0)
        || (featuredOrder.get(a.id) ?? 999) - (featuredOrder.get(b.id) ?? 999)
        || a.schedule.priority - b.schedule.priority
        || a.roundNumber - b.roundNumber
        || a.matchIndex - b.matchIndex;
    });
    completed.sort((a, b) => {
      return (dateValue(b.playedAt) || 0) - (dateValue(a.playedAt) || 0)
        || b.roundNumber - a.roundNumber
        || b.matchIndex - a.matchIndex;
    });
    return pending.concat(completed.slice(0, historyLimit));
  }

  function partitionPublicSchedule(source, rawProgramming, options = {}) {
    const items = sortPublicSchedule(source, rawProgramming, options);
    return items.reduce((groups, item) => {
      if (!groups[item.agendaGroup]) groups[item.agendaGroup] = [];
      groups[item.agendaGroup].push(item);
      return groups;
    }, {
      "in-progress": [],
      next: [],
      scheduled: [],
      featured: [],
      pending: [],
      completed: [],
    });
  }

  function ballsLeftForPlayer(result, playerId) {
    if (!result || result.winnerId === playerId) return 0;
    const ballsMade = playerId === result.playerAId ? result.ballsA : result.ballsB;
    return Math.max(0, MAX_BALLS_PER_PLAYER - normalizeBallCount(ballsMade));
  }

  function standingsComparator(a, b) {
    return b.points - a.points
      || b.wins - a.wins
      || b.ballBalance - a.ballBalance
      || b.ballsMade - a.ballsMade
      || b.percentage - a.percentage
      || a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" })
      || a.id.localeCompare(b.id);
  }

  function calculateStandings(source, options = {}) {
    const state = resolveState(source);
    const league = resolveLeague(source);
    const players = resolvePlayers(source);
    const known = new Map(players.map((player) => [String(player.id), player]));
    asArray(league.playerIds).forEach((id) => {
      if (!known.has(String(id))) known.set(String(id), { id: String(id), name: `Jogador ${String(id)}` });
    });
    const winPoints = finiteNumber(options.winPoints ?? state.settings?.league?.winPoints, 3);
    const lossPoints = finiteNumber(options.lossPoints ?? state.settings?.league?.lossPoints, 0);
    const rows = new Map([...known.values()].map((player) => [String(player.id), {
      id: String(player.id),
      name: cleanText(player.name, "Jogador sem nome"),
      played: 0,
      wins: 0,
      losses: 0,
      scoreFor: 0,
      scoreAgainst: 0,
      differential: 0,
      ballsMade: 0,
      ballsAgainst: 0,
      ballsLeft: 0,
      ballBalance: 0,
      points: 0,
      percentage: 0,
      position: 0,
    }]));

    flattenMatches(source).filter((match) => match.completed).forEach((match) => {
      const result = match.result;
      const playerA = rows.get(match.playerAId);
      const playerB = rows.get(match.playerBId);
      if (!playerA || !playerB) return;
      playerA.played += 1;
      playerB.played += 1;
      playerA.scoreFor += result.scoreA;
      playerA.scoreAgainst += result.scoreB;
      playerB.scoreFor += result.scoreB;
      playerB.scoreAgainst += result.scoreA;
      playerA.ballsMade += result.ballsA;
      playerB.ballsMade += result.ballsB;
      playerA.ballsAgainst += result.ballsB;
      playerB.ballsAgainst += result.ballsA;
      const ballsLeftA = ballsLeftForPlayer(result, match.playerAId);
      const ballsLeftB = ballsLeftForPlayer(result, match.playerBId);
      playerA.ballsLeft += ballsLeftA;
      playerB.ballsLeft += ballsLeftB;
      if (result.winnerId === match.playerAId) {
        playerA.wins += 1;
        playerB.losses += 1;
        playerA.points += winPoints;
        playerB.points += lossPoints;
        playerA.ballBalance += ballsLeftB;
        playerB.ballBalance -= ballsLeftB;
      } else {
        playerB.wins += 1;
        playerA.losses += 1;
        playerB.points += winPoints;
        playerA.points += lossPoints;
        playerB.ballBalance += ballsLeftA;
        playerA.ballBalance -= ballsLeftA;
      }
    });

    rows.forEach((row) => {
      row.differential = row.scoreFor - row.scoreAgainst;
      row.percentage = row.played ? Math.round((row.wins / row.played) * 1000) / 10 : 0;
    });
    return [...rows.values()].sort(standingsComparator).map((row, index) => ({
      ...row,
      position: index + 1,
    }));
  }

  function chronologicalCompletedMatches(source) {
    return flattenMatches(source).filter((match) => match.completed).sort((a, b) => {
      const timeA = dateValue(a.playedAt);
      const timeB = dateValue(b.playedAt);
      if (timeA !== null && timeB !== null && timeA !== timeB) return timeA - timeB;
      if (timeA !== null && timeB === null) return -1;
      if (timeA === null && timeB !== null) return 1;
      return a.roundNumber - b.roundNumber || a.matchIndex - b.matchIndex || a.orderIndex - b.orderIndex;
    });
  }

  function calculatePlayerStats(source, playerId, options = {}) {
    const id = cleanText(playerId);
    const standing = calculateStandings(source, options).find((row) => row.id === id) || null;
    const matches = chronologicalCompletedMatches(source).filter((match) => {
      return match.playerAId === id || match.playerBId === id;
    });
    let currentType = null;
    let currentLength = 0;
    let maxWinStreak = 0;
    let maxLossStreak = 0;
    let winRun = 0;
    let lossRun = 0;
    const detailed = matches.map((match) => {
      const won = match.result.winnerId === id;
      const opponentId = match.playerAId === id ? match.playerBId : match.playerAId;
      if (won) {
        winRun += 1;
        lossRun = 0;
        maxWinStreak = Math.max(maxWinStreak, winRun);
      } else {
        lossRun += 1;
        winRun = 0;
        maxLossStreak = Math.max(maxLossStreak, lossRun);
      }
      return {
        matchId: match.id,
        roundNumber: match.roundNumber,
        playedAt: match.playedAt,
        opponentId,
        opponentName: playerName(source, opponentId),
        won,
        symbol: won ? "V" : "D",
        scoreFor: match.playerAId === id ? match.result.scoreA : match.result.scoreB,
        scoreAgainst: match.playerAId === id ? match.result.scoreB : match.result.scoreA,
        ballsMade: match.playerAId === id ? match.result.ballsA : match.result.ballsB,
        ballsAgainst: match.playerAId === id ? match.result.ballsB : match.result.ballsA,
      };
    });
    for (let index = detailed.length - 1; index >= 0; index -= 1) {
      const type = detailed[index].won ? "win" : "loss";
      if (currentType === null) currentType = type;
      if (type !== currentType) break;
      currentLength += 1;
    }
    const recentLimit = Math.max(1, integer(options.recentLimit, 5));
    const recentMatches = detailed.slice(-recentLimit);
    return {
      playerId: id,
      name: standing?.name || playerName(source, id),
      standing,
      currentStreak: { type: currentType, length: currentLength },
      maxWinStreak,
      maxLossStreak,
      form: recentMatches.map((match) => match.symbol),
      recentMatches,
      allMatches: detailed,
    };
  }

  function calculateHeadToHead(source, playerAId, playerBId) {
    const playerA = cleanText(playerAId);
    const playerB = cleanText(playerBId);
    const matches = chronologicalCompletedMatches(source).filter((match) => {
      return (match.playerAId === playerA && match.playerBId === playerB)
        || (match.playerAId === playerB && match.playerBId === playerA);
    });
    const wins = { [playerA]: 0, [playerB]: 0 };
    const ballsMade = { [playerA]: 0, [playerB]: 0 };
    matches.forEach((match) => {
      wins[match.result.winnerId] = (wins[match.result.winnerId] || 0) + 1;
      ballsMade[match.playerAId] = (ballsMade[match.playerAId] || 0) + match.result.ballsA;
      ballsMade[match.playerBId] = (ballsMade[match.playerBId] || 0) + match.result.ballsB;
    });
    const leaderId = wins[playerA] === wins[playerB]
      ? null
      : wins[playerA] > wins[playerB] ? playerA : playerB;
    return {
      playerAId: playerA,
      playerBId: playerB,
      games: matches.length,
      wins,
      ballsMade,
      leaderId,
      tied: matches.length === 0 || wins[playerA] === wins[playerB],
      matches: [...matches].reverse(),
    };
  }

  function matchCompetitiveness(match) {
    if (!match?.completed) return null;
    const loserId = match.result.winnerId === match.playerAId ? match.playerBId : match.playerAId;
    const loserBalls = loserId === match.playerAId ? match.result.ballsA : match.result.ballsB;
    return {
      margin: Math.max(0, MAX_BALLS_PER_PLAYER - loserBalls),
      loserBalls,
      winnerId: match.result.winnerId,
      loserId,
    };
  }

  function calculateEvolutionByRound(source, options = {}) {
    const completed = flattenMatches(source).filter((match) => match.completed);
    const rounds = [...new Set(completed.map((match) => match.roundNumber))].sort((a, b) => a - b);
    if (!rounds.length) return { rounds: [], players: [], textSummary: "Ainda não há resultados para mostrar evolução." };
    const league = resolveLeague(source);
    const cumulativeResults = {};
    const series = new Map(resolvePlayers(source).map((player) => [String(player.id), {
      id: String(player.id),
      name: cleanText(player.name, "Jogador sem nome"),
      positions: [],
    }]));

    rounds.forEach((roundNumber) => {
      completed.filter((match) => match.roundNumber === roundNumber).forEach((match) => {
        cumulativeResults[match.id] = match.result;
      });
      const partialSource = {
        ...resolveState(source),
        league: { ...league, results: { ...cumulativeResults } },
      };
      calculateStandings(partialSource, options).forEach((row) => {
        if (!series.has(row.id)) series.set(row.id, { id: row.id, name: row.name, positions: [] });
        series.get(row.id).positions.push({
          roundNumber,
          position: row.position,
          points: row.points,
          wins: row.wins,
          ballBalance: row.ballBalance,
        });
      });
    });
    return {
      rounds,
      players: [...series.values()],
      textSummary: `Evolução calculada em ${rounds.length} rodada(s), com desempate por pontos, vitórias, saldo e bolas matadas.`,
    };
  }

  function calculateComparison(source, playerAId, playerBId, options = {}) {
    const statsA = calculatePlayerStats(source, playerAId, options);
    const statsB = calculatePlayerStats(source, playerBId, options);
    const h2h = calculateHeadToHead(source, playerAId, playerBId);
    const metrics = [
      ["points", "Pontos"],
      ["wins", "Vitórias"],
      ["percentage", "Aproveitamento"],
      ["ballsMade", "Bolas matadas"],
      ["ballBalance", "Saldo de bolas"],
      ["maxWinStreak", "Maior sequência"],
    ].map(([key, label]) => {
      const valueA = key === "maxWinStreak" ? statsA.maxWinStreak : finiteNumber(statsA.standing?.[key], 0);
      const valueB = key === "maxWinStreak" ? statsB.maxWinStreak : finiteNumber(statsB.standing?.[key], 0);
      return {
        key,
        label,
        playerA: valueA,
        playerB: valueB,
        leaderId: valueA === valueB ? null : valueA > valueB ? statsA.playerId : statsB.playerId,
      };
    });
    return { playerA: statsA, playerB: statsB, headToHead: h2h, metrics };
  }

  function calculateStatistics(source, options = {}) {
    const standings = calculateStandings(source, options);
    const completed = chronologicalCompletedMatches(source);
    const playerStats = standings.map((row) => calculatePlayerStats(source, row.id, options));
    const competitive = completed.map((match) => ({ match, ...matchCompetitiveness(match) }));
    const pairCounts = new Map();
    completed.forEach((match) => {
      const key = [match.playerAId, match.playerBId].sort().join("\u0000");
      if (!pairCounts.has(key)) pairCounts.set(key, { playerIds: key.split("\u0000"), games: 0 });
      pairCounts.get(key).games += 1;
    });
    const frequentHeadToHead = [...pairCounts.values()].sort((a, b) => {
      return b.games - a.games || a.playerIds.join("").localeCompare(b.playerIds.join(""));
    })[0] || null;
    const leaderBy = (key) => [...standings].sort((a, b) => {
      return finiteNumber(b[key]) - finiteNumber(a[key]) || standingsComparator(a, b);
    });
    return {
      totals: {
        players: standings.length,
        matches: flattenMatches(source).length,
        completed: completed.length,
        pending: Math.max(0, flattenMatches(source).length - completed.length),
      },
      standings,
      leaders: {
        wins: leaderBy("wins"),
        ballsMade: leaderBy("ballsMade"),
        ballBalance: leaderBy("ballBalance"),
        percentage: leaderBy("percentage"),
      },
      winStreaks: [...playerStats].sort((a, b) => {
        return b.maxWinStreak - a.maxWinStreak
          || finiteNumber(b.standing?.wins) - finiteNumber(a.standing?.wins)
          || a.name.localeCompare(b.name, "pt-BR");
      }),
      evolution: calculateEvolutionByRound(source, options),
      balancedMatches: [...competitive].sort((a, b) => {
        return a.margin - b.margin || (dateValue(b.match.playedAt) || 0) - (dateValue(a.match.playedAt) || 0);
      }),
      biggestWins: [...competitive].sort((a, b) => {
        return b.margin - a.margin || (dateValue(b.match.playedAt) || 0) - (dateValue(a.match.playedAt) || 0);
      }),
      frequentHeadToHead,
      recentPerformance: playerStats.map((stats) => ({
        playerId: stats.playerId,
        name: stats.name,
        form: stats.form,
        currentStreak: stats.currentStreak,
      })),
    };
  }

  function calculatePlayerForm(source, playerId, options = {}) {
    return calculatePlayerStats(source, playerId, options).form;
  }

  function calculatePlayerStreaks(source, playerId, options = {}) {
    const stats = calculatePlayerStats(source, playerId, options);
    return {
      current: stats.currentStreak,
      maxWinStreak: stats.maxWinStreak,
      maxLossStreak: stats.maxLossStreak,
    };
  }

  function findBalancedMatches(source, options = {}) {
    return calculateStatistics(source, options).balancedMatches;
  }

  function findBiggestWins(source, options = {}) {
    return calculateStatistics(source, options).biggestWins;
  }

  function formatDatePt(value, options = {}) {
    const timestamp = dateValue(value);
    if (timestamp === null) return "data a definir";
    try {
      return new Intl.DateTimeFormat("pt-BR", {
        timeZone: cleanText(options.timeZone, "America/Sao_Paulo"),
        dateStyle: options.dateStyle || "long",
        ...(options.withTime === false ? {} : { timeStyle: options.timeStyle || "short" }),
      }).format(new Date(timestamp));
    } catch (_error) {
      return new Date(timestamp).toISOString();
    }
  }

  function newsBase(type, source, match, options = {}) {
    const playerIds = match ? [match.playerAId, match.playerBId].filter(Boolean) : [];
    return {
      type,
      status: "draft",
      featured: false,
      author: cleanText(options.author, "Redação Sinuca da Firma"),
      category: cleanText(options.category),
      publishedAt: normalizeDateTime(options.now || match?.playedAt || match?.schedule?.scheduledAt),
      associations: {
        matchId: match?.id || null,
        playerIds,
        roundNumber: match?.roundNumber || null,
      },
      automation: {
        generated: true,
        requiresConfirmation: true,
        source: "expansion-domain",
      },
    };
  }

  function generateResultNewsDraft(source, matchOrId, options = {}) {
    const match = typeof matchOrId === "string" ? findMatchById(source, matchOrId) : matchOrId;
    if (!match?.completed) return null;
    const winnerId = match.result.winnerId;
    const loserId = winnerId === match.playerAId ? match.playerBId : match.playerAId;
    const winner = playerName(source, winnerId);
    const loser = playerName(source, loserId);
    const winnerBalls = winnerId === match.playerAId ? match.result.ballsA : match.result.ballsB;
    const loserBalls = loserId === match.playerAId ? match.result.ballsA : match.result.ballsB;
    const round = `rodada ${match.roundNumber}`;
    return {
      ...newsBase("result", source, match, { ...options, category: options.category || "Resultados" }),
      title: `${winner} vence ${loser} pela ${round}`,
      summary: `${winner} confirmou a vitória por 1 a 0, com ${winnerBalls} a ${loserBalls} em bolas matadas.`,
      body: `${winner} venceu ${loser} em confronto válido pela ${round} da liga.\n\n`
        + `O placar oficial foi 1 a 0. Nas bolas matadas, o duelo terminou ${winnerBalls} a ${loserBalls}.\n\n`
        + "O resultado já está refletido na classificação oficial do campeonato.",
    };
  }

  function generateScheduleNewsDraft(source, matchOrId, programming, options = {}) {
    const match = typeof matchOrId === "string" ? findMatchById(source, matchOrId) : matchOrId;
    if (!match || match.completed) return null;
    const normalized = normalizeProgramming(programming || resolveLeague(source).programming, source);
    const schedule = normalized.matches[match.id] || normalizeScheduleEntry(options.schedule);
    const playerA = playerName(source, match.playerAId);
    const playerB = playerName(source, match.playerBId);
    const date = formatDatePt(schedule.scheduledAt, options);
    const location = schedule.location ? `, em ${schedule.location}` : "";
    return {
      ...newsBase("schedule", source, { ...match, schedule }, { ...options, category: options.category || "Agenda" }),
      title: `${playerA} e ${playerB} têm confronto marcado`,
      summary: `A partida da rodada ${match.roundNumber} está prevista para ${date}${location}.`,
      body: `${playerA} e ${playerB} se enfrentam pela rodada ${match.roundNumber} da liga.\n\n`
        + `O confronto está previsto para ${date}${location}.${schedule.note ? ` ${schedule.note}` : ""}\n\n`
        + "A programação pode ser atualizada pela organização do campeonato.",
    };
  }

  function generateChampionNewsDraft(source, championId, options = {}) {
    const standings = calculateStandings(source, options);
    const champion = standings.find((row) => row.id === championId) || standings[0];
    if (!champion || !champion.played) return null;
    const base = newsBase("champion", source, null, { ...options, category: options.category || "Temporada" });
    base.associations.playerIds = [champion.id];
    return {
      ...base,
      title: `${champion.name} é campeão da temporada`,
      summary: `${champion.name} encerra a edição com ${champion.wins} vitória(s) e ${champion.percentage}% de aproveitamento.`,
      body: `${champion.name} conquistou o título da temporada da Sinuca da Firma.\n\n`
        + `A campanha terminou com ${champion.wins} vitória(s), ${champion.points} ponto(s) e saldo de ${champion.ballBalance} bola(s).\n\n`
        + "A classificação final e os recordes da edição ficam preservados no Hall da Fama.",
    };
  }

  function generateAutomaticNews(type, context = {}, options = {}) {
    const normalizedType = normalizeKey(type);
    if (normalizedType === "result" || normalizedType === "resultado") {
      return generateResultNewsDraft(context.source || context.state, context.match || context.matchId, options);
    }
    if (normalizedType === "schedule" || normalizedType === "agenda" || normalizedType === "agendamento") {
      return generateScheduleNewsDraft(
        context.source || context.state,
        context.match || context.matchId,
        context.programming,
        { ...options, schedule: context.schedule },
      );
    }
    if (normalizedType === "champion" || normalizedType === "campeao") {
      return generateChampionNewsDraft(context.source || context.state, context.championId, options);
    }
    return null;
  }

  function graphemes(value) {
    const text = String(value || "");
    if (typeof Intl !== "undefined" && Intl.Segmenter) {
      return [...new Intl.Segmenter("pt-BR", { granularity: "grapheme" }).segment(text)].map((part) => part.segment);
    }
    return Array.from(text);
  }

  function truncateText(value, maximum, suffix = "…") {
    const text = cleanText(value);
    const limit = Math.max(1, integer(maximum, 1));
    const parts = graphemes(text);
    if (parts.length <= limit) return text;
    const suffixParts = graphemes(suffix);
    return `${parts.slice(0, Math.max(1, limit - suffixParts.length)).join("").trimEnd()}${suffix}`;
  }

  function initials(value) {
    const words = cleanText(value, "?").split(/\s+/).filter(Boolean);
    const selected = words.length === 1 ? words : [words[0], words[words.length - 1]];
    return selected.map((word) => graphemes(word)[0] || "").join("").toLocaleUpperCase("pt-BR").slice(0, 2) || "?";
  }

  function hashText(value) {
    let hash = 2166136261;
    for (const character of String(value || "")) {
      hash ^= character.codePointAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function createAvatarFallback(name, playerId = "") {
    const palette = ["#126347", "#0c4a36", "#064634", "#285c70", "#6f4b18", "#713c3c"];
    return {
      kind: "initials",
      initials: initials(name),
      backgroundColor: palette[hashText(playerId || name) % palette.length],
      textColor: "#ffffff",
      ariaLabel: `Avatar de ${cleanText(name, "jogador")}`,
    };
  }

  function cardParticipant(source, playerId, profiles, nameLimit) {
    const profile = asObject(profiles?.[playerId]);
    const name = cleanText(profile.displayName || profile.name, playerName(source, playerId, "A definir"));
    const image = cleanText(profile.imageUrl || profile.image || profile.avatarUrl);
    return {
      id: playerId || null,
      name: truncateText(name, nameLimit),
      fullName: name,
      avatar: image
        ? { kind: "image", src: image, fallback: createAvatarFallback(name, playerId), ariaLabel: `Foto de ${name}` }
        : createAvatarFallback(name, playerId),
    };
  }

  function createCardModel(type, data = {}, options = {}) {
    const normalizedType = CARD_TYPE_ALIASES[normalizeKey(type)] || null;
    if (!normalizedType) return null;
    const format = CARD_FORMATS[normalizeKey(options.format || data.format)] || CARD_FORMATS.square;
    const source = data.source || data.state || {};
    const match = typeof data.match === "string" ? findMatchById(source, data.match) : data.match;
    const nameLimit = format.id === "horizontal" ? 22 : 28;
    const profiles = asObject(data.profiles);
    const participants = match
      ? [
          cardParticipant(source, match.playerAId, profiles, nameLimit),
          cardParticipant(source, match.playerBId, profiles, nameLimit),
        ]
      : [];
    const theme = {
      background: "#062c21",
      surface: "#0c4a36",
      primary: "#21a071",
      text: "#ffffff",
      mutedText: "#daf3e7",
      earnedGold: "#c79223",
    };
    let title = "Sinuca da Firma";
    let label = "Campeonato";
    let score = null;
    let ranking = [];

    if (normalizedType === "next-match") {
      label = "Próximo jogo";
      title = participants.length ? `${participants[0].name} × ${participants[1].name}` : "Próximo jogo a definir";
    } else if (normalizedType === "featured-match") {
      label = "Jogo em destaque";
      title = participants.length ? `${participants[0].name} × ${participants[1].name}` : "Confronto em destaque";
    } else if (normalizedType === "result") {
      label = "Resultado final";
      title = participants.length ? `${participants[0].name} × ${participants[1].name}` : "Resultado oficial";
      if (match?.completed) {
        score = {
          playerA: match.result.scoreA,
          playerB: match.result.scoreB,
          ballsA: match.result.ballsA,
          ballsB: match.result.ballsB,
          winnerId: match.result.winnerId,
        };
      }
    } else if (normalizedType === "ranking") {
      label = cleanText(data.label, "Classificação");
      title = cleanText(data.title, "Ranking da rodada");
      ranking = asArray(data.ranking || calculateStandings(source)).slice(0, 5).map((row, index) => ({
        position: integer(row.position, index + 1),
        playerId: cleanText(row.id || row.playerId),
        name: truncateText(row.name || playerName(source, row.id || row.playerId), format.id === "horizontal" ? 24 : 30),
        points: finiteNumber(row.points),
        wins: finiteNumber(row.wins),
      }));
    } else if (normalizedType === "mvp" || normalizedType === "champion") {
      const playerId = cleanText(data.playerId || data.championId || data.mvpId);
      participants.push(cardParticipant(source, playerId, profiles, format.id === "horizontal" ? 25 : 32));
      label = normalizedType === "mvp" ? "Craque da rodada" : "Campeão da temporada";
      title = participants[0]?.name || (normalizedType === "mvp" ? "Craque a definir" : "Campeão a definir");
    }

    const schedule = match
      ? normalizeScheduleEntry(data.schedule || data.programming?.matches?.[match.id])
      : normalizeScheduleEntry({});
    const metadata = [];
    if (match?.roundNumber) metadata.push(`Rodada ${match.roundNumber}`);
    if (schedule.scheduledAt) metadata.push(formatDatePt(schedule.scheduledAt, options));
    if (schedule.location) metadata.push(schedule.location);
    const altParticipants = participants.map((participant) => participant.fullName).join(" contra ");
    const altScore = score ? `, placar ${score.playerA} a ${score.playerB}` : "";
    const altRanking = ranking.length
      ? `: ${ranking.map((row) => `${row.position}º ${row.name}, ${row.points} pontos`).join("; ")}`
      : "";

    return {
      schemaVersion: 1,
      type: normalizedType,
      format,
      canvas: {
        width: format.width,
        height: format.height,
        safeArea: Math.round(Math.min(format.width, format.height) * 0.065),
      },
      theme,
      label,
      title: truncateText(title, format.id === "horizontal" ? 52 : 42),
      participants,
      score,
      ranking,
      metadata,
      footer: cleanText(options.footer || data.footer, "O campeonato acontece aqui."),
      createdAt: normalizeDateTime(options.now || data.createdAt),
      altText: `${label}. ${altParticipants || title}${altScore}${altRanking}.`,
      publication: { automatic: false, requiresConfirmation: true },
    };
  }

  function jsonClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function createSeasonSnapshot(source, options = {}) {
    const state = resolveState(source);
    const standings = calculateStandings(state, options);
    const statistics = calculateStatistics(state, options);
    const allMatches = flattenMatches(state);
    const champion = standings.find((row) => row.played > 0) || null;
    return jsonClone({
      schemaVersion: 1,
      title: cleanText(options.title, state.settings?.title || "Temporada da Sinuca da Firma"),
      startedAt: normalizeDateTime(options.startedAt || state.league?.createdAt),
      endedAt: normalizeDateTime(options.endedAt),
      createdAt: normalizeDateTime(options.createdAt || options.endedAt),
      createdBy: cleanText(options.createdBy),
      players: resolvePlayers(state),
      league: state.league || null,
      standings,
      awards: asArray(options.awards || state.awards),
      summary: {
        championPlayerId: champion?.id || null,
        runnerUpPlayerId: standings[1]?.id || null,
        podiumPlayerIds: standings.slice(0, 3).map((row) => row.id),
        totalMatches: allMatches.length,
        completedMatches: allMatches.filter((match) => match.completed).length,
        pendingMatches: allMatches.filter((match) => !match.completed).length,
        biggestWin: statistics.biggestWins[0]
          ? {
              matchId: statistics.biggestWins[0].match.id,
              margin: statistics.biggestWins[0].margin,
              winnerId: statistics.biggestWins[0].winnerId,
            }
          : null,
      },
    });
  }

  function calculateHistoricalRecords(seasons) {
    const records = {
      mostTitles: null,
      mostWinsInSeason: null,
      bestPercentageInSeason: null,
      biggestWin: null,
    };
    const titles = new Map();
    asArray(seasons).forEach((season) => {
      const snapshot = asObject(season.snapshot || season.snapshotJson || season);
      const standings = asArray(snapshot.standings);
      const championId = snapshot.summary?.championPlayerId || standings[0]?.id;
      if (championId) {
        const champion = standings.find((row) => row.id === championId) || standings[0];
        const current = titles.get(championId) || { playerId: championId, name: champion?.name || championId, value: 0 };
        current.value += 1;
        titles.set(championId, current);
      }
      standings.forEach((row) => {
        if (!records.mostWinsInSeason || finiteNumber(row.wins) > records.mostWinsInSeason.value) {
          records.mostWinsInSeason = { playerId: row.id, name: row.name, value: finiteNumber(row.wins), seasonTitle: snapshot.title || season.title || "" };
        }
        if (finiteNumber(row.played) > 0 && (!records.bestPercentageInSeason || finiteNumber(row.percentage) > records.bestPercentageInSeason.value)) {
          records.bestPercentageInSeason = { playerId: row.id, name: row.name, value: finiteNumber(row.percentage), seasonTitle: snapshot.title || season.title || "" };
        }
      });
      const biggest = snapshot.summary?.biggestWin;
      if (biggest && (!records.biggestWin || finiteNumber(biggest.margin) > records.biggestWin.value)) {
        records.biggestWin = { matchId: biggest.matchId, playerId: biggest.winnerId, value: finiteNumber(biggest.margin), seasonTitle: snapshot.title || season.title || "" };
      }
    });
    records.mostTitles = [...titles.values()].sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, "pt-BR"))[0] || null;
    return records;
  }

  return {
    PROGRAMMING_STATUSES,
    AVAILABILITY_STATUSES,
    MAX_FEATURED_MATCHES,
    MAX_BALLS_PER_PLAYER,
    CARD_FORMATS,
    normalizeDateTime,
    normalizeResult,
    flattenMatches,
    flattenLeagueMatches: flattenMatches,
    matchMap,
    findMatchById,
    normalizeScheduleEntry,
    normalizeProgramming,
    normalizeAvailabilityEntry,
    normalizeAvailability,
    validateNextMatch,
    validateFeaturedMatches,
    validateSchedule,
    availabilityAt,
    detectAvailabilityConflicts,
    calendarDayKey,
    sortPublicSchedule,
    publicScheduleOrder: sortPublicSchedule,
    partitionPublicSchedule,
    calculateStandings,
    calculateRanking: calculateStandings,
    calculatePlayerStats,
    calculatePlayerForm,
    calculatePlayerStreaks,
    calculateHeadToHead,
    headToHead: calculateHeadToHead,
    calculateEvolutionByRound,
    calculateComparison,
    comparePlayers: calculateComparison,
    calculateStatistics,
    findBalancedMatches,
    findBiggestWins,
    formatDatePt,
    generateResultNewsDraft,
    generateScheduleNewsDraft,
    generateChampionNewsDraft,
    generateAutomaticNews,
    truncateText,
    initials,
    createAvatarFallback,
    createCardModel,
    buildCardModel: createCardModel,
    createSeasonSnapshot,
    buildSeasonSnapshot: createSeasonSnapshot,
    calculateHistoricalRecords,
  };
});

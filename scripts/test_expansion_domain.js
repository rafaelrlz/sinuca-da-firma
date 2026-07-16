"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const domain = require("../expansion-domain.js");

function fixture() {
  return {
    version: 4,
    settings: {
      title: "Sinuca da Firma",
      league: { winPoints: 3, lossPoints: 0 },
    },
    players: [
      { id: "p1", name: "João da Conceição" },
      { id: "p2", name: "Érica Silva" },
      { id: "p3", name: "Álvaro" },
      { id: "p4", name: "Bia" },
    ],
    league: {
      createdAt: "2026-07-01T12:00:00-03:00",
      playerIds: ["p1", "p2", "p3", "p4"],
      rounds: [
        {
          number: 1,
          matches: [
            { id: "m1", playerAId: "p1", playerBId: "p2" },
            { id: "m2", playerAId: "p3", playerBId: "p4" },
          ],
        },
        {
          number: 2,
          matches: [
            { id: "m3", playerAId: "p1", playerBId: "p3" },
            { id: "m4", playerAId: "p2", playerBId: "p4" },
          ],
        },
        {
          number: 3,
          matches: [
            { id: "m5", playerAId: "p1", playerBId: "p4" },
            { id: "m6", playerAId: "p2", playerBId: "p3" },
          ],
        },
      ],
      results: {},
      inProgress: {},
    },
  };
}

function result(match, winnerId, ballsA, ballsB, playedAt) {
  return {
    playerAId: match.playerAId,
    playerBId: match.playerBId,
    winnerId,
    scoreA: winnerId === match.playerAId ? 1 : 0,
    scoreB: winnerId === match.playerBId ? 1 : 0,
    ballsA,
    ballsB,
    playedAt,
  };
}

function addSeveralResults(state) {
  const matches = domain.matchMap(state);
  state.league.results.m1 = result(matches.get("m1"), "p1", 8, 7, "2026-07-10T17:00:00-03:00");
  state.league.results.m2 = result(matches.get("m2"), "p3", 8, 2, "2026-07-10T18:00:00-03:00");
  state.league.results.m3 = result(matches.get("m3"), "p1", 8, 5, "2026-07-11T17:00:00-03:00");
  state.league.results.m4 = result(matches.get("m4"), "p4", 6, 8, "2026-07-11T18:00:00-03:00");
  state.league.results.m5 = result(matches.get("m5"), "p4", 7, 8, "2026-07-12T17:00:00-03:00");
}

function testMatchesAndOldStateNormalization() {
  const state = fixture();
  const flattened = domain.flattenMatches(state);
  assert.equal(flattened.length, 6);
  assert.equal(flattened[2].roundNumber, 2);
  assert.equal(domain.findMatchById(state, "m4").playerBId, "p4");
  assert.equal(domain.findMatchById(state, "missing"), null);
  assert.equal(domain.flattenLeagueMatches, domain.flattenMatches);
  assert.equal(domain.calculateRanking, domain.calculateStandings);
  assert.equal(domain.comparePlayers, domain.calculateComparison);
  assert.equal(domain.buildCardModel, domain.createCardModel);

  state.league.results.m1 = {
    playerAId: "p1",
    playerBId: "p2",
    winnerId: "p1",
    ballsA: 8,
    ballsB: 6,
  };
  const legacyResult = domain.findMatchById(state, "m1").result;
  assert.equal(legacyResult.scoreA, 1);
  assert.equal(legacyResult.scoreB, 0);

  const normalized = domain.normalizeProgramming({
    nextMatch: "missing",
    featuredMatches: ["m1", "m2", "m3", "m4", "missing"],
    schedule: [
      { matchId: "m2", date: "2026-07-18", time: "17:30", offset: "-03:00", local: "Sala de jogos", situacao: "agendado" },
      { matchId: "missing", scheduledAt: "2026-07-19T17:30:00-03:00" },
      { matchId: "m1", scheduledAt: "2026-07-19T17:30:00-03:00" },
    ],
  }, state);
  assert.equal(normalized.nextMatchId, null, "ID inexistente deve ser removido");
  assert.deepEqual(normalized.featuredMatchIds, ["m2", "m3", "m4"], "concluído, inexistente e excedente devem sair");
  assert.equal(normalized.matches.m2.status, "scheduled");
  assert.equal(normalized.matches.m2.location, "Sala de jogos");
  assert.equal(normalized.matches.missing, undefined);
  assert.equal(normalized.matches.m1, undefined, "partida concluída deve sair da agenda futura");

  const availability = domain.normalizeAvailability({
    p1: { available: true, inicio: "2026-07-18T18:00:00-03:00", fim: "2026-07-18T14:00:00-03:00" },
    removed: [{ status: "indisponível" }],
  }, state);
  assert.equal(availability.p1[0].status, "available");
  assert.ok(new Date(availability.p1[0].startsAt) < new Date(availability.p1[0].endsAt), "intervalo antigo invertido deve ser normalizado");
  assert.equal(availability.removed, undefined, "jogador inexistente deve ser removido");
}

function testAgendaValidationAndAvailability() {
  const state = fixture();
  state.league.results.m1 = result(domain.findMatchById(state, "m1"), "p1", 8, 7, "2026-07-10T17:00:00-03:00");
  const programming = {
    nextMatchId: "m3",
    featuredMatchIds: ["m2", "m3", "m4"],
    matches: {
      m2: { status: "postponed", note: "Aguardando confirmação" },
      m3: { status: "scheduled", scheduledAt: "2026-07-18T17:30:00-03:00" },
      m4: { status: "scheduled", scheduledAt: "2026-07-18T16:00:00-03:00" },
    },
  };

  assert.equal(domain.validateNextMatch("m3", state, programming).valid, true);
  assert.equal(domain.validateNextMatch("missing", state, programming).errors[0].code, "MATCH_NOT_FOUND");
  assert.equal(domain.validateNextMatch("m1", state, programming).errors[0].code, "MATCH_COMPLETED");
  assert.equal(domain.validateFeaturedMatches(["m2", "m3", "m4", "m5"], state, programming).errors[0].code, "FEATURED_LIMIT");
  assert.deepEqual(domain.validateFeaturedMatches(["m2", "m3", "m4"], state, programming).featuredMatchIds, ["m2", "m3", "m4"]);

  const invalidDate = domain.validateSchedule("m3", {
    status: "scheduled",
    scheduledAt: "data impossível",
  }, state);
  assert.equal(invalidDate.valid, false);
  assert.ok(invalidDate.errors.some((error) => error.code === "INVALID_DATE"));

  const availability = {
    p1: [{
      id: "a1",
      status: "indisponível",
      startsAt: "2026-07-18T20:00:00Z",
      endsAt: "2026-07-18T21:00:00Z",
      note: "Em reunião",
    }],
    p3: [{ id: "a2", status: "talvez" }],
  };
  const conflict = domain.detectAvailabilityConflicts(
    domain.findMatchById(state, "m3"),
    "2026-07-18T17:30:00-03:00",
    availability,
    state,
  );
  assert.equal(conflict.hasConflicts, true, "fusos equivalentes devem detectar conflito");
  assert.equal(conflict.blocking, false, "disponibilidade nunca bloqueia");
  assert.equal(conflict.conflicts[0].playerId, "p1");
  assert.equal(conflict.warnings[0].playerId, "p3");

  const scheduleValidation = domain.validateSchedule("m3", programming.matches.m3, state, availability);
  assert.equal(scheduleValidation.valid, true);
  assert.ok(scheduleValidation.warnings.some((warning) => warning.code === "PLAYER_UNAVAILABLE"));

  const noAvailability = domain.detectAvailabilityConflicts(
    domain.findMatchById(state, "m4"),
    programming.matches.m4,
    {},
    state,
  );
  assert.equal(noAvailability.hasConflicts, false);
  assert.equal(noAvailability.warnings.length, 2);
}

function testPublicAgendaOrderAndTimezone() {
  const state = fixture();
  const matches = domain.matchMap(state);
  state.league.inProgress.m6 = true;
  state.league.results.m1 = result(matches.get("m1"), "p1", 8, 7, "2026-07-10T20:00:00Z");
  state.league.results.m2 = result(matches.get("m2"), "p3", 8, 2, "2026-07-10T21:00:00Z");
  const programming = {
    nextMatchId: "m5",
    featuredMatchIds: ["m3", "m4", "m5"],
    matches: {
      m3: { scheduledAt: "2026-07-19T12:00:00-03:00", status: "scheduled" },
      m4: { scheduledAt: "2026-07-18T23:30:00-03:00", status: "scheduled" },
      m5: { status: "unscheduled" },
    },
  };
  const agenda = domain.sortPublicSchedule(state, programming, {
    now: "2026-07-19T01:00:00Z",
    timeZone: "America/Sao_Paulo",
    historyLimit: 1,
  });
  assert.deepEqual(agenda.map((item) => item.id), ["m6", "m5", "m4", "m3", "m2"]);
  assert.equal(agenda.find((item) => item.id === "m4").isToday, true, "dia local deve respeitar America/Sao_Paulo");
  assert.equal(agenda.at(-1).agendaGroup, "completed");
  const groups = domain.partitionPublicSchedule(state, programming, { historyLimit: 2 });
  assert.equal(groups["in-progress"][0].id, "m6");
  assert.equal(groups.next[0].id, "m5");
}

function testStatisticsZeroOneAndSeveral() {
  const zero = fixture();
  const zeroStandings = domain.calculateStandings(zero);
  assert.equal(zeroStandings.length, 4);
  assert.equal(zeroStandings.every((row) => row.played === 0 && row.percentage === 0), true);
  assert.equal(domain.calculateStatistics(zero).totals.completed, 0);
  assert.deepEqual(domain.calculateEvolutionByRound(zero).rounds, []);
  assert.equal(domain.calculateHeadToHead(zero, "p1", "p2").games, 0);

  const one = fixture();
  one.league.results.m1 = result(domain.findMatchById(one, "m1"), "p1", 8, 7, "2026-07-10T17:00:00-03:00");
  const oneRanking = domain.calculateStandings(one);
  assert.equal(oneRanking[0].id, "p1");
  assert.equal(oneRanking[0].points, 3);
  assert.equal(oneRanking[0].percentage, 100);
  assert.equal(domain.calculatePlayerStats(one, "p1").maxWinStreak, 1);

  const several = fixture();
  addSeveralResults(several);
  const ranking = domain.calculateStandings(several);
  assert.deepEqual(ranking.map((row) => row.id), ["p1", "p4", "p3", "p2"]);
  assert.equal(ranking[0].wins, 2);
  assert.equal(ranking[1].ballBalance, -3);

  const playerOne = domain.calculatePlayerStats(several, "p1");
  assert.equal(playerOne.maxWinStreak, 2);
  assert.deepEqual(playerOne.form, ["V", "V", "D"]);
  assert.deepEqual(playerOne.currentStreak, { type: "loss", length: 1 });
  assert.deepEqual(domain.calculatePlayerForm(several, "p1"), ["V", "V", "D"]);
  assert.equal(domain.calculatePlayerStreaks(several, "p1").maxWinStreak, 2);

  const h2h = domain.calculateHeadToHead(several, "p1", "p4");
  assert.equal(h2h.games, 1);
  assert.equal(h2h.leaderId, "p4");

  const comparison = domain.calculateComparison(several, "p1", "p4");
  assert.equal(comparison.metrics.find((metric) => metric.key === "wins").leaderId, null);
  assert.equal(comparison.headToHead.leaderId, "p4");

  const statistics = domain.calculateStatistics(several);
  assert.equal(statistics.totals.completed, 5);
  assert.equal(statistics.biggestWins[0].match.id, "m2");
  assert.equal(statistics.biggestWins[0].margin, 6);
  assert.equal(statistics.balancedMatches[0].margin, 1);
  assert.ok(["m1", "m5"].includes(statistics.balancedMatches[0].match.id));
  assert.equal(domain.findBalancedMatches(several)[0].margin, 1);
  assert.equal(domain.findBiggestWins(several)[0].match.id, "m2");
  assert.deepEqual(statistics.evolution.rounds, [1, 2, 3]);
  const p1Evolution = statistics.evolution.players.find((player) => player.id === "p1");
  assert.equal(p1Evolution.positions.length, 3);
}

function testNewsCardsAndUnicode() {
  const state = fixture();
  addSeveralResults(state);
  const match = domain.findMatchById(state, "m1");
  const news = domain.generateResultNewsDraft(state, match);
  assert.equal(news.status, "draft");
  assert.equal(news.automation.requiresConfirmation, true);
  assert.match(news.title, /João da Conceição/);
  assert.deepEqual(news.associations.playerIds, ["p1", "p2"]);

  const scheduleNews = domain.generateScheduleNewsDraft(state, "m6", {
    matches: {
      m6: {
        scheduledAt: "2026-07-20T17:30:00-03:00",
        status: "scheduled",
        location: "Sala de jogos",
      },
    },
  });
  assert.equal(scheduleNews.status, "draft");
  assert.match(scheduleNews.summary, /Sala de jogos/);

  const championNews = domain.generateChampionNewsDraft(state, "p1");
  assert.match(championNews.title, /campeão/);
  assert.equal(championNews.associations.playerIds[0], "p1");

  const longName = "Ângela Maria da Conceição Extraordinariamente Longa";
  const truncated = domain.truncateText(longName, 18);
  assert.ok([...truncated].length <= 18);
  assert.match(truncated, /…$/);
  assert.equal(domain.initials("Érica da Silva"), "ÉS");
  assert.equal(domain.truncateText("João", 10), "João");
  assert.equal(domain.truncateText("Cafe\u0301x", 4), "Caf…", "truncamento não deve separar acento combinado");

  const fallbackA = domain.createAvatarFallback("Érica Silva", "p2");
  const fallbackB = domain.createAvatarFallback("Érica Silva", "p2");
  assert.deepEqual(fallbackA, fallbackB, "fallback deve ser determinístico");
  assert.equal(fallbackA.initials, "ÉS");

  const card = domain.createCardModel("result", {
    state,
    match,
    profiles: { p1: { displayName: longName } },
  }, { format: "vertical", now: "2026-07-16T12:00:00-03:00" });
  assert.equal(card.format.width, 1080);
  assert.equal(card.format.height, 1350);
  assert.equal(card.publication.automatic, false);
  assert.ok(card.participants[0].name.endsWith("…"));
  assert.match(card.altText, /placar 1 a 0/);

  const rankingCard = domain.createCardModel("ranking", {
    state,
    ranking: domain.calculateStandings(state),
  }, { format: "horizontal" });
  assert.equal(rankingCard.format.ratio, "16:9");
  assert.equal(rankingCard.ranking.length, 4);
  assert.match(rankingCard.altText, /1º/);

  const emptyNextCard = domain.createCardModel("next", { state }, { format: "square" });
  assert.equal(emptyNextCard.title, "Próximo jogo a definir");
}

function testSnapshotsAndRecords() {
  const state = fixture();
  addSeveralResults(state);
  const snapshot = domain.createSeasonSnapshot(state, {
    title: "Temporada 2026",
    endedAt: "2026-07-30T18:00:00-03:00",
    createdBy: "admin",
  });
  assert.equal(snapshot.summary.championPlayerId, "p1");
  assert.equal(snapshot.summary.pendingMatches, 1);
  assert.equal(snapshot.summary.biggestWin.matchId, "m2");
  assert.notEqual(snapshot.players, state.players);
  snapshot.players[0].name = "Alterado no snapshot";
  assert.equal(state.players[0].name, "João da Conceição", "snapshot não pode compartilhar referências");

  const second = structuredClone(snapshot);
  second.title = "Temporada 2027";
  second.standings[0].wins = 7;
  second.standings[0].percentage = 100;
  const records = domain.calculateHistoricalRecords([snapshot, second]);
  assert.equal(records.mostTitles.playerId, "p1");
  assert.equal(records.mostTitles.value, 2);
  assert.equal(records.mostWinsInSeason.value, 7);
}

function testBrowserUmdExport() {
  const source = fs.readFileSync(require.resolve("../expansion-domain.js"), "utf8");
  const context = {
    Intl,
    Date,
    Map,
    Set,
    Math,
    JSON,
    Object,
    Array,
    String,
    Number,
    Boolean,
  };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: "expansion-domain.js" });
  assert.equal(typeof context.SinucaExpansionDomain.normalizeProgramming, "function");
  assert.equal(context.SinucaExpansionDomain.CARD_FORMATS.square.width, 1080);
}

function run() {
  testMatchesAndOldStateNormalization();
  testAgendaValidationAndAvailability();
  testPublicAgendaOrderAndTimezone();
  testStatisticsZeroOneAndSeveral();
  testNewsCardsAndUnicode();
  testSnapshotsAndRecords();
  testBrowserUmdExport();
  process.stdout.write("OK: domínio da expansão cobre agenda, disponibilidade, estatísticas, notícias, cards e snapshots.\n");
}

run();

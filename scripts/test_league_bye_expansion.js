"use strict";

const assert = require("node:assert/strict");
const { planIncrementalExpansion } = require("../league-schedule.js");

function makeElevenPlayerLeague() {
  const playerIds = Array.from({ length: 11 }, (_, index) => `player-${index + 1}`);
  const lineup = [...playerIds, null];
  const rounds = [];
  let rotation = [...lineup];

  for (let roundIndex = 0; roundIndex < 11; roundIndex += 1) {
    const matches = [];
    let byePlayerId = null;
    for (let pairIndex = 0; pairIndex < 6; pairIndex += 1) {
      const playerAId = rotation[pairIndex];
      const playerBId = rotation[11 - pairIndex];
      if (!playerAId || !playerBId) byePlayerId = playerAId || playerBId;
      else matches.push({ id: `league-r${roundIndex + 1}-m${matches.length + 1}`, playerAId, playerBId });
    }
    rounds.push({ number: roundIndex + 1, matches, byePlayerId });
    rotation = [rotation[0], rotation[11], ...rotation.slice(1, 11)];
  }

  const first = rounds[0].matches[0];
  return {
    playerIds,
    league: {
      id: "league-original",
      playerIds: [...playerIds],
      rounds,
      results: { [first.id]: { playerAId: first.playerAId, playerBId: first.playerBId, winnerId: first.playerAId, scoreA: 1, scoreB: 0, ballsA: 8, ballsB: 6 } },
      inProgress: { [rounds[1].matches[0].id]: true },
    },
  };
}

function pairKey(match) {
  return [match.playerAId, match.playerBId].sort().join("|");
}

function snapshotMatches(league) {
  return new Map(league.rounds.flatMap((round) => round.matches).map((match) => [match.id, JSON.stringify(match)]));
}

function assertRoundAndLeagueInvariants(league, playerIds) {
  const matches = league.rounds.flatMap((round) => round.matches);
  const expected = (playerIds.length * (playerIds.length - 1)) / 2;
  assert.equal(matches.length, expected, `liga de ${playerIds.length} jogadores deve ter ${expected} duelos`);
  assert.equal(new Set(matches.map((match) => match.id)).size, expected, "IDs devem ser unicos");
  assert.equal(new Set(matches.map(pairKey)).size, expected, "cada par deve jogar exatamente uma vez");
  league.rounds.forEach((round) => {
    const players = round.matches.flatMap((match) => [match.playerAId, match.playerBId]);
    assert.equal(new Set(players).size, players.length, `rodada ${round.number} nao pode repetir jogador`);
  });
}

function applyExpansion(fixture, newPlayerId, expectedReused, expectedNewRounds) {
  const inputBefore = JSON.stringify(fixture);
  const oldMatches = snapshotMatches(fixture.league);
  const resultsBefore = JSON.stringify(fixture.league.results);
  const liveBefore = JSON.stringify(fixture.league.inProgress);
  const oldRoundCount = fixture.league.rounds.length;

  const plan = planIncrementalExpansion({ league: fixture.league, playerIds: fixture.playerIds, newPlayerId });
  assert.equal(JSON.stringify(fixture), inputBefore, "o planner deve ser puro");
  assert.equal(plan.additions.length, expectedReused, "deve maximizar rodadas existentes");
  assert.equal(plan.newRounds.length, expectedNewRounds, "deve criar apenas as rodadas necessarias");
  assert.equal(plan.manifest.totalAdditions, fixture.playerIds.length, "novo jogador deve enfrentar todos os anteriores");
  assert.equal(plan.manifest.previousMatchCount, oldMatches.size);
  assert.equal(plan.manifest.previousRoundCount, oldRoundCount);

  plan.additions.forEach(({ roundIndex, match }) => fixture.league.rounds[roundIndex].matches.push(match));
  fixture.league.rounds.push(...plan.newRounds);
  fixture.playerIds.push(newPlayerId);
  fixture.league.playerIds.push(newPlayerId);

  const currentMatches = snapshotMatches(fixture.league);
  oldMatches.forEach((serialized, id) => assert.equal(currentMatches.get(id), serialized, `duelo ${id} deve permanecer identico`));
  assert.equal(JSON.stringify(fixture.league.results), resultsBefore, "resultados e bolas devem permanecer intactos");
  assert.equal(JSON.stringify(fixture.league.inProgress), liveBefore, "andamento deve permanecer intacto");
  assertRoundAndLeagueInvariants(fixture.league, fixture.playerIds);
}

function run() {
  const fixture = makeElevenPlayerLeague();
  const bets = [{ id: 1, matchId: "league-r1-m1", pick: "player-1", stake: 10 }];
  const betsBefore = JSON.stringify(bets);

  applyExpansion(fixture, "player-12", 11, 0);
  applyExpansion(fixture, "player-13", 0, 12);
  applyExpansion(fixture, "player-14", 13, 0);
  applyExpansion(fixture, "player-15", 14, 0);

  assert.equal(JSON.stringify(bets), betsBefore, "apostas devem permanecer intactas");
  assert.equal(fixture.league.rounds.length, 23, "expansao ate 15 jogadores deve usar somente 23 rodadas");
  assert.throws(
    () => planIncrementalExpansion({ league: fixture.league, playerIds: fixture.playerIds, newPlayerId: "player-1" }),
    (error) => error.code === "PLAYER_ALREADY_INCLUDED",
  );
  const broken = structuredClone(fixture.league);
  broken.rounds[0].matches.push({ id: "duplicate-pair", playerAId: "player-1", playerBId: "player-2" });
  assert.throws(
    () => planIncrementalExpansion({ league: broken, playerIds: fixture.playerIds, newPlayerId: "player-16" }),
    (error) => ["PLAYER_REPEATED_IN_ROUND", "DUPLICATE_PAIR"].includes(error.code),
  );

  process.stdout.write("OK: expansoes 11->12->13->14->15 preservam duelos e maximizam rodadas existentes (23 rodadas, 105 pares).\n");
}

run();

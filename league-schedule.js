(function initSinucaLeague(root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SinucaLeague = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createSinucaLeague() {
  "use strict";

  function contractError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  function requireCondition(condition, code, message) {
    if (!condition) throw contractError(code, message);
  }

  function pairKey(playerAId, playerBId) {
    return [String(playerAId), String(playerBId)].sort().join("\u0000");
  }

  function nextMatchId(round, roundIndex, usedMatchIds) {
    const roundNumber = Number(round.number) || roundIndex + 1;
    let matchNumber = round.matches.length + 1;
    let matchId = `league-r${roundNumber}-m${matchNumber}`;
    while (usedMatchIds.has(matchId)) {
      matchNumber += 1;
      matchId = `league-r${roundNumber}-m${matchNumber}`;
    }
    usedMatchIds.add(matchId);
    return matchId;
  }

  /**
   * Planeja uma expansao incremental de uma liga round-robin completa.
   *
   * Nenhuma partida existente e alterada. O novo jogador e encaixado no
   * maximo uma vez em cada rodada em que o adversario esteja livre. Um
   * matching bipartido maximiza esses encaixes; confrontos restantes recebem
   * novas rodadas. A funcao e pura e o chamador deve persistir o plano em uma
   * unica operacao.
   */
  function planIncrementalExpansion({ league, playerIds, newPlayerId } = {}) {
    requireCondition(league && typeof league === "object", "INVALID_LEAGUE", "Liga ausente ou invalida.");
    requireCondition(Array.isArray(playerIds), "INVALID_PLAYERS", "A lista de jogadores e invalida.");
    requireCondition(typeof newPlayerId === "string" && newPlayerId.trim(), "INVALID_NEW_PLAYER", "O novo jogador precisa ter um ID.");
    requireCondition(Array.isArray(league.rounds), "INVALID_ROUNDS", "A liga nao possui rodadas validas.");

    const normalizedNewPlayerId = String(newPlayerId);
    const currentIds = playerIds.map(String);
    const currentIdSet = new Set(currentIds);
    requireCondition(currentIds.length >= 2, "TOO_FEW_PLAYERS", "A liga precisa ter pelo menos dois jogadores atuais.");
    requireCondition(currentIdSet.size === currentIds.length, "DUPLICATE_PLAYER", "Existem jogadores duplicados na lista.");
    requireCondition(!currentIdSet.has(normalizedNewPlayerId), "PLAYER_ALREADY_INCLUDED", "O novo jogador ja participa da liga.");

    if (Array.isArray(league.playerIds)) {
      const leagueIds = new Set(league.playerIds.map(String));
      requireCondition(
        leagueIds.size === currentIdSet.size && currentIds.every((id) => leagueIds.has(id)),
        "LEAGUE_ROSTER_MISMATCH",
        "Os jogadores da liga nao correspondem ao cadastro atual.",
      );
    }

    const previousMatchIds = [];
    const usedMatchIds = new Set();
    const existingPairs = new Set();
    const playersByRound = [];

    league.rounds.forEach((round, roundIndex) => {
      requireCondition(round && typeof round === "object", "INVALID_ROUND", `Rodada ${roundIndex + 1} invalida.`);
      requireCondition(Array.isArray(round.matches), "INVALID_MATCHES", `Rodada ${roundIndex + 1} nao possui duelos validos.`);
      const playersInRound = new Set();

      round.matches.forEach((match) => {
        requireCondition(match && match.id, "INVALID_MATCH", `Rodada ${roundIndex + 1} contem duelo sem ID.`);
        const matchId = String(match.id);
        requireCondition(!usedMatchIds.has(matchId), "DUPLICATE_MATCH_ID", `ID de duelo duplicado: ${matchId}.`);
        usedMatchIds.add(matchId);
        previousMatchIds.push(matchId);

        const playerAId = String(match.playerAId || "");
        const playerBId = String(match.playerBId || "");
        requireCondition(currentIdSet.has(playerAId) && currentIdSet.has(playerBId), "UNKNOWN_MATCH_PLAYER", `Duelo ${matchId} possui jogador desconhecido.`);
        requireCondition(playerAId !== playerBId, "SELF_MATCH", `Duelo ${matchId} repete o mesmo jogador.`);
        requireCondition(!playersInRound.has(playerAId) && !playersInRound.has(playerBId), "PLAYER_REPEATED_IN_ROUND", `A rodada ${roundIndex + 1} repete um jogador.`);
        playersInRound.add(playerAId);
        playersInRound.add(playerBId);

        const key = pairKey(playerAId, playerBId);
        requireCondition(!existingPairs.has(key), "DUPLICATE_PAIR", `O confronto ${playerAId} x ${playerBId} esta duplicado.`);
        existingPairs.add(key);
      });
      playersByRound.push(playersInRound);
    });

    const expectedExistingMatches = (currentIds.length * (currentIds.length - 1)) / 2;
    requireCondition(
      previousMatchIds.length === expectedExistingMatches && existingPairs.size === expectedExistingMatches,
      "INCOMPLETE_LEAGUE",
      "A tabela atual nao contem todos os confrontos esperados.",
    );

    // roundToOpponent guarda o matching. O DFS pode remanejar escolhas
    // anteriores para obter o numero maximo de rodadas existentes utilizadas.
    const roundToOpponent = new Map();
    function assignOpponent(opponentId, visitedRounds) {
      for (let roundIndex = 0; roundIndex < league.rounds.length; roundIndex += 1) {
        if (playersByRound[roundIndex].has(opponentId) || visitedRounds.has(roundIndex)) continue;
        visitedRounds.add(roundIndex);
        const previousOpponent = roundToOpponent.get(roundIndex);
        if (previousOpponent === undefined || assignOpponent(previousOpponent, visitedRounds)) {
          roundToOpponent.set(roundIndex, opponentId);
          return true;
        }
      }
      return false;
    }

    currentIds.forEach((opponentId) => assignOpponent(opponentId, new Set()));
    const matchedOpponents = new Set(roundToOpponent.values());
    const additions = [...roundToOpponent.entries()]
      .sort(([roundA], [roundB]) => roundA - roundB)
      .map(([roundIndex, opponentId]) => ({
        roundIndex,
        match: {
          id: nextMatchId(league.rounds[roundIndex], roundIndex, usedMatchIds),
          playerAId: opponentId,
          playerBId: normalizedNewPlayerId,
        },
      }));

    const unmatchedOpponents = currentIds.filter((id) => !matchedOpponents.has(id));
    const firstNewRoundNumber = league.rounds.reduce((maximum, round, index) => {
      return Math.max(maximum, Number(round.number) || index + 1);
    }, 0) + 1;
    const newRounds = unmatchedOpponents.map((opponentId, newRoundIndex) => {
      const roundIndex = league.rounds.length + newRoundIndex;
      const round = { number: firstNewRoundNumber + newRoundIndex, matches: [] };
      round.matches.push({
        id: nextMatchId(round, roundIndex, usedMatchIds),
        playerAId: opponentId,
        playerBId: normalizedNewPlayerId,
      });
      return round;
    });

    const totalAdditions = additions.length + newRounds.length;
    const manifest = {
      previousMatchIds,
      previousMatchCount: previousMatchIds.length,
      previousRoundCount: league.rounds.length,
      reusedRoundCount: additions.length,
      newRoundCount: newRounds.length,
      totalAdditions,
      finalMatchCount: previousMatchIds.length + totalAdditions,
      finalRoundCount: league.rounds.length + newRounds.length,
      opponents: [...currentIds],
    };

    return { additions, newRounds, previousMatchIds, manifest };
  }

  // Mantem a API anterior para deploys que ainda chamam o nome antigo.
  function planByeExpansion(options) {
    return planIncrementalExpansion(options);
  }

  return { planByeExpansion, planIncrementalExpansion };
});

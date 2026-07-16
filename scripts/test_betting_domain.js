"use strict";

const assert = require("node:assert/strict");
const domain = require("../betting-domain.js");

function test(name, callback) {
  try {
    callback();
    process.stdout.write(`✓ ${name}\n`);
  } catch (error) {
    process.stderr.write(`✗ ${name}\n`);
    throw error;
  }
}

test("preserva a regra recreativa antiga", () => {
  const preview = domain.calculatePreview({ stake: 100, rules: { payoutMultiplier: 2 } });
  assert.equal(preview.potentialReturn, 200);
  assert.equal(preview.lossAmount, 0);
  assert.equal(preview.refundOnLoss, 100);
});

test("calcula perda integral e parcial", () => {
  assert.equal(domain.calculatePreview({ stake: 101, rules: { lossPolicy: "forfeit" } }).lossAmount, 101);
  assert.equal(domain.calculatePreview({
    stake: 101,
    rules: { lossPolicy: "partial", lossRefundPercent: 40 },
  }).lossAmount, 60);
});

test("calcula odd comunitária e aplica limites", () => {
  const rules = { oddsMode: "crowd", minimumCrowdStake: 10, minimumOdds: 1.25, maximumOdds: 4 };
  assert.equal(domain.calculateCrowdOdds({ winnerStake: 50, totalStake: 100, rules }), 2);
  assert.equal(domain.calculateCrowdOdds({ winnerStake: 1, totalStake: 100, rules }), 4);
  assert.equal(domain.calculateCrowdOdds({ winnerStake: 99, totalStake: 100, rules }), 1.25);
});

test("usa odd fixa quando a amostra comunitária é insuficiente", () => {
  const odds = domain.calculateCrowdOdds({
    winnerStake: 2,
    totalStake: 9,
    rules: { oddsMode: "crowd", minimumCrowdStake: 10, fixedOdds: 1.8 },
  });
  assert.equal(odds, 1.8);
});

test("arredonda o retorno final para baixo", () => {
  const preview = domain.calculatePreview({ stake: 33, acceptedOdds: 1.75 });
  assert.equal(preview.potentialProfit, 24);
  assert.equal(preview.potentialReturn, 57);
});

test("fecha por início, bloqueio manual e horário", () => {
  assert.equal(domain.resolveLockState({ inProgress: true }, {}, new Date()).reason, "started");
  assert.equal(domain.resolveLockState({ bettingStatus: "locked" }, {}, new Date()).reason, "manual");
  const state = domain.resolveLockState(
    { scheduledAt: "2026-07-16T15:00:00Z" },
    { closePolicy: "scheduled_or_started", lockMinutesBefore: 10 },
    "2026-07-16T14:55:00Z",
  );
  assert.equal(state.locked, true);
  assert.equal(state.lockAt, "2026-07-16T14:50:00.000Z");
});

test("não fecha por horário na política started_only", () => {
  const state = domain.resolveLockState(
    { scheduledAt: "2026-07-16T15:00:00Z" },
    { closePolicy: "started_only" },
    "2026-07-16T16:00:00Z",
  );
  assert.equal(state.locked, false);
});

test("normaliza snapshot legado sem perder saldos", () => {
  const snapshot = domain.normalizeSnapshot({
    profile: { id: "p1", availableBalance: 950 },
    settings: { initialBalance: 1000, maxStake: 100, payoutMultiplier: 2 },
    myBets: [{ matchKind: "league", matchId: "m1", stake: 50, status: "pending" }],
  });
  assert.equal(snapshot.profile.availableBalance, 950);
  assert.equal(snapshot.rules.maxStake, 100);
  assert.equal(snapshot.myBets[0].potentialReturn, 100);
});

test("mantém snapshot aceito em aposta encerrada", () => {
  const bet = domain.normalizeBet({
    matchId: "m1",
    stake: 100,
    acceptedOdds: 3,
    status: "won",
    rulesSnapshot: { fixedOdds: 3, lossPolicy: "forfeit" },
  });
  assert.equal(bet.acceptedOdds, 3);
  assert.equal(bet.potentialReturn, 300);
  assert.equal(bet.rulesSnapshot.lossPolicy, "forfeit");
});

process.stdout.write("Domínio do bolão validado.\n");

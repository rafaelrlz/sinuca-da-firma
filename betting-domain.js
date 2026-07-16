(function (root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BettingDomain = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DEFAULT_RULES = Object.freeze({
    schemaVersion: 1,
    mode: "recreational",
    initialBalance: 10000,
    minStake: 1,
    maxStake: 500,
    roundStakeLimit: null,
    lossPolicy: "refund",
    lossRefundPercent: 100,
    oddsMode: "fixed",
    fixedOdds: 2,
    minimumOdds: 1.25,
    maximumOdds: 4,
    minimumCrowdStake: 100,
    closePolicy: "scheduled_or_started",
    lockMinutesBefore: 0,
    predictionVisibility: "after_lock",
    allowCancellation: true,
    virtualOnly: true,
  });

  function finiteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function normalizeRules(input) {
    const source = input && typeof input === "object" ? input : {};
    const legacyMultiplier = finiteNumber(source.payoutMultiplier, DEFAULT_RULES.fixedOdds);
    const lossPolicy = ["refund", "forfeit", "partial"].includes(source.lossPolicy)
      ? source.lossPolicy
      : DEFAULT_RULES.lossPolicy;
    const oddsMode = ["fixed", "crowd"].includes(source.oddsMode)
      ? source.oddsMode
      : DEFAULT_RULES.oddsMode;
    const closePolicy = ["started_only", "scheduled_or_started", "manual_or_started"].includes(source.closePolicy)
      ? source.closePolicy
      : DEFAULT_RULES.closePolicy;
    const minStake = Math.max(1, Math.floor(finiteNumber(source.minStake, DEFAULT_RULES.minStake)));
    const maxStake = Math.max(minStake, Math.floor(finiteNumber(source.maxStake, DEFAULT_RULES.maxStake)));
    const minimumOdds = Math.max(1, finiteNumber(source.minimumOdds, DEFAULT_RULES.minimumOdds));
    const maximumOdds = Math.max(minimumOdds, finiteNumber(source.maximumOdds, DEFAULT_RULES.maximumOdds));

    return {
      ...DEFAULT_RULES,
      ...source,
      schemaVersion: Math.max(1, Math.floor(finiteNumber(source.schemaVersion, 1))),
      initialBalance: Math.max(0, Math.floor(finiteNumber(source.initialBalance, DEFAULT_RULES.initialBalance))),
      minStake,
      maxStake,
      lossPolicy,
      lossRefundPercent: clamp(finiteNumber(source.lossRefundPercent, lossPolicy === "refund" ? 100 : 0), 0, 100),
      oddsMode,
      fixedOdds: clamp(finiteNumber(source.fixedOdds, legacyMultiplier), minimumOdds, maximumOdds),
      minimumOdds,
      maximumOdds,
      minimumCrowdStake: Math.max(0, Math.floor(finiteNumber(source.minimumCrowdStake, DEFAULT_RULES.minimumCrowdStake))),
      closePolicy,
      lockMinutesBefore: Math.max(0, Math.floor(finiteNumber(source.lockMinutesBefore, 0))),
      predictionVisibility: ["after_lock", "always", "admin_only"].includes(source.predictionVisibility)
        ? source.predictionVisibility
        : DEFAULT_RULES.predictionVisibility,
      allowCancellation: source.allowCancellation !== false,
      virtualOnly: true,
    };
  }

  function calculateCrowdOdds({ winnerStake = 0, totalStake = 0, rules = {} } = {}) {
    const normalized = normalizeRules(rules);
    const winner = Math.max(0, finiteNumber(winnerStake, 0));
    const total = Math.max(0, finiteNumber(totalStake, 0));
    if (
      normalized.oddsMode !== "crowd" ||
      total < normalized.minimumCrowdStake ||
      winner <= 0 ||
      winner > total
    ) {
      return normalized.fixedOdds;
    }
    return clamp(1 / (winner / total), normalized.minimumOdds, normalized.maximumOdds);
  }

  function calculatePreview({ stake, acceptedOdds, rules, winnerStake, totalStake } = {}) {
    const normalized = normalizeRules(rules);
    const safeStake = clamp(
      Math.floor(finiteNumber(stake, normalized.minStake)),
      normalized.minStake,
      normalized.maxStake,
    );
    const odds = clamp(
      finiteNumber(
        acceptedOdds,
        calculateCrowdOdds({ winnerStake, totalStake, rules: normalized }),
      ),
      normalized.minimumOdds,
      normalized.maximumOdds,
    );
    const potentialProfit = Math.floor(safeStake * Math.max(0, odds - 1));
    const potentialReturn = safeStake + potentialProfit;
    let lossAmount = 0;
    if (normalized.lossPolicy === "forfeit") lossAmount = safeStake;
    if (normalized.lossPolicy === "partial") {
      lossAmount = Math.floor(safeStake * (1 - normalized.lossRefundPercent / 100));
    }
    return {
      stake: safeStake,
      acceptedOdds: odds,
      potentialProfit,
      potentialReturn,
      lossAmount,
      refundOnLoss: safeStake - lossAmount,
      rules: normalized,
    };
  }

  function resolveLockState(match, rules, nowValue) {
    const normalized = normalizeRules(rules);
    const now = nowValue instanceof Date ? nowValue : new Date(nowValue || Date.now());
    const status = String(match?.bettingStatus || match?.betting_status || "inherit");
    const started = Boolean(match?.inProgress || match?.startedAt || match?.started_at);
    const settled = Boolean(match?.result || match?.winnerId || match?.settledAt || match?.settled_at);
    const manual = status === "locked" || status === "disabled" || Boolean(match?.manuallyLocked);
    const scheduledAt = match?.lockAt || match?.lock_at || match?.scheduledAt || match?.scheduled_at || "";
    const scheduled = scheduledAt ? new Date(scheduledAt) : null;
    const lockAt = scheduled && !Number.isNaN(scheduled.getTime())
      ? new Date(scheduled.getTime() - normalized.lockMinutesBefore * 60000)
      : null;
    const byTime = normalized.closePolicy === "scheduled_or_started" && lockAt && now >= lockAt;
    const locked = settled || started || manual || Boolean(byTime);
    let reason = "";
    if (settled) reason = "result";
    else if (started) reason = "started";
    else if (manual) reason = status === "disabled" ? "disabled" : "manual";
    else if (byTime) reason = "scheduled";
    return { locked, reason, lockAt: lockAt ? lockAt.toISOString() : "", status };
  }

  function normalizeBet(raw) {
    const bet = raw && typeof raw === "object" ? raw : {};
    const rules = normalizeRules(bet.rulesSnapshot || bet.rules_snapshot || bet.rules || {});
    const preview = calculatePreview({
      stake: bet.stake,
      acceptedOdds: bet.acceptedOdds ?? bet.accepted_odds ?? bet.odds ?? rules.fixedOdds,
      rules,
    });
    return {
      ...bet,
      id: String(bet.id || `${bet.matchKind || bet.match_kind || "league"}:${bet.matchId || bet.match_id || ""}`),
      matchKind: String(bet.matchKind || bet.match_kind || "league"),
      matchId: String(bet.matchId || bet.match_id || ""),
      playerAId: bet.playerAId || bet.player_a_id || "",
      playerBId: bet.playerBId || bet.player_b_id || "",
      predictedWinnerId: bet.predictedWinnerId || bet.predicted_winner_id || bet.winnerId || "",
      stake: preview.stake,
      acceptedOdds: preview.acceptedOdds,
      potentialReturn: Math.floor(finiteNumber(bet.potentialReturn ?? bet.potential_return, preview.potentialReturn)),
      settlementDelta: Math.floor(finiteNumber(bet.settlementDelta ?? bet.settlement_delta, 0)),
      settlementReason: String(bet.settlementReason || bet.settlement_reason || ""),
      status: String(bet.status || bet.settlementStatus || bet.settlement_status || "pending"),
      rulesSnapshot: rules,
      createdAt: bet.createdAt || bet.created_at || "",
      updatedAt: bet.updatedAt || bet.updated_at || bet.createdAt || bet.created_at || "",
      lockedAt: bet.lockedAt || bet.locked_at || "",
      settledAt: bet.settledAt || bet.settled_at || "",
      events: Array.isArray(bet.events) ? bet.events : [],
    };
  }

  function normalizeSnapshot(raw) {
    const snapshot = raw && typeof raw === "object" ? raw : {};
    const profileSource = snapshot.profile || snapshot.me || null;
    const settings = normalizeRules(snapshot.rules || snapshot.settings || {});
    const leaderboard = Array.isArray(snapshot.leaderboard)
      ? snapshot.leaderboard
      : Array.isArray(snapshot.rankings?.overall)
        ? snapshot.rankings.overall
        : [];
    const myBets = (snapshot.myBets || snapshot.history || snapshot.bets || []).map(normalizeBet);
    return {
      ...snapshot,
      profile: profileSource,
      leaderboard,
      myBets,
      settings,
      rules: settings,
      matches: Array.isArray(snapshot.matches) ? snapshot.matches : [],
      rankings: snapshot.rankings && typeof snapshot.rankings === "object"
        ? snapshot.rankings
        : { overall: leaderboard },
      achievements: snapshot.achievements || profileSource?.achievements || [],
      seasons: snapshot.seasons || [],
      activeSeason: snapshot.activeSeason || snapshot.season || null,
    };
  }

  function lossPolicyText(rules) {
    const normalized = normalizeRules(rules);
    if (normalized.lossPolicy === "forfeit") return "Se não acertar, as fichas usadas são descontadas.";
    if (normalized.lossPolicy === "partial") {
      return `Se não acertar, ${normalized.lossRefundPercent}% das fichas usadas voltam ao saldo.`;
    }
    return "Se não acertar, todas as fichas usadas voltam ao saldo.";
  }

  function statusGroup(status) {
    if (status === "pending" || status === "open" || status === "locked") return "open";
    if (status === "won") return "won";
    if (status === "lost") return "lost";
    if (status === "void" || status === "voided" || status === "cancelled") return "void";
    return "settled";
  }

  return {
    DEFAULT_RULES,
    calculateCrowdOdds,
    calculatePreview,
    lossPolicyText,
    normalizeBet,
    normalizeRules,
    normalizeSnapshot,
    resolveLockState,
    statusGroup,
  };
});

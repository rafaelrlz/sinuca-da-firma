"""Funções puras compartilhadas pelas migrações de dados do campeonato."""

from __future__ import annotations

from copy import deepcopy
import hashlib
import json
from typing import Iterable


def normalize_league_results(state: dict[str, object]) -> tuple[dict[str, object], list[str]]:
    """Converte resultados da liga para duelo único sem alterar outros dados."""
    normalized = deepcopy(state)
    try:
        normalized["version"] = max(4, int(normalized.get("version") or 0))
    except (TypeError, ValueError):
        normalized["version"] = 4
    changed_result_ids: list[str] = []
    league = normalized.get("league")
    if not isinstance(league, dict):
        return normalized, changed_result_ids

    results = league.get("results")
    if not isinstance(results, dict):
        results = {}
        league["results"] = results

    rounds = league.get("rounds") if isinstance(league.get("rounds"), list) else []
    valid_match_ids = {
        str(match.get("id"))
        for round_item in rounds
        if isinstance(round_item, dict)
        for match in (round_item.get("matches") or [])
        if isinstance(match, dict) and match.get("id")
    }
    raw_live = league.get("inProgress") if isinstance(league.get("inProgress"), dict) else {}
    league["inProgress"] = {
        str(match_id): True
        for match_id, active in raw_live.items()
        if active and str(match_id) in valid_match_ids and str(match_id) not in results
    }

    for result_id, result in results.items():
        if not isinstance(result, dict):
            raise ValueError(f"Resultado de liga inválido: {result_id!r} não é um objeto.")
        winner_id = result.get("winnerId")
        player_a_id = result.get("playerAId")
        player_b_id = result.get("playerBId")
        if winner_id == player_a_id and winner_id is not None:
            scores = (1, 0)
        elif winner_id == player_b_id and winner_id is not None:
            scores = (0, 1)
        else:
            raise ValueError(
                f"Resultado {result_id!r} tem winnerId fora dos participantes; migração abortada."
            )
        if (result.get("scoreA"), result.get("scoreB")) != scores:
            result["scoreA"], result["scoreB"] = scores
            changed_result_ids.append(str(result_id))

    return normalized, sorted(changed_result_ids)


def duel_signature(state: dict[str, object]) -> list[dict[str, object]]:
    """Retorna a assinatura ordenada e exata da tabela, sem regenerá-la."""
    league = state.get("league")
    if not isinstance(league, dict):
        return []
    rounds = league.get("rounds")
    if not isinstance(rounds, list):
        raise ValueError("league.rounds inválido; esperado uma lista.")

    signature: list[dict[str, object]] = []
    for round_item in rounds:
        if not isinstance(round_item, dict):
            raise ValueError("Rodada inválida; esperado um objeto.")
        matches = round_item.get("matches")
        if not isinstance(matches, list):
            raise ValueError(f"Rodada {round_item.get('number')!r} sem lista de duelos.")
        normalized_matches = []
        for match in matches:
            if not isinstance(match, dict):
                raise ValueError(f"Rodada {round_item.get('number')!r} contém duelo inválido.")
            normalized_matches.append({
                "id": match.get("id"),
                "playerAId": match.get("playerAId"),
                "playerBId": match.get("playerBId"),
            })
        signature.append({
            "number": round_item.get("number"),
            "byePlayerId": round_item.get("byePlayerId"),
            "matches": normalized_matches,
        })
    return signature


def _sorted_ids(values: Iterable[object]) -> list[str]:
    return sorted(str(value) for value in values)


def build_manifest(
    state: dict[str, object],
    bettors: list[dict[str, object]],
    bets: list[dict[str, object]],
) -> dict[str, object]:
    """Resume identidades e contagens que precisam sobreviver à migração."""
    players = state.get("players") if isinstance(state.get("players"), list) else []
    league = state.get("league") if isinstance(state.get("league"), dict) else {}
    results = league.get("results") if isinstance(league.get("results"), dict) else {}
    in_progress = league.get("inProgress") if isinstance(league.get("inProgress"), dict) else {}
    signature = duel_signature(state)
    duel_ids = [match["id"] for item in signature for match in item["matches"]]
    serialized_signature = json.dumps(
        signature, ensure_ascii=False, separators=(",", ":"), sort_keys=False
    )
    bet_keys = [
        f"{row.get('bettor_id')}|{row.get('match_kind')}|{row.get('match_id')}"
        for row in bets
    ]
    return {
        "players": {"count": len(players), "ids": _sorted_ids(p.get("id") for p in players)},
        "rounds": {"count": len(signature), "numbers": [item["number"] for item in signature]},
        "duels": {
            "count": len(duel_ids),
            "ids": _sorted_ids(duel_ids),
            "signature": signature,
            "sha256": hashlib.sha256(serialized_signature.encode("utf-8")).hexdigest(),
        },
        "resultIds": {"count": len(results), "ids": _sorted_ids(results)},
        "inProgress": {
            "count": len(in_progress),
            "ids": _sorted_ids(in_progress),
            "values": {str(key): in_progress[key] for key in sorted(in_progress)},
        },
        "bettors": {"count": len(bettors), "ids": _sorted_ids(row.get("id") for row in bettors)},
        "bets": {
            "count": len(bets),
            "ids": _sorted_ids(row.get("id") for row in bets),
            "keys": _sorted_ids(bet_keys),
        },
    }


def assert_manifests_equal(expected: dict[str, object], actual: dict[str, object]) -> None:
    """Interrompe a transação se qualquer identidade ou duelo divergir."""
    if expected == actual:
        return
    sections = [name for name in expected if expected.get(name) != actual.get(name)]
    details = json.dumps(
        {name: {"expected": expected.get(name), "actual": actual.get(name)} for name in sections},
        ensure_ascii=False,
        indent=2,
    )
    raise RuntimeError(f"Validação pós-escrita falhou em: {', '.join(sections)}\n{details}")

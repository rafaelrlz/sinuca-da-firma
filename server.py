"""API do campeonato com SQLite local ou PostgreSQL/Neon em produção."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse
import hashlib
import hmac
import json
import mimetypes
import os
import secrets
import socket
import threading
import time
import uuid
import webbrowser

from database import (
    DATABASE_PATH,
    IS_POSTGRES,
    connect_database,
    database_label,
    is_integrity_error,
)

HOST = "0.0.0.0"
PORT = int(os.environ.get("SINUCA_PORT", "3000"))
MAX_BODY_BYTES = 2 * 1024 * 1024
PROJECT_DIR = Path(__file__).resolve().parent
DATA_DIR = PROJECT_DIR / "data"
BACKUP_PATH = DATA_DIR / "backup-latest.json"
DB_LOCK = threading.Lock()
BET_ACTION_LOCK = threading.Lock()

ADMIN_USERNAME = os.environ.get("SINUCA_ADMIN_USER", "admin")
ADMIN_PASSWORD_OVERRIDE = os.environ.get("SINUCA_ADMIN_PASSWORD")
DEFAULT_PASSWORD_SALT = bytes.fromhex("9c7e21a47684b6124cf059e46dd84aed")
DEFAULT_PASSWORD_HASH = bytes.fromhex(
    "270d8e92fc21fc221eefd9fc9244be65be955898eb0d0534d3302409e8893e02"
)
PASSWORD_ITERATIONS = 200_000
SESSION_COOKIE = "sinuca_admin_session"
SESSION_DURATION = timedelta(hours=12)
LOGIN_WINDOW_SECONDS = 5 * 60
LOGIN_MAX_FAILURES = 5

BET_TOKEN_HEADER = "X-Bettor-Token"
BET_INITIAL_BALANCE = 10_000
BET_EXISTING_BALANCE_BONUS = 9_000
BET_MAX_STAKE = 500
BET_MAX_USERS = 200
BET_PIN_ITERATIONS = 120_000

STATIC_FILES = {
    "/": "index.html",
    "/index.html": "index.html",
    "/styles.css": "styles.css",
    "/league-schedule.js": "league-schedule.js",
    "/app.js": "app.js",
    "/login": "login.html",
    "/login/": "login.html",
    "/login.html": "login.html",
    "/login.js": "login.js",
    "/bolao": "bolao.html",
    "/bolao/": "bolao.html",
    "/bolao.html": "bolao.html",
    "/bolao.js": "bolao.js",
}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def create_default_state() -> dict[str, object]:
    now = utc_now()
    names = [
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
    ]
    return {
        "version": 3,
        "settings": {
            "title": "Sinuca da Firma",
            "scoreMode": "frames",
            "framesToWin": 2,
            "thirdPlace": True,
            "league": {
                "winPoints": 3,
                "lossPoints": 0,
            },
            "ranking": {
                "participation": 1,
                "win": 3,
                "champion": 10,
                "runnerUp": 7,
                "semifinal": 5,
                "quarterfinal": 3,
                "roundOf16": 1,
            },
        },
        "players": [
            {"id": f"player-{index}", "name": name, "createdAt": now}
            for index, name in enumerate(names, start=1)
        ],
        "league": None,
        "tournament": None,
        "activity": [
            {
                "id": f"activity-{uuid.uuid4()}",
                "type": "setup",
                "text": "Campeonato criado com 10 jogadores",
                "detail": "Lista inicial carregada",
                "at": now,
            }
        ],
    }


def migrate_bettor_initial_balance(connection: object) -> bool:
    """Concede uma única vez o bônus que eleva perfis antigos de 1.000 para 10.000."""
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS schema_migrations (
            migration_id TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL
        )
        """
    )
    cursor = connection.execute(
        """
        INSERT INTO schema_migrations (migration_id, applied_at)
        VALUES (?, ?)
        ON CONFLICT (migration_id) DO NOTHING
        """,
        ("bettor_initial_balance_10000_v1", utc_now()),
    )
    if cursor.rowcount != 1:
        return False
    connection.execute(
        """
        UPDATE bettors
        SET initial_balance = initial_balance + ?, updated_at = ?
        """,
        (BET_EXISTING_BALANCE_BONUS, utc_now()),
    )
    return True


def initialize_database() -> None:
    if not IS_POSTGRES:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
    bet_id_definition = "BIGSERIAL PRIMARY KEY" if IS_POSTGRES else "INTEGER PRIMARY KEY AUTOINCREMENT"
    failure_id_definition = "BIGSERIAL PRIMARY KEY" if IS_POSTGRES else "INTEGER PRIMARY KEY AUTOINCREMENT"
    with connect_database() as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS app_state (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                data TEXT NOT NULL,
                revision INTEGER NOT NULL DEFAULT 1,
                updated_at TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS bettors (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                name_key TEXT NOT NULL UNIQUE,
                pin_salt TEXT NOT NULL,
                pin_hash TEXT NOT NULL,
                token_hash TEXT,
                initial_balance INTEGER NOT NULL DEFAULT 10000,
                active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        connection.execute(
            f"""
            CREATE TABLE IF NOT EXISTS bets (
                id {bet_id_definition},
                bettor_id TEXT NOT NULL,
                match_kind TEXT NOT NULL,
                match_id TEXT NOT NULL,
                player_a_id TEXT NOT NULL,
                player_b_id TEXT NOT NULL,
                predicted_winner_id TEXT NOT NULL,
                stake INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE (bettor_id, match_kind, match_id),
                FOREIGN KEY (bettor_id) REFERENCES bettors(id) ON DELETE CASCADE
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS admin_sessions (
                token_hash TEXT PRIMARY KEY,
                expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        connection.execute(
            f"""
            CREATE TABLE IF NOT EXISTS login_failures (
                id {failure_id_definition},
                client_key TEXT NOT NULL,
                attempted_at DOUBLE PRECISION NOT NULL
            )
            """
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_bets_bettor ON bets(bettor_id)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_login_failures_client ON login_failures(client_key, attempted_at)"
        )
        migrate_bettor_initial_balance(connection)
        existing = connection.execute(
            "SELECT 1 FROM app_state WHERE id = 1"
        ).fetchone()
        if existing is None:
            state = create_default_state()
            updated_at = utc_now()
            connection.execute(
                "INSERT INTO app_state (id, data, revision, updated_at) VALUES (1, ?, 1, ?)",
                (json.dumps(state, ensure_ascii=False, separators=(",", ":")), updated_at),
            )
            if not IS_POSTGRES:
                write_backup(state, 1, updated_at)
        connection.commit()


def read_state() -> dict[str, object]:
    with DB_LOCK, connect_database() as connection:
        row = connection.execute(
            "SELECT data, revision, updated_at FROM app_state WHERE id = 1"
        ).fetchone()

    if row is None:
        return {"state": None, "revision": 0, "updatedAt": None}

    try:
        state = json.loads(row["data"])
    except json.JSONDecodeError as error:
        raise RuntimeError("O estado salvo no banco está corrompido.") from error

    normalize_state_contract(state)
    return {
        "state": state,
        "revision": int(row["revision"]),
        "updatedAt": row["updated_at"],
    }


def normalize_state_contract(state: dict[str, object]) -> None:
    """Aplica regras atuais sem descartar dados legados do campeonato."""
    state["version"] = max(4, int(state.get("version") or 0))
    league = state.get("league")
    if not isinstance(league, dict):
        return

    rounds = league.get("rounds") if isinstance(league.get("rounds"), list) else []
    valid_match_ids = {
        str(match.get("id"))
        for round_item in rounds
        if isinstance(round_item, dict)
        for match in (round_item.get("matches") or [])
        if isinstance(match, dict) and match.get("id")
    }
    results = league.get("results") if isinstance(league.get("results"), dict) else {}
    live_matches = league.get("inProgress") if isinstance(league.get("inProgress"), dict) else {}

    normalized_live: dict[str, bool] = {}
    for match_id, active in live_matches.items():
        key = str(match_id)
        if active and key in valid_match_ids and key not in results:
            normalized_live[key] = True
    league["inProgress"] = normalized_live

    for result in results.values():
        if not isinstance(result, dict):
            continue
        winner_id = result.get("winnerId")
        player_a_id = result.get("playerAId")
        player_b_id = result.get("playerBId")
        if winner_id == player_a_id:
            result["scoreA"], result["scoreB"] = 1, 0
        elif winner_id == player_b_id:
            result["scoreA"], result["scoreB"] = 0, 1


def write_backup(state: dict[str, object], revision: int, updated_at: str) -> None:
    payload = {
        "revision": revision,
        "updatedAt": updated_at,
        "state": state,
    }
    temporary_path = BACKUP_PATH.with_suffix(".json.tmp")
    temporary_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    temporary_path.replace(BACKUP_PATH)


def save_state(state: dict[str, object]) -> dict[str, object]:
    normalize_state_contract(state)
    serialized = json.dumps(state, ensure_ascii=False, separators=(",", ":"))
    updated_at = utc_now()

    with DB_LOCK, connect_database() as connection:
        if not IS_POSTGRES:
            connection.execute("BEGIN IMMEDIATE")
        revision_query = "SELECT revision FROM app_state WHERE id = 1"
        if IS_POSTGRES:
            revision_query += " FOR UPDATE"
        current = connection.execute(revision_query).fetchone()
        revision = (int(current["revision"]) + 1) if current else 1
        connection.execute(
            """
            INSERT INTO app_state (id, data, revision, updated_at)
            VALUES (1, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                data = excluded.data,
                revision = excluded.revision,
                updated_at = excluded.updated_at
            """,
            (serialized, revision, updated_at),
        )
        connection.commit()
        if not IS_POSTGRES:
            write_backup(state, revision, updated_at)

    return {"ok": True, "revision": revision, "updatedAt": updated_at}



def normalize_bettor_name(value: object) -> tuple[str, str]:
    name = " ".join(str(value or "").strip().split())
    if not (2 <= len(name) <= 30):
        raise ValueError("O nome do bolão deve ter entre 2 e 30 caracteres.")
    if any(ord(character) < 32 for character in name):
        raise ValueError("O nome contém caracteres inválidos.")
    return name, name.casefold()


def validate_bettor_pin(value: object) -> str:
    pin = str(value or "").strip()
    if not pin.isdigit() or not (4 <= len(pin) <= 8):
        raise ValueError("Use um PIN numérico de 4 a 8 dígitos.")
    return pin


def hash_bettor_pin(pin: str, salt_hex: str) -> str:
    return hashlib.pbkdf2_hmac(
        "sha256",
        pin.encode("utf-8"),
        bytes.fromhex(salt_hex),
        BET_PIN_ITERATIONS,
    ).hex()


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def issue_bettor_token(connection: object, bettor_id: str) -> str:
    token = secrets.token_urlsafe(36)
    connection.execute(
        "UPDATE bettors SET token_hash = ?, updated_at = ? WHERE id = ?",
        (token_digest(token), utc_now(), bettor_id),
    )
    return token


def register_bettor(name_value: object, pin_value: object) -> dict[str, object]:
    name, name_key = normalize_bettor_name(name_value)
    pin = validate_bettor_pin(pin_value)
    now = utc_now()
    bettor_id = f"bettor-{uuid.uuid4()}"
    salt_hex = secrets.token_bytes(16).hex()
    pin_hash = hash_bettor_pin(pin, salt_hex)

    with DB_LOCK, connect_database() as connection:
        count_row = connection.execute(
            "SELECT COUNT(*) AS total FROM bettors"
        ).fetchone()
        count = int(count_row["total"])
        if count >= BET_MAX_USERS:
            raise ValueError("O bolão atingiu o limite de participantes.")
        try:
            connection.execute(
                """
                INSERT INTO bettors
                    (id, name, name_key, pin_salt, pin_hash, initial_balance, active, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
                """,
                (bettor_id, name, name_key, salt_hex, pin_hash, BET_INITIAL_BALANCE, now, now),
            )
        except Exception as error:
            if is_integrity_error(error):
                raise ValueError("Esse nome já está sendo usado no bolão.") from error
            raise
        token = issue_bettor_token(connection, bettor_id)
        connection.commit()
    return {"token": token, "name": name}


def login_bettor(name_value: object, pin_value: object) -> dict[str, object]:
    name, name_key = normalize_bettor_name(name_value)
    pin = validate_bettor_pin(pin_value)
    with DB_LOCK, connect_database() as connection:
        row = connection.execute(
            "SELECT id, name, pin_salt, pin_hash, active FROM bettors WHERE name_key = ?",
            (name_key,),
        ).fetchone()
        if row is None or not row["active"]:
            raise PermissionError("Nome ou PIN incorretos.")
        calculated = hash_bettor_pin(pin, row["pin_salt"])
        if not hmac.compare_digest(calculated, row["pin_hash"]):
            raise PermissionError("Nome ou PIN incorretos.")
        token = issue_bettor_token(connection, row["id"])
        connection.commit()
    return {"token": token, "name": row["name"] or name}


def bettor_from_token(token: str | None) -> object | None:
    if not token:
        return None
    digest = token_digest(token)
    with DB_LOCK, connect_database() as connection:
        return connection.execute(
            """
            SELECT id, name, initial_balance, active, created_at
            FROM bettors
            WHERE token_hash = ? AND active = 1
            """,
            (digest,),
        ).fetchone()


def valid_result(result: object, player_a_id: str | None, player_b_id: str | None) -> dict[str, object] | None:
    if not isinstance(result, dict) or not player_a_id or not player_b_id:
        return None
    if result.get("playerAId") != player_a_id or result.get("playerBId") != player_b_id:
        return None
    if result.get("winnerId") not in (player_a_id, player_b_id):
        return None
    return result


def collect_bettable_matches(state: dict[str, object]) -> dict[tuple[str, str], dict[str, object]]:
    matches: dict[tuple[str, str], dict[str, object]] = {}
    league = state.get("league")
    if isinstance(league, dict):
        results = league.get("results") if isinstance(league.get("results"), dict) else {}
        in_progress = league.get("inProgress") if isinstance(league.get("inProgress"), dict) else {}
        rounds = league.get("rounds") if isinstance(league.get("rounds"), list) else []
        for round_item in rounds:
            if not isinstance(round_item, dict):
                continue
            round_number = int(round_item.get("number") or 0)
            for match in round_item.get("matches") or []:
                if not isinstance(match, dict):
                    continue
                match_id = str(match.get("id") or "")
                player_a_id = match.get("playerAId")
                player_b_id = match.get("playerBId")
                if not match_id or not isinstance(player_a_id, str) or not isinstance(player_b_id, str):
                    continue
                result = valid_result(results.get(match_id), player_a_id, player_b_id)
                matches[("league", match_id)] = {
                    "matchKind": "league",
                    "matchId": match_id,
                    "roundName": f"Liga · Rodada {round_number}",
                    "playerAId": player_a_id,
                    "playerBId": player_b_id,
                    "winnerId": result.get("winnerId") if result else None,
                    "result": result,
                    "inProgress": bool(in_progress.get(match_id)) and result is None,
                }

    tournament = state.get("tournament")
    if isinstance(tournament, dict):
        try:
            bracket_size = int(tournament.get("bracketSize") or 0)
        except (TypeError, ValueError):
            bracket_size = 0
        seeds = tournament.get("seeds") if isinstance(tournament.get("seeds"), list) else []
        results = tournament.get("results") if isinstance(tournament.get("results"), dict) else {}
        if bracket_size >= 2 and bracket_size & (bracket_size - 1) == 0:
            round_count = bracket_size.bit_length() - 1
            previous: list[dict[str, object]] | None = None
            built_rounds: list[list[dict[str, object]]] = []
            for round_index in range(round_count):
                match_count = bracket_size // (2 ** (round_index + 1))
                current: list[dict[str, object]] = []
                round_names = {1: "Final", 2: "Semifinais", 4: "Quartas de final", 8: "Oitavas de final", 16: "Primeira fase"}
                round_name = round_names.get(match_count, f"Rodada de {match_count * 2}")
                for match_index in range(match_count):
                    match_id = f"r{round_index}m{match_index}"
                    if round_index == 0:
                        player_a_id = seeds[match_index * 2] if match_index * 2 < len(seeds) else None
                        player_b_id = seeds[match_index * 2 + 1] if match_index * 2 + 1 < len(seeds) else None
                    else:
                        left = previous[match_index * 2] if previous and match_index * 2 < len(previous) else {}
                        right = previous[match_index * 2 + 1] if previous and match_index * 2 + 1 < len(previous) else {}
                        player_a_id = left.get("winnerId")
                        player_b_id = right.get("winnerId")
                    result = valid_result(results.get(match_id), player_a_id, player_b_id)
                    automatic = round_index == 0 and bool(player_a_id) != bool(player_b_id)
                    winner_id = (player_a_id or player_b_id) if automatic else (result.get("winnerId") if result else None)
                    loser_id = None
                    if result and winner_id:
                        loser_id = player_b_id if winner_id == player_a_id else player_a_id
                    built = {
                        "matchId": match_id,
                        "playerAId": player_a_id,
                        "playerBId": player_b_id,
                        "winnerId": winner_id,
                        "loserId": loser_id,
                        "result": result,
                    }
                    current.append(built)
                    if isinstance(player_a_id, str) and isinstance(player_b_id, str):
                        matches[("bracket", match_id)] = {
                            "matchKind": "bracket",
                            "matchId": match_id,
                            "roundName": round_name,
                            "playerAId": player_a_id,
                            "playerBId": player_b_id,
                            "winnerId": result.get("winnerId") if result else None,
                            "result": result,
                        }
                built_rounds.append(current)
                previous = current

            settings = state.get("settings") if isinstance(state.get("settings"), dict) else {}
            if settings.get("thirdPlace") and len(built_rounds) >= 2:
                semifinals = built_rounds[-2]
                player_a_id = semifinals[0].get("loserId") if len(semifinals) > 0 else None
                player_b_id = semifinals[1].get("loserId") if len(semifinals) > 1 else None
                third_result = valid_result(tournament.get("thirdPlaceResult"), player_a_id, player_b_id)
                if isinstance(player_a_id, str) and isinstance(player_b_id, str):
                    matches[("third", "third-place")] = {
                        "matchKind": "third",
                        "matchId": "third-place",
                        "roundName": "Disputa de 3º lugar",
                        "playerAId": player_a_id,
                        "playerBId": player_b_id,
                        "winnerId": third_result.get("winnerId") if third_result else None,
                        "result": third_result,
                    }
    return matches


def bet_status(row: object, matches: dict[tuple[str, str], dict[str, object]]) -> tuple[str, int]:
    match = matches.get((row["match_kind"], row["match_id"]))
    if (
        match is None
        or match.get("playerAId") != row["player_a_id"]
        or match.get("playerBId") != row["player_b_id"]
    ):
        return "void", int(row["stake"])
    winner_id = match.get("winnerId")
    if not winner_id:
        return "pending", 0
    if winner_id == row["predicted_winner_id"]:
        return "won", int(row["stake"]) * 2
    return "lost", int(row["stake"])


def betting_snapshot(token: str | None) -> dict[str, object]:
    state_payload = read_state()
    state = state_payload.get("state") if isinstance(state_payload.get("state"), dict) else {}
    matches = collect_bettable_matches(state)
    bettor = bettor_from_token(token)

    with DB_LOCK, connect_database() as connection:
        bettors = connection.execute(
            "SELECT id, name, initial_balance, created_at FROM bettors WHERE active = 1 ORDER BY created_at"
        ).fetchall()
        all_bets = connection.execute(
            "SELECT * FROM bets ORDER BY created_at"
        ).fetchall()

    bets_by_bettor: dict[str, list[object]] = {}
    for bet in all_bets:
        bets_by_bettor.setdefault(bet["bettor_id"], []).append(bet)

    leaderboard: list[dict[str, object]] = []
    profile: dict[str, object] | None = None
    my_bets: list[dict[str, object]] = []

    for person in bettors:
        initial = int(person["initial_balance"])
        profit = 0
        pending_stake = 0
        wins = losses = pending = voided = 0
        person_bets = bets_by_bettor.get(person["id"], [])
        for bet in person_bets:
            status, payout = bet_status(bet, matches)
            stake = int(bet["stake"])
            if status == "won":
                profit += stake
                wins += 1
            elif status == "lost":
                losses += 1
            elif status == "pending":
                pending_stake += stake
                pending += 1
            else:
                voided += 1
            if bettor is not None and person["id"] == bettor["id"]:
                my_bets.append({
                    "matchKind": bet["match_kind"],
                    "matchId": bet["match_id"],
                    "playerAId": bet["player_a_id"],
                    "playerBId": bet["player_b_id"],
                    "predictedWinnerId": bet["predicted_winner_id"],
                    "stake": stake,
                    "status": status,
                    "payout": payout,
                    "createdAt": bet["created_at"],
                    "updatedAt": bet["updated_at"],
                })
        settled_balance = initial + profit
        available_balance = settled_balance - pending_stake
        total_settled = wins + losses
        row = {
            "id": person["id"],
            "name": person["name"],
            "settledBalance": settled_balance,
            "availableBalance": available_balance,
            "pendingStake": pending_stake,
            "profit": profit,
            "wins": wins,
            "losses": losses,
            "pending": pending,
            "voided": voided,
            "accuracy": round((wins / total_settled) * 100) if total_settled else 0,
            "betCount": len(person_bets),
        }
        leaderboard.append(row)
        if bettor is not None and person["id"] == bettor["id"]:
            profile = row | {"initialBalance": initial}

    leaderboard.sort(key=lambda item: (-int(item["settledBalance"]), -int(item["wins"]), str(item["name"]).casefold()))
    my_bets.sort(key=lambda item: str(item["updatedAt"]), reverse=True)
    return {
        "profile": profile,
        "leaderboard": leaderboard,
        "myBets": my_bets,
        "settings": {
            "initialBalance": BET_INITIAL_BALANCE,
            "maxStake": BET_MAX_STAKE,
            "payoutMultiplier": 2,
            "virtualOnly": True,
        },
    }


def place_wager(token: str | None, body: dict[str, object]) -> dict[str, object]:
    bettor = bettor_from_token(token)
    if bettor is None:
        raise PermissionError("Entre no bolão para apostar fichas virtuais.")
    match_kind = str(body.get("matchKind") or "")
    match_id = str(body.get("matchId") or "")
    predicted_winner_id = str(body.get("predictedWinnerId") or "")
    try:
        stake = int(body.get("stake") or 0)
    except (TypeError, ValueError) as error:
        raise ValueError("A quantidade de fichas é inválida.") from error
    if match_kind != "league" or not match_id:
        raise ValueError("Partida inválida.")
    if not (1 <= stake <= BET_MAX_STAKE):
        raise ValueError(f"A aposta deve ser de 1 a {BET_MAX_STAKE} fichas.")

    state_payload = read_state()
    state = state_payload.get("state") if isinstance(state_payload.get("state"), dict) else {}
    matches = collect_bettable_matches(state)
    match = matches.get((match_kind, match_id))
    if match is None or match.get("winnerId"):
        raise ValueError("Essa partida não está disponível para apostas.")
    if match.get("inProgress"):
        raise ValueError("Essa partida já está em andamento e não aceita mais apostas.")
    if predicted_winner_id not in {match.get("playerAId"), match.get("playerBId")}:
        raise ValueError("Escolha um dos jogadores desta partida.")

    snapshot = betting_snapshot(token)
    profile = snapshot.get("profile")
    if not isinstance(profile, dict):
        raise PermissionError("Perfil do bolão não encontrado.")

    with DB_LOCK, connect_database() as connection:
        existing = connection.execute(
            "SELECT * FROM bets WHERE bettor_id = ? AND match_kind = ? AND match_id = ?",
            (bettor["id"], match_kind, match_id),
        ).fetchone()
        refundable = 0
        if existing is not None:
            status, _ = bet_status(existing, matches)
            if status not in {"pending", "void"}:
                raise ValueError("Essa aposta já foi encerrada.")
            refundable = int(existing["stake"]) if status == "pending" else 0
        available = int(profile.get("availableBalance") or 0) + refundable
        if stake > available:
            raise ValueError(f"Saldo insuficiente. Você tem {available} fichas disponíveis.")
        now = utc_now()
        connection.execute(
            """
            INSERT INTO bets
                (bettor_id, match_kind, match_id, player_a_id, player_b_id, predicted_winner_id, stake, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(bettor_id, match_kind, match_id) DO UPDATE SET
                player_a_id = excluded.player_a_id,
                player_b_id = excluded.player_b_id,
                predicted_winner_id = excluded.predicted_winner_id,
                stake = excluded.stake,
                updated_at = excluded.updated_at
            """,
            (
                bettor["id"], match_kind, match_id,
                match["playerAId"], match["playerBId"], predicted_winner_id,
                stake, now, now,
            ),
        )
        connection.commit()
    return betting_snapshot(token)


def cancel_wager(token: str | None, body: dict[str, object]) -> dict[str, object]:
    bettor = bettor_from_token(token)
    if bettor is None:
        raise PermissionError("Entre no bolão para cancelar uma aposta.")
    match_kind = str(body.get("matchKind") or "")
    match_id = str(body.get("matchId") or "")
    state_payload = read_state()
    state = state_payload.get("state") if isinstance(state_payload.get("state"), dict) else {}
    matches = collect_bettable_matches(state)
    match = matches.get((match_kind, match_id))
    if match is not None and match.get("inProgress"):
        raise ValueError("Essa partida está em andamento; a aposta não pode ser cancelada.")
    with DB_LOCK, connect_database() as connection:
        existing = connection.execute(
            "SELECT * FROM bets WHERE bettor_id = ? AND match_kind = ? AND match_id = ?",
            (bettor["id"], match_kind, match_id),
        ).fetchone()
        if existing is None:
            raise ValueError("Aposta não encontrada.")
        status, _ = bet_status(existing, matches)
        if status not in {"pending", "void"}:
            raise ValueError("Uma aposta encerrada não pode ser cancelada.")
        connection.execute("DELETE FROM bets WHERE id = ?", (existing["id"],))
        connection.commit()
    return betting_snapshot(token)


def reset_betting_pool() -> None:
    with DB_LOCK, connect_database() as connection:
        connection.execute("DELETE FROM bets")
        connection.execute("DELETE FROM bettors")
        connection.commit()


def verify_admin_credentials(username: str, password: str) -> bool:
    if os.environ.get("VERCEL") and ADMIN_PASSWORD_OVERRIDE is None:
        return False
    username_matches = hmac.compare_digest(username, ADMIN_USERNAME)
    if ADMIN_PASSWORD_OVERRIDE is None:
        password_hash = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            DEFAULT_PASSWORD_SALT,
            PASSWORD_ITERATIONS,
        )
        password_matches = hmac.compare_digest(password_hash, DEFAULT_PASSWORD_HASH)
    else:
        password_matches = hmac.compare_digest(password, ADMIN_PASSWORD_OVERRIDE)
    return username_matches and password_matches


def create_session() -> tuple[str, datetime]:
    token = secrets.token_urlsafe(36)
    expires_at = datetime.now(timezone.utc) + SESSION_DURATION
    now = utc_now()
    with connect_database() as connection:
        connection.execute(
            "DELETE FROM admin_sessions WHERE expires_at <= ?",
            (now,),
        )
        connection.execute(
            "INSERT INTO admin_sessions (token_hash, expires_at, created_at) VALUES (?, ?, ?)",
            (token_digest(token), expires_at.isoformat(timespec="seconds"), now),
        )
        connection.commit()
    return token, expires_at


def session_is_valid(token: str | None) -> bool:
    if not token:
        return False
    now = utc_now()
    with connect_database() as connection:
        connection.execute(
            "DELETE FROM admin_sessions WHERE expires_at <= ?",
            (now,),
        )
        row = connection.execute(
            "SELECT 1 AS valid FROM admin_sessions WHERE token_hash = ? AND expires_at > ?",
            (token_digest(token), now),
        ).fetchone()
        connection.commit()
    return row is not None


def invalidate_session(token: str | None) -> None:
    if not token:
        return
    with connect_database() as connection:
        connection.execute(
            "DELETE FROM admin_sessions WHERE token_hash = ?",
            (token_digest(token),),
        )
        connection.commit()


def discover_lan_addresses() -> list[str]:
    addresses: set[str] = set()
    try:
        hostname = socket.gethostname()
        for item in socket.getaddrinfo(hostname, None, socket.AF_INET):
            address = item[4][0]
            if not address.startswith("127."):
                addresses.add(address)
    except OSError:
        pass

    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            probe.connect(("8.8.8.8", 80))
            address = probe.getsockname()[0]
            if not address.startswith("127."):
                addresses.add(address)
    except OSError:
        pass

    return sorted(addresses)


class TournamentHandler(SimpleHTTPRequestHandler):
    server_version = "SinucaLocal/5.0"

    def request_path(self) -> str:
        parsed = urlparse(self.path)
        if parsed.path == "/api":
            route = parse_qs(parsed.query).get("route", [""])[0].strip("/")
            if route:
                return f"/api/{route}"
        return parsed.path

    def end_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; "
            "base-uri 'none'; form-action 'self'",
        )
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def list_directory(self, path: str):  # type: ignore[override]
        self.send_error(HTTPStatus.FORBIDDEN, "Listagem de diretório desativada")
        return None

    def do_HEAD(self) -> None:  # noqa: N802
        path = self.request_path()
        if path.startswith("/assets/"):
            self.send_static_file(path.lstrip("/"), head_only=True)
            return
        if path in STATIC_FILES:
            filename = STATIC_FILES[path]
            file_path = (PROJECT_DIR / filename).resolve()
            if file_path.parent != PROJECT_DIR or not file_path.is_file():
                self.send_error(HTTPStatus.NOT_FOUND)
                return
            content_type, _ = mimetypes.guess_type(file_path.name)
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", f"{content_type or 'application/octet-stream'}; charset=utf-8")
            self.send_header("Content-Length", str(file_path.stat().st_size))
            self.end_headers()
            return
        if path == "/favicon.ico":
            self.send_response(HTTPStatus.NO_CONTENT)
            self.end_headers()
            return
        self.send_error(HTTPStatus.NOT_FOUND, "Recurso não encontrado")

    def do_GET(self) -> None:  # noqa: N802
        path = self.request_path()
        if path == "/api/state":
            try:
                self.send_json(HTTPStatus.OK, read_state())
            except Exception as error:  # pragma: no cover
                self.send_json(
                    HTTPStatus.INTERNAL_SERVER_ERROR,
                    {"error": "Não foi possível ler o banco.", "detail": str(error)},
                )
            return

        if path == "/api/bets":
            try:
                self.send_json(HTTPStatus.OK, betting_snapshot(self.bettor_token()))
            except Exception as error:  # pragma: no cover
                self.send_json(
                    HTTPStatus.INTERNAL_SERVER_ERROR,
                    {"error": "Não foi possível carregar o bolão.", "detail": str(error)},
                )
            return

        if path == "/api/auth":
            authenticated = self.is_authenticated()
            self.send_json(
                HTTPStatus.OK,
                {
                    "authenticated": authenticated,
                    "username": ADMIN_USERNAME if authenticated else None,
                },
            )
            return

        if path == "/api/health":
            self.send_json(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "database": database_label(),
                    "port": PORT,
                    "authentication": "enabled",
                },
            )
            return

        if path == "/favicon.ico":
            self.send_response(HTTPStatus.NO_CONTENT)
            self.end_headers()
            return

        filename = STATIC_FILES.get(path)
        if filename:
            self.send_static_file(filename)
            return

        if path.startswith("/assets/"):
            self.send_static_file(path.lstrip("/"))
            return

        # Não permite baixar server.py, banco, backups ou qualquer outro arquivo.
        self.send_error(HTTPStatus.NOT_FOUND, "Recurso não encontrado")

    def do_PUT(self) -> None:  # noqa: N802
        path = self.request_path()
        if path != "/api/state":
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        if not self.require_authentication():
            return

        try:
            body = self.read_json_body()
            state = body.get("state")
            if not isinstance(state, dict):
                self.send_json(
                    HTTPStatus.BAD_REQUEST,
                    {"error": "O campo 'state' deve ser um objeto JSON."},
                )
                return
            with BET_ACTION_LOCK:
                self.send_json(HTTPStatus.OK, save_state(state))
        except ValueError as error:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
        except Exception as error:  # pragma: no cover
            self.send_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"error": "Não foi possível salvar no banco.", "detail": str(error)},
            )

    def do_POST(self) -> None:  # noqa: N802
        path = self.request_path()
        if path == "/api/bettors/register":
            self.handle_bettor_register()
            return
        if path == "/api/bettors/login":
            self.handle_bettor_login()
            return
        if path == "/api/bets/wager":
            self.handle_wager()
            return
        if path == "/api/bets/cancel":
            self.handle_cancel_wager()
            return
        if path == "/api/bets/reset":
            if not self.require_authentication():
                return
            reset_betting_pool()
            self.send_json(HTTPStatus.OK, {"ok": True})
            return
        if path == "/api/login":
            self.handle_login()
            return
        if path == "/api/logout":
            self.handle_logout()
            return
        if path == "/api/state":
            self.do_PUT()
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def bettor_token(self) -> str | None:
        value = self.headers.get(BET_TOKEN_HEADER)
        return value.strip() if value else None

    def handle_bettor_register(self) -> None:
        try:
            body = self.read_json_body()
            result = register_bettor(body.get("name"), body.get("pin"))
            self.send_json(HTTPStatus.CREATED, {"ok": True, **result})
        except ValueError as error:
            status = HTTPStatus.CONFLICT if "já está" in str(error) else HTTPStatus.BAD_REQUEST
            self.send_json(status, {"error": str(error)})
        except Exception as error:  # pragma: no cover
            self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "Não foi possível criar o perfil.", "detail": str(error)})

    def handle_bettor_login(self) -> None:
        try:
            body = self.read_json_body()
            result = login_bettor(body.get("name"), body.get("pin"))
            self.send_json(HTTPStatus.OK, {"ok": True, **result})
        except (ValueError, PermissionError) as error:
            self.send_json(HTTPStatus.UNAUTHORIZED, {"error": str(error)})
        except Exception as error:  # pragma: no cover
            self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "Não foi possível entrar no bolão.", "detail": str(error)})

    def handle_wager(self) -> None:
        try:
            body = self.read_json_body()
            with BET_ACTION_LOCK:
                snapshot = place_wager(self.bettor_token(), body)
            self.send_json(HTTPStatus.OK, snapshot)
        except PermissionError as error:
            self.send_json(HTTPStatus.UNAUTHORIZED, {"error": str(error)})
        except ValueError as error:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
        except Exception as error:  # pragma: no cover
            self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "Não foi possível salvar a aposta.", "detail": str(error)})

    def handle_cancel_wager(self) -> None:
        try:
            body = self.read_json_body()
            with BET_ACTION_LOCK:
                snapshot = cancel_wager(self.bettor_token(), body)
            self.send_json(HTTPStatus.OK, snapshot)
        except PermissionError as error:
            self.send_json(HTTPStatus.UNAUTHORIZED, {"error": str(error)})
        except ValueError as error:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
        except Exception as error:  # pragma: no cover
            self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "Não foi possível cancelar a aposta.", "detail": str(error)})

    def handle_login(self) -> None:
        forwarded_for = self.headers.get("X-Forwarded-For", "")
        client_key = forwarded_for.split(",", 1)[0].strip() or self.client_address[0]
        retry_after = self.login_retry_after(client_key)
        if retry_after > 0:
            self.send_json(
                HTTPStatus.TOO_MANY_REQUESTS,
                {
                    "error": "Muitas tentativas incorretas. Aguarde alguns minutos.",
                    "retryAfter": retry_after,
                },
            )
            return

        try:
            body = self.read_json_body()
        except ValueError as error:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            return

        username = str(body.get("username") or "")
        password = str(body.get("password") or "")
        if not verify_admin_credentials(username, password):
            self.register_login_failure(client_key)
            time.sleep(0.25)
            self.send_json(
                HTTPStatus.UNAUTHORIZED,
                {"error": "Usuário ou senha incorretos."},
            )
            return

        self.clear_login_failures(client_key)
        token, expires_at = create_session()
        max_age = int(SESSION_DURATION.total_seconds())
        secure = "; Secure" if os.environ.get("VERCEL") == "1" else ""
        cookie = (
            f"{SESSION_COOKIE}={token}; Path=/; HttpOnly; SameSite=Strict; "
            f"Max-Age={max_age}; Expires={format_datetime(expires_at, usegmt=True)}{secure}"
        )
        self.send_json(
            HTTPStatus.OK,
            {"ok": True, "authenticated": True, "username": ADMIN_USERNAME},
            extra_headers={"Set-Cookie": cookie},
        )

    def handle_logout(self) -> None:
        invalidate_session(self.session_token())
        expired = datetime.now(timezone.utc) - timedelta(days=1)
        secure = "; Secure" if os.environ.get("VERCEL") == "1" else ""
        cookie = (
            f"{SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; "
            f"Max-Age=0; Expires={format_datetime(expired, usegmt=True)}{secure}"
        )
        self.send_json(
            HTTPStatus.OK,
            {"ok": True, "authenticated": False},
            extra_headers={"Set-Cookie": cookie},
        )

    def login_retry_after(self, client_key: str) -> int:
        now = time.time()
        cutoff = now - LOGIN_WINDOW_SECONDS
        with connect_database() as connection:
            connection.execute(
                "DELETE FROM login_failures WHERE attempted_at < ?",
                (cutoff,),
            )
            rows = connection.execute(
                "SELECT attempted_at FROM login_failures WHERE client_key = ? ORDER BY attempted_at",
                (client_key,),
            ).fetchall()
            connection.commit()
        if len(rows) < LOGIN_MAX_FAILURES:
            return 0
        return max(1, int(LOGIN_WINDOW_SECONDS - (now - float(rows[0]["attempted_at"]))))

    def register_login_failure(self, client_key: str) -> None:
        now = time.time()
        with connect_database() as connection:
            connection.execute(
                "INSERT INTO login_failures (client_key, attempted_at) VALUES (?, ?)",
                (client_key, now),
            )
            connection.commit()

    def clear_login_failures(self, client_key: str) -> None:
        with connect_database() as connection:
            connection.execute(
                "DELETE FROM login_failures WHERE client_key = ?",
                (client_key,),
            )
            connection.commit()

    def session_token(self) -> str | None:
        raw_cookie = self.headers.get("Cookie")
        if not raw_cookie:
            return None
        cookie = SimpleCookie()
        try:
            cookie.load(raw_cookie)
        except Exception:
            return None
        morsel = cookie.get(SESSION_COOKIE)
        return morsel.value if morsel else None

    def is_authenticated(self) -> bool:
        return session_is_valid(self.session_token())

    def require_authentication(self) -> bool:
        if self.is_authenticated():
            return True
        self.send_json(
            HTTPStatus.UNAUTHORIZED,
            {"error": "Acesso administrativo necessário.", "loginUrl": "/login"},
        )
        return False

    def read_json_body(self) -> dict[str, object]:
        content_length = self.headers.get("Content-Length")
        if content_length is None:
            raise ValueError("Requisição sem conteúdo.")

        try:
            size = int(content_length)
        except ValueError as error:
            raise ValueError("Content-Length inválido.") from error

        if size <= 0:
            raise ValueError("Requisição sem conteúdo.")
        if size > MAX_BODY_BYTES:
            raise ValueError("O conteúdo ultrapassa o limite de 2 MB.")

        raw = self.rfile.read(size)
        try:
            parsed = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ValueError("JSON inválido.") from error

        if not isinstance(parsed, dict):
            raise ValueError("O corpo da requisição deve ser um objeto JSON.")
        return parsed

    def send_static_file(self, filename: str, *, head_only: bool = False) -> None:
        path = (PROJECT_DIR / filename).resolve()
        try:
            relative = path.relative_to(PROJECT_DIR)
        except ValueError:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        allowed = len(relative.parts) == 1 or relative.parts[0] == "assets"
        if not allowed or not path.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        content = path.read_bytes()
        content_type, _ = mimetypes.guess_type(path.name)
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", f"{content_type or 'application/octet-stream'}; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        if not head_only:
            self.wfile.write(content)

    def send_json(
        self,
        status: HTTPStatus,
        payload: dict[str, object],
        *,
        extra_headers: dict[str, str] | None = None,
    ) -> None:
        encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        if extra_headers:
            for key, value in extra_headers.items():
                self.send_header(key, value)
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, format_string: str, *args: object) -> None:
        print(f"[{self.log_date_time_string()}] {format_string % args}")


def main() -> None:
    os.chdir(PROJECT_DIR)
    initialize_database()

    try:
        server = ThreadingHTTPServer((HOST, PORT), TournamentHandler)
    except OSError as error:
        raise SystemExit(
            f"Não foi possível iniciar na porta {PORT}. "
            "Verifique se outro programa já está usando essa porta."
        ) from error

    local_url = f"http://127.0.0.1:{PORT}"
    print("\nCampeonato de Sinuca iniciado · liga, mata-mata e bolão virtual.")
    print(f"Neste computador: {local_url}")
    for address in discover_lan_addresses():
        print(f"Na rede interna: http://{address}:{PORT}")
    print(f"Login administrativo: {local_url}/login")
    print(f"Bolão virtual: {local_url}/bolao")
    print(f"Banco persistente: {DATABASE_PATH}")
    print("Pressione Ctrl+C para encerrar.\n")

    if os.environ.get("NO_BROWSER") != "1":
        try:
            webbrowser.open(local_url)
        except webbrowser.Error:
            pass

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor encerrado.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()

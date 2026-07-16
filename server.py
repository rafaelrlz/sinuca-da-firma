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
import base64
import binascii
import ipaddress
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
MAX_NEWS_IMAGE_BYTES = 900 * 1024
MAX_PROFILE_IMAGE_BYTES = 700 * 1024
NEWS_VISITOR_HEADER = "X-News-Visitor"
VISITOR_HEADER = "X-Visitor-ID"
STATE_VERSION = 5
REACTIONS = {"great_match", "surprise", "played_well", "rematch", "historic"}
PROGRAMMING_STATUSES = {"unscheduled", "scheduled", "postponed", "cancelled"}
AVAILABILITY_STATUSES = {"available", "maybe", "unavailable", "unknown"}
POLL_STATUSES = {"draft", "open", "closed"}
COMMUNITY_STATUSES = {"published", "hidden", "deleted"}
PROJECT_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("SINUCA_DATA_DIR") or PROJECT_DIR / "data").expanduser().resolve()
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
TRUST_PROXY_HEADERS = bool(os.environ.get("VERCEL")) or os.environ.get("SINUCA_TRUST_PROXY") == "1"


def configured_admin_accounts() -> list[tuple[str, str | None]]:
    """Carrega a conta principal e pares numerados definidos no ambiente."""
    accounts: list[tuple[str, str | None]] = []
    if ADMIN_PASSWORD_OVERRIDE:
        accounts.append((ADMIN_USERNAME, ADMIN_PASSWORD_OVERRIDE))
    elif not os.environ.get("VERCEL"):
        accounts.append((ADMIN_USERNAME, None))

    prefix = "SINUCA_ADMIN_USER_"
    suffixes = sorted(
        int(key[len(prefix):])
        for key in os.environ
        if key.startswith(prefix) and key[len(prefix):].isdigit()
    )
    for suffix in suffixes:
        username = os.environ.get(f"{prefix}{suffix}", "")
        password = os.environ.get(f"SINUCA_ADMIN_PASSWORD_{suffix}", "")
        if username and password:
            accounts.append((username, password))
    return accounts


ADMIN_ACCOUNTS = configured_admin_accounts()

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
    "/expansion-domain.js": "expansion-domain.js",
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
        "version": STATE_VERSION,
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
        "availability": {},
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
                created_at TEXT NOT NULL,
                username TEXT NOT NULL DEFAULT ''
            )
            """
        )
        if IS_POSTGRES:
            username_column = connection.execute(
                "SELECT 1 FROM information_schema.columns WHERE table_name = 'admin_sessions' AND column_name = 'username'"
            ).fetchone()
        else:
            username_column = next(
                (row for row in connection.execute("PRAGMA table_info(admin_sessions)").fetchall() if row["name"] == "username"),
                None,
            )
        if username_column is None:
            connection.execute("ALTER TABLE admin_sessions ADD COLUMN username TEXT NOT NULL DEFAULT ''")
        connection.execute(
            f"""
            CREATE TABLE IF NOT EXISTS login_failures (
                id {failure_id_definition},
                client_key TEXT NOT NULL,
                attempted_at DOUBLE PRECISION NOT NULL
            )
            """
        )
        image_type = "BYTEA" if IS_POSTGRES else "BLOB"
        connection.execute(
            f"""
            CREATE TABLE IF NOT EXISTS news_articles (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                summary TEXT NOT NULL,
                body TEXT NOT NULL,
                category TEXT NOT NULL,
                author TEXT NOT NULL,
                published_at TEXT NOT NULL,
                status TEXT NOT NULL,
                featured INTEGER NOT NULL DEFAULT 0,
                image_data {image_type},
                image_type TEXT,
                image_alt TEXT NOT NULL DEFAULT '',
                video_url TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS news_comments (
                id TEXT PRIMARY KEY,
                article_id TEXT NOT NULL,
                visitor_id TEXT NOT NULL,
                author TEXT NOT NULL,
                body TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS news_ratings (
                article_id TEXT NOT NULL,
                visitor_id TEXT NOT NULL,
                score INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (article_id, visitor_id)
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS news_comment_reports (
                comment_id TEXT NOT NULL,
                visitor_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                PRIMARY KEY (comment_id, visitor_id)
            )
            """
        )
        connection.execute(
            f"""
            CREATE TABLE IF NOT EXISTS player_profiles (
                player_id TEXT PRIMARY KEY,
                display_name TEXT NOT NULL DEFAULT '',
                bio TEXT NOT NULL DEFAULT '',
                nickname TEXT NOT NULL DEFAULT '',
                image_data {image_type},
                image_type TEXT,
                favorite_shot TEXT NOT NULL DEFAULT '',
                joined_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS season_archives (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                started_at TEXT,
                ended_at TEXT NOT NULL,
                champion_player_id TEXT,
                runner_up_player_id TEXT,
                champion_name TEXT,
                runner_up_name TEXT,
                snapshot_json TEXT NOT NULL,
                summary TEXT NOT NULL DEFAULT '',
                created_by TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS polls (
                id TEXT PRIMARY KEY,
                type TEXT NOT NULL,
                title TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                starts_at TEXT NOT NULL,
                ends_at TEXT,
                status TEXT NOT NULL,
                created_by TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS poll_options (
                id TEXT PRIMARY KEY,
                poll_id TEXT NOT NULL,
                player_id TEXT,
                match_id TEXT,
                label TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY (poll_id) REFERENCES polls(id) ON DELETE CASCADE
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS poll_votes (
                poll_id TEXT NOT NULL,
                option_id TEXT NOT NULL,
                visitor_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                PRIMARY KEY (poll_id, visitor_id),
                FOREIGN KEY (poll_id) REFERENCES polls(id) ON DELETE CASCADE,
                FOREIGN KEY (option_id) REFERENCES poll_options(id) ON DELETE CASCADE
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS content_reactions (
                content_type TEXT NOT NULL,
                content_id TEXT NOT NULL,
                visitor_id TEXT NOT NULL,
                reaction TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (content_type, content_id, visitor_id)
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS community_posts (
                id TEXT PRIMARY KEY,
                visitor_id TEXT NOT NULL,
                content_type TEXT NOT NULL DEFAULT 'community',
                content_id TEXT NOT NULL DEFAULT '',
                author TEXT NOT NULL,
                body TEXT NOT NULL,
                status TEXT NOT NULL,
                report_count INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                moderated_by TEXT,
                moderated_at TEXT
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS community_post_reports (
                post_id TEXT NOT NULL,
                visitor_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                PRIMARY KEY (post_id, visitor_id),
                FOREIGN KEY (post_id) REFERENCES community_posts(id) ON DELETE CASCADE
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS player_awards (
                id TEXT PRIMARY KEY,
                player_id TEXT NOT NULL,
                type TEXT NOT NULL,
                title TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                season_id TEXT,
                poll_id TEXT,
                awarded_at TEXT NOT NULL,
                created_by TEXT NOT NULL,
                UNIQUE (player_id, type, poll_id)
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS news_player_links (
                article_id TEXT NOT NULL,
                player_id TEXT NOT NULL,
                PRIMARY KEY (article_id, player_id),
                FOREIGN KEY (article_id) REFERENCES news_articles(id) ON DELETE CASCADE
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS admin_audit_log (
                id TEXT PRIMARY KEY,
                action TEXT NOT NULL,
                entity_type TEXT NOT NULL,
                entity_id TEXT,
                detail_json TEXT NOT NULL DEFAULT '{}',
                admin_username TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        connection.execute(
            f"""
            CREATE TABLE IF NOT EXISTS social_rate_events (
                id {failure_id_definition},
                visitor_id TEXT NOT NULL,
                action TEXT NOT NULL,
                occurred_at DOUBLE PRECISION NOT NULL
            )
            """
        )
        for column_name, definition in (
            ("match_id", "TEXT"),
            ("season_id", "TEXT"),
        ):
            if IS_POSTGRES:
                column = connection.execute(
                    """
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'news_articles' AND column_name = ?
                    """,
                    (column_name,),
                ).fetchone()
            else:
                column = next(
                    (
                        row for row in connection.execute("PRAGMA table_info(news_articles)").fetchall()
                        if row["name"] == column_name
                    ),
                    None,
                )
            if column is None:
                connection.execute(f"ALTER TABLE news_articles ADD COLUMN {column_name} {definition}")
        for column_name, definition in (
            ("content_type", "TEXT NOT NULL DEFAULT 'community'"),
            ("content_id", "TEXT NOT NULL DEFAULT ''"),
        ):
            if IS_POSTGRES:
                column = connection.execute(
                    """
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'community_posts' AND column_name = ?
                    """,
                    (column_name,),
                ).fetchone()
            else:
                column = next(
                    (
                        row for row in connection.execute("PRAGMA table_info(community_posts)").fetchall()
                        if row["name"] == column_name
                    ),
                    None,
                )
            if column is None:
                connection.execute(f"ALTER TABLE community_posts ADD COLUMN {column_name} {definition}")
        for column_name in ("champion_name", "runner_up_name"):
            if IS_POSTGRES:
                column = connection.execute(
                    """
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'season_archives' AND column_name = ?
                    """,
                    (column_name,),
                ).fetchone()
            else:
                column = next(
                    (
                        row for row in connection.execute("PRAGMA table_info(season_archives)").fetchall()
                        if row["name"] == column_name
                    ),
                    None,
                )
            if column is None:
                connection.execute(f"ALTER TABLE season_archives ADD COLUMN {column_name} TEXT")
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_bets_bettor ON bets(bettor_id)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_login_failures_client ON login_failures(client_key, attempted_at)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_news_comments_article ON news_comments(article_id, created_at)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_news_comments_visitor ON news_comments(visitor_id, created_at)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_news_ratings_article ON news_ratings(article_id)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_news_reports_comment ON news_comment_reports(comment_id)"
        )
        connection.execute("CREATE INDEX IF NOT EXISTS idx_poll_options_poll ON poll_options(poll_id, sort_order)")
        connection.execute("CREATE INDEX IF NOT EXISTS idx_poll_votes_option ON poll_votes(option_id)")
        connection.execute("CREATE INDEX IF NOT EXISTS idx_reactions_content ON content_reactions(content_type, content_id)")
        connection.execute("CREATE INDEX IF NOT EXISTS idx_community_status ON community_posts(status, created_at)")
        connection.execute("CREATE INDEX IF NOT EXISTS idx_community_content ON community_posts(content_type, content_id, status, created_at)")
        connection.execute("CREATE INDEX IF NOT EXISTS idx_community_visitor ON community_posts(visitor_id, created_at)")
        connection.execute("CREATE INDEX IF NOT EXISTS idx_awards_player ON player_awards(player_id, awarded_at)")
        connection.execute("CREATE INDEX IF NOT EXISTS idx_audit_created ON admin_audit_log(created_at)")
        connection.execute("CREATE INDEX IF NOT EXISTS idx_social_rate ON social_rate_events(visitor_id, action, occurred_at)")
        migrate_bettor_initial_balance(connection)
        connection.execute(
            """
            INSERT INTO schema_migrations (migration_id, applied_at)
            VALUES (?, ?)
            ON CONFLICT (migration_id) DO NOTHING
            """,
            ("site_expansion_v1", utc_now()),
        )
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


def public_state_payload() -> dict[str, object]:
    payload = read_state()
    state = payload.get("state")
    if not isinstance(state, dict):
        return payload
    public_state = json.loads(json.dumps(state))
    league = public_state.get("league")
    if isinstance(league, dict):
        programming = league.get("programming")
        if isinstance(programming, dict) and isinstance(programming.get("matches"), dict):
            for entry in programming["matches"].values():
                if isinstance(entry, dict):
                    entry["note"] = ""
    availability = public_state.get("availability")
    if isinstance(availability, dict):
        for entries in availability.values():
            if not isinstance(entries, list):
                continue
            for entry in entries:
                if isinstance(entry, dict):
                    entry["note"] = ""
    return {**payload, "state": public_state}


def parse_iso_datetime(value: object, *, field: str = "A data") -> str | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError(f"{field} é inválida.") from error
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat(timespec="seconds")


def league_matches(state: dict[str, object]) -> dict[str, dict[str, object]]:
    """Indexa uma única vez os confrontos da liga, incluindo a rodada."""
    league = state.get("league")
    if not isinstance(league, dict):
        return {}
    rounds = league.get("rounds") if isinstance(league.get("rounds"), list) else []
    indexed: dict[str, dict[str, object]] = {}
    for round_item in rounds:
        if not isinstance(round_item, dict):
            continue
        try:
            round_number = int(round_item.get("number") or 0)
        except (TypeError, ValueError):
            round_number = 0
        for match in round_item.get("matches") or []:
            if not isinstance(match, dict) or not match.get("id"):
                continue
            match_id = str(match["id"])
            indexed[match_id] = {
                **match,
                "id": match_id,
                "roundNumber": round_number,
            }
    return indexed


def clean_short_text(value: object, maximum: int) -> str:
    return " ".join(str(value or "").strip().split())[:maximum]


def canonical_availability_status(value: object) -> str:
    status = str(value or "unknown").strip().lower().replace("-", "_")
    return {
        "not_informed": "unknown",
        "uninformed": "unknown",
        "nao_informado": "unknown",
    }.get(status, status)


def completed_league_match_ids(state: dict[str, object]) -> set[str]:
    league = state.get("league")
    if not isinstance(league, dict):
        return set()
    results = league.get("results") if isinstance(league.get("results"), dict) else {}
    completed: set[str] = set()
    for match_id, match in league_matches(state).items():
        result = results.get(match_id)
        if not isinstance(result, dict):
            continue
        player_a = match.get("playerAId")
        player_b = match.get("playerBId")
        if (
            result.get("playerAId") == player_a
            and result.get("playerBId") == player_b
            and result.get("winnerId") in {player_a, player_b}
        ):
            completed.add(match_id)
    return completed


def normalize_programming(state: dict[str, object]) -> None:
    league = state.get("league")
    if not isinstance(league, dict):
        return
    matches = league_matches(state)
    completed_ids = completed_league_match_ids(state)
    pending_ids = {
        match_id
        for match_id, match in matches.items()
        if match_id not in completed_ids
        and isinstance(match.get("playerAId"), str)
        and isinstance(match.get("playerBId"), str)
        and match.get("playerAId") != match.get("playerBId")
    }
    raw = league.get("programming") if isinstance(league.get("programming"), dict) else {}
    raw_matches = raw.get("matches") if isinstance(raw.get("matches"), dict) else {}
    normalized_matches: dict[str, dict[str, object]] = {}
    for raw_id, raw_entry in raw_matches.items():
        match_id = str(raw_id)
        if match_id not in pending_ids or not isinstance(raw_entry, dict):
            continue
        status = str(raw_entry.get("status") or "unscheduled")
        if status not in PROGRAMMING_STATUSES:
            status = "unscheduled"
        scheduled_at = None
        try:
            scheduled_at = parse_iso_datetime(raw_entry.get("scheduledAt"))
        except ValueError:
            scheduled_at = None
        try:
            priority = max(0, min(99, int(raw_entry.get("priority") or 0)))
        except (TypeError, ValueError):
            priority = 0
        normalized_matches[match_id] = {
            "scheduledAt": scheduled_at,
            "location": clean_short_text(raw_entry.get("location"), 160),
            "status": status,
            "priority": priority,
            "note": str(raw_entry.get("note") or "").strip()[:1000],
            "publicNote": str(raw_entry.get("publicNote") or "").strip()[:500],
            "updatedAt": str(raw_entry.get("updatedAt") or ""),
            "updatedBy": clean_short_text(raw_entry.get("updatedBy"), 80),
        }
    selectable_ids = {
        match_id for match_id in pending_ids
        if normalized_matches.get(match_id, {}).get("status") != "cancelled"
    }
    next_match_id = str(raw.get("nextMatchId") or "")
    if next_match_id not in selectable_ids:
        next_match_id = ""
    featured: list[str] = []
    raw_featured = raw.get("featuredMatchIds")
    if isinstance(raw_featured, list):
        for item in raw_featured:
            match_id = str(item or "")
            if match_id in selectable_ids and match_id not in featured:
                featured.append(match_id)
            if len(featured) == 3:
                break
    league["programming"] = {
        "nextMatchId": next_match_id or None,
        "featuredMatchIds": featured,
        "matches": normalized_matches,
    }


def normalize_availability(state: dict[str, object]) -> None:
    players = state.get("players") if isinstance(state.get("players"), list) else []
    player_ids = {
        str(player.get("id"))
        for player in players
        if isinstance(player, dict) and player.get("id")
    }
    raw = state.get("availability") if isinstance(state.get("availability"), dict) else {}
    normalized: dict[str, list[dict[str, object]]] = {}
    for raw_player_id, raw_entries in raw.items():
        player_id = str(raw_player_id)
        if player_id not in player_ids or not isinstance(raw_entries, list):
            continue
        entries: list[dict[str, object]] = []
        seen_ids: set[str] = set()
        for raw_entry in raw_entries[:200]:
            if not isinstance(raw_entry, dict):
                continue
            entry_id = clean_short_text(raw_entry.get("id"), 100) or f"availability-{uuid.uuid4()}"
            if entry_id in seen_ids:
                continue
            status = canonical_availability_status(raw_entry.get("status"))
            if status not in AVAILABILITY_STATUSES:
                status = "unknown"
            try:
                starts_at = parse_iso_datetime(raw_entry.get("startsAt"))
                ends_at = parse_iso_datetime(raw_entry.get("endsAt"))
            except ValueError:
                starts_at = ends_at = None
            if starts_at and ends_at and (
                datetime.fromisoformat(ends_at) < datetime.fromisoformat(starts_at)
            ):
                starts_at, ends_at = ends_at, starts_at
            entries.append({
                "id": entry_id,
                "status": status,
                "startsAt": starts_at,
                "endsAt": ends_at,
                "note": str(raw_entry.get("note") or "").strip()[:500],
                "updatedAt": str(raw_entry.get("updatedAt") or ""),
                "updatedBy": clean_short_text(raw_entry.get("updatedBy"), 80),
            })
            seen_ids.add(entry_id)
        if entries:
            normalized[player_id] = entries
    state["availability"] = normalized


def availability_conflicts(state: dict[str, object]) -> list[dict[str, object]]:
    league = state.get("league") if isinstance(state.get("league"), dict) else {}
    programming = league.get("programming") if isinstance(league.get("programming"), dict) else {}
    programmed = programming.get("matches") if isinstance(programming.get("matches"), dict) else {}
    availability = state.get("availability") if isinstance(state.get("availability"), dict) else {}
    warnings: list[dict[str, object]] = []
    for match_id, entry in programmed.items():
        if not isinstance(entry, dict) or not entry.get("scheduledAt") or entry.get("status") == "cancelled":
            continue
        try:
            scheduled = datetime.fromisoformat(str(entry["scheduledAt"]).replace("Z", "+00:00"))
        except ValueError:
            continue
        match = league_matches(state).get(str(match_id))
        if not match:
            continue
        for player_id in (match.get("playerAId"), match.get("playerBId")):
            if not isinstance(player_id, str):
                continue
            for availability_entry in availability.get(player_id, []):
                if not isinstance(availability_entry, dict):
                    continue
                status = str(availability_entry.get("status") or "unknown")
                if status not in {"unavailable", "maybe"}:
                    continue
                try:
                    starts = datetime.fromisoformat(str(availability_entry["startsAt"]).replace("Z", "+00:00")) if availability_entry.get("startsAt") else None
                    ends = datetime.fromisoformat(str(availability_entry["endsAt"]).replace("Z", "+00:00")) if availability_entry.get("endsAt") else None
                except ValueError:
                    continue
                if (starts is None or scheduled >= starts) and (ends is None or scheduled <= ends):
                    warnings.append({
                        "matchId": str(match_id),
                        "playerId": player_id,
                        "availabilityId": availability_entry.get("id"),
                        "status": status,
                        "note": availability_entry.get("note") or "",
                    })
    return warnings


def validate_state_contract_input(state: dict[str, object]) -> None:
    league = state.get("league")
    if isinstance(league, dict):
        programming = league.get("programming")
        if isinstance(programming, dict):
            entries = programming.get("matches")
            if isinstance(entries, dict):
                for entry in entries.values():
                    if not isinstance(entry, dict):
                        continue
                    status = str(entry.get("status") or "unscheduled")
                    if status not in PROGRAMMING_STATUSES:
                        raise ValueError("Status de agendamento inválido.")
                    parse_iso_datetime(entry.get("scheduledAt"), field="A data do jogo")
                    if len(str(entry.get("location") or "")) > 160:
                        raise ValueError("O local deve ter no máximo 160 caracteres.")
                    if len(str(entry.get("note") or "")) > 1000:
                        raise ValueError("A nota interna deve ter no máximo 1.000 caracteres.")
                    if len(str(entry.get("publicNote") or "")) > 500:
                        raise ValueError("A nota pública deve ter no máximo 500 caracteres.")
    availability = state.get("availability")
    if isinstance(availability, dict):
        for entries in availability.values():
            if not isinstance(entries, list):
                continue
            for entry in entries:
                if not isinstance(entry, dict):
                    continue
                if canonical_availability_status(entry.get("status")) not in AVAILABILITY_STATUSES:
                    raise ValueError("Status de disponibilidade inválido.")
                starts = parse_iso_datetime(entry.get("startsAt"), field="O início da disponibilidade")
                ends = parse_iso_datetime(entry.get("endsAt"), field="O fim da disponibilidade")
                if starts and ends and datetime.fromisoformat(ends) < datetime.fromisoformat(starts):
                    raise ValueError("O fim da disponibilidade deve ser posterior ao início.")
                if len(str(entry.get("note") or "")) > 500:
                    raise ValueError("A observação de disponibilidade deve ter no máximo 500 caracteres.")


def normalize_state_contract(state: dict[str, object]) -> None:
    """Aplica regras atuais sem descartar dados legados do campeonato."""
    try:
        current_version = int(state.get("version") or 0)
    except (TypeError, ValueError):
        current_version = 0
    state["version"] = max(STATE_VERSION, current_version)
    normalize_availability(state)
    league = state.get("league")
    if not isinstance(league, dict):
        return

    valid_match_ids = set(league_matches(state))
    results = league.get("results") if isinstance(league.get("results"), dict) else {}
    completed_ids = completed_league_match_ids(state)
    live_matches = league.get("inProgress") if isinstance(league.get("inProgress"), dict) else {}
    league["inProgress"] = {
        str(match_id): True
        for match_id, active in live_matches.items()
        if active and str(match_id) in valid_match_ids and str(match_id) not in completed_ids
    }
    normalize_programming(state)

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
        "databaseContent": {
            "included": False,
            "tables": [
                "player_profiles",
                "season_archives",
                "polls",
                "poll_options",
                "poll_votes",
                "content_reactions",
                "community_posts",
                "player_awards",
                "news_articles",
            ],
            "note": (
                "Perfis, temporadas, notícias e participação ficam no banco. "
                "Faça também uma cópia de campeonato.db ou backup do PostgreSQL."
            ),
        },
    }
    temporary_path = BACKUP_PATH.with_suffix(".json.tmp")
    temporary_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    temporary_path.replace(BACKUP_PATH)


def audit_record(
    connection: object,
    action: str,
    entity_type: str,
    entity_id: str | None,
    detail: dict[str, object],
    username: str,
) -> None:
    connection.execute(
        """
        INSERT INTO admin_audit_log
            (id, action, entity_type, entity_id, detail_json, admin_username, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            f"audit-{uuid.uuid4()}",
            action,
            entity_type,
            entity_id,
            json.dumps(detail, ensure_ascii=False, separators=(",", ":")),
            username,
            utc_now(),
        ),
    )


def stamp_state_changes(
    previous: dict[str, object],
    incoming: dict[str, object],
    username: str,
    updated_at: str,
) -> list[dict[str, object]]:
    """Carimba agenda/disponibilidade alteradas e devolve eventos auditáveis."""
    events: list[dict[str, object]] = []
    previous_league = previous.get("league") if isinstance(previous.get("league"), dict) else {}
    incoming_league = incoming.get("league") if isinstance(incoming.get("league"), dict) else {}
    previous_programming = (
        previous_league.get("programming")
        if isinstance(previous_league.get("programming"), dict)
        else {}
    )
    incoming_programming = (
        incoming_league.get("programming")
        if isinstance(incoming_league.get("programming"), dict)
        else {}
    )
    previous_entries = previous_programming.get("matches") if isinstance(previous_programming.get("matches"), dict) else {}
    incoming_entries = incoming_programming.get("matches") if isinstance(incoming_programming.get("matches"), dict) else {}
    for match_id, entry in incoming_entries.items():
        if not isinstance(entry, dict):
            continue
        comparable = {key: value for key, value in entry.items() if key not in {"updatedAt", "updatedBy"}}
        previous_entry = previous_entries.get(match_id) if isinstance(previous_entries.get(match_id), dict) else {}
        previous_comparable = {
            key: value for key, value in previous_entry.items() if key not in {"updatedAt", "updatedBy"}
        }
        if comparable != previous_comparable:
            entry["updatedAt"] = updated_at
            entry["updatedBy"] = username
            events.append({"action": "schedule.updated", "entityId": str(match_id)})
    for match_id in set(previous_entries) - set(incoming_entries):
        events.append({"action": "schedule.removed", "entityId": str(match_id)})
    if incoming_programming.get("nextMatchId") != previous_programming.get("nextMatchId"):
        events.append({
            "action": "schedule.next_match",
            "entityId": str(incoming_programming.get("nextMatchId") or ""),
        })
    if incoming_programming.get("featuredMatchIds") != previous_programming.get("featuredMatchIds"):
        events.append({"action": "schedule.featured", "entityId": None})

    previous_availability = previous.get("availability") if isinstance(previous.get("availability"), dict) else {}
    incoming_availability = incoming.get("availability") if isinstance(incoming.get("availability"), dict) else {}
    for player_id, entries in incoming_availability.items():
        if not isinstance(entries, list):
            continue
        old_by_id = {
            str(entry.get("id")): entry
            for entry in previous_availability.get(player_id, [])
            if isinstance(entry, dict) and entry.get("id")
        }
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            old = old_by_id.get(str(entry.get("id")), {})
            comparable = {key: value for key, value in entry.items() if key not in {"updatedAt", "updatedBy"}}
            old_comparable = {key: value for key, value in old.items() if key not in {"updatedAt", "updatedBy"}}
            if comparable != old_comparable:
                entry["updatedAt"] = updated_at
                entry["updatedBy"] = username
                events.append({"action": "availability.updated", "entityId": str(player_id)})
        new_ids = {
            str(entry.get("id")) for entry in entries
            if isinstance(entry, dict) and entry.get("id")
        }
        for removed_id in set(old_by_id) - new_ids:
            events.append({
                "action": "availability.entry_removed",
                "entityId": str(player_id),
                "availabilityId": removed_id,
            })
    for player_id in set(previous_availability) - set(incoming_availability):
        old_entries = previous_availability.get(player_id)
        if isinstance(old_entries, list):
            for old_entry in old_entries:
                if isinstance(old_entry, dict):
                    events.append({
                        "action": "availability.entry_removed",
                        "entityId": str(player_id),
                        "availabilityId": str(old_entry.get("id") or ""),
                    })
    if events:
        activity = incoming.get("activity") if isinstance(incoming.get("activity"), list) else []
        activity.insert(0, {
            "id": f"activity-{uuid.uuid4()}",
            "type": "schedule",
            "text": "Agenda e disponibilidade atualizadas",
            "detail": f"{len(events)} alteração(ões) registrada(s) por {username}",
            "at": updated_at,
            "updatedBy": username,
        })
        incoming["activity"] = activity[:80]

    old_next = str(previous_programming.get("nextMatchId") or "")
    if old_next and old_next in completed_league_match_ids(incoming) and not incoming_programming.get("nextMatchId"):
        tasks = incoming.get("adminTasks") if isinstance(incoming.get("adminTasks"), list) else []
        tasks = [
            task for task in tasks
            if not (
                isinstance(task, dict)
                and task.get("type") in {"choose-next-match", "choose_next_match"}
                and task.get("status") != "done"
            )
        ]
        tasks.insert(0, {
            "id": f"task-{uuid.uuid4()}",
            "type": "choose-next-match",
            "status": "pending",
            "text": "Escolher o próximo jogo",
            "detail": "O próximo jogo foi concluído e não houve seleção automática.",
            "createdAt": updated_at,
            "createdBy": username,
            "completedMatchId": old_next,
        })
        incoming["adminTasks"] = tasks[:40]
    return events


def save_state(
    state: dict[str, object],
    *,
    expected_revision: int | None = None,
    username: str = "admin",
) -> dict[str, object]:
    validate_state_contract_input(state)
    normalize_state_contract(state)
    updated_at = utc_now()

    with DB_LOCK, connect_database() as connection:
        if not IS_POSTGRES:
            connection.execute("BEGIN IMMEDIATE")
        revision_query = "SELECT data, revision, updated_at FROM app_state WHERE id = 1"
        if IS_POSTGRES:
            revision_query += " FOR UPDATE"
        current = connection.execute(revision_query).fetchone()
        current_revision = int(current["revision"]) if current else 0
        if expected_revision is not None and expected_revision != current_revision:
            connection.rollback()
            current_state: dict[str, object] | None = None
            if current:
                try:
                    current_state = json.loads(current["data"])
                except json.JSONDecodeError:
                    current_state = None
                if isinstance(current_state, dict):
                    normalize_state_contract(current_state)
            return {
                "ok": False,
                "conflict": True,
                "state": current_state,
                "revision": current_revision,
                "updatedAt": current["updated_at"] if current else None,
            }
        previous: dict[str, object] = {}
        if current:
            try:
                previous = json.loads(current["data"])
            except json.JSONDecodeError:
                previous = {}
        normalize_state_contract(previous)
        events = stamp_state_changes(previous, state, username, updated_at)
        normalize_state_contract(state)
        serialized = json.dumps(state, ensure_ascii=False, separators=(",", ":"))
        revision = current_revision + 1 if current else 1
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
        audit_record(
            connection,
            "state.saved",
            "state",
            "1",
            {"revision": revision, "expansionEventCount": len(events)},
            username,
        )
        for event in events:
            audit_record(
                connection,
                str(event["action"]),
                "state",
                str(event.get("entityId") or "") or None,
                {
                    "revision": revision,
                    **{
                        key: value for key, value in event.items()
                        if key not in {"action", "entityId"}
                    },
                },
                username,
            )
        connection.commit()
        if not IS_POSTGRES:
            write_backup(state, revision, updated_at)

    return {
        "ok": True,
        "revision": revision,
        "updatedAt": updated_at,
        "warnings": availability_conflicts(state),
    }


def news_record(row: object) -> dict[str, object]:
    article_id = str(row["id"])
    try:
        comment_count = int(row["comment_count"] or 0)
        rating_count = int(row["rating_count"] or 0)
        rating_average = float(row["rating_average"] or 0)
    except (IndexError, KeyError):
        comment_count = rating_count = 0
        rating_average = 0.0
    try:
        match_id = row["match_id"] or ""
        season_id = row["season_id"] or ""
    except (IndexError, KeyError):
        match_id = season_id = ""
    with connect_database() as connection:
        links = connection.execute(
            "SELECT player_id FROM news_player_links WHERE article_id = ? ORDER BY player_id",
            (article_id,),
        ).fetchall()
    return {
        "id": article_id,
        "title": row["title"],
        "summary": row["summary"],
        "body": row["body"],
        "category": row["category"],
        "author": row["author"],
        "publishedAt": row["published_at"],
        "status": row["status"],
        "featured": bool(row["featured"]),
        "imageUrl": f"/api/news/image?id={article_id}" if row["image_type"] else "",
        "imageAlt": row["image_alt"],
        "videoUrl": row["video_url"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "commentCount": comment_count,
        "ratingCount": rating_count,
        "ratingAverage": round(rating_average, 1),
        "matchId": match_id,
        "seasonId": season_id,
        "playerIds": [link["player_id"] for link in links],
    }


def list_news(include_drafts: bool = False) -> list[dict[str, object]]:
    query = """
        SELECT n.id, n.title, n.summary, n.body, n.category, n.author, n.published_at,
               n.status, n.featured, n.image_type, n.image_alt, n.video_url,
               n.match_id, n.season_id,
               n.created_at, n.updated_at,
               (SELECT COUNT(*) FROM news_comments c WHERE c.article_id = n.id) AS comment_count,
               (SELECT COUNT(*) FROM news_ratings r WHERE r.article_id = n.id) AS rating_count,
               (SELECT AVG(r.score) FROM news_ratings r WHERE r.article_id = n.id) AS rating_average
        FROM news_articles n
    """
    parameters: tuple[object, ...] = ()
    if not include_drafts:
        query += " WHERE status = ? AND published_at <= ?"
        parameters = ("published", utc_now())
    query += " ORDER BY featured DESC, published_at DESC, created_at DESC"
    with connect_database() as connection:
        rows = connection.execute(query, parameters).fetchall()
    return [news_record(row) for row in rows]


def decode_news_image(value: object) -> tuple[bytes | None, str | None]:
    if value in (None, ""):
        return None, None
    raw_value = str(value)
    if not raw_value.startswith("data:image/") or ";base64," not in raw_value:
        raise ValueError("A imagem enviada é inválida.")
    header, encoded = raw_value.split(",", 1)
    content_type = header[5:].split(";", 1)[0].lower()
    if content_type not in {"image/jpeg", "image/png", "image/webp"}:
        raise ValueError("Use uma imagem JPG, PNG ou WebP.")
    try:
        image = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as error:
        raise ValueError("A imagem enviada está corrompida.") from error
    if len(image) > MAX_NEWS_IMAGE_BYTES:
        raise ValueError("A imagem ultrapassa o limite de 900 KB.")
    validate_image_signature(image, content_type)
    return image, content_type


def validate_image_signature(content: bytes, content_type: str) -> None:
    signatures = {
        "image/png": content.startswith(b"\x89PNG\r\n\x1a\n"),
        "image/jpeg": content.startswith(b"\xff\xd8\xff"),
        "image/webp": (
            len(content) >= 12
            and content.startswith(b"RIFF")
            and content[8:12] == b"WEBP"
        ),
    }
    if not signatures.get(content_type, False):
        raise ValueError("O conteúdo da imagem não corresponde ao formato informado.")


def clean_news_text(value: object, field: str, minimum: int, maximum: int) -> str:
    text = str(value or "").strip()
    if not (minimum <= len(text) <= maximum):
        raise ValueError(f"{field} deve ter entre {minimum} e {maximum} caracteres.")
    return text


def save_news_article(
    payload: dict[str, object],
    username: str = "admin",
) -> dict[str, object]:
    article_id = str(payload.get("id") or f"news-{uuid.uuid4()}")
    title = clean_news_text(payload.get("title"), "O título", 4, 140)
    summary = clean_news_text(payload.get("summary"), "O resumo", 10, 320)
    body = clean_news_text(payload.get("body"), "O texto", 20, 20_000)
    category = clean_news_text(payload.get("category") or "Campeonato", "A categoria", 2, 40)
    author = clean_news_text(payload.get("author") or "Organização", "O autor", 2, 80)
    status = str(payload.get("status") or "draft")
    if status not in {"draft", "published"}:
        raise ValueError("Status de publicação inválido.")
    published_at = str(payload.get("publishedAt") or utc_now())
    try:
        published_date = datetime.fromisoformat(published_at.replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError("A data de publicação é inválida.") from error
    if published_date.tzinfo is None:
        published_date = published_date.replace(tzinfo=timezone.utc)
    published_at = published_date.astimezone(timezone.utc).isoformat(timespec="seconds")
    video_url = str(payload.get("videoUrl") or "").strip()
    if video_url and not video_url.startswith(("https://www.youtube.com/", "https://youtu.be/", "https://vimeo.com/")):
        raise ValueError("Use um link válido do YouTube ou Vimeo.")
    image_alt = str(payload.get("imageAlt") or "").strip()[:180]
    match_id = clean_short_text(payload.get("matchId"), 120)
    season_id = clean_short_text(payload.get("seasonId"), 120)
    player_ids = None
    if "playerIds" in payload:
        if not isinstance(payload.get("playerIds"), list):
            raise ValueError("A lista de jogadores relacionados é inválida.")
        player_ids = list(dict.fromkeys(
            clean_short_text(player_id, 120)
            for player_id in (payload.get("playerIds") or [])
            if clean_short_text(player_id, 120)
        ))[:20]
    state = read_state()["state"] or {}
    players = official_players(state)
    matches = league_matches(state)
    if match_id and match_id not in matches:
        raise ValueError("A notícia referencia uma partida inexistente.")
    if player_ids is not None and any(player_id not in players for player_id in player_ids):
        raise ValueError("A notícia referencia um jogador inexistente.")
    if season_id:
        with connect_database() as validation_connection:
            if not validation_connection.execute(
                "SELECT 1 FROM season_archives WHERE id = ?", (season_id,)
            ).fetchone():
                raise ValueError("A notícia referencia uma temporada inexistente.")
    image_data, image_type = decode_news_image(payload.get("imageData"))
    now = utc_now()

    with connect_database() as connection:
        if payload.get("featured"):
            connection.execute("UPDATE news_articles SET featured = 0")
        current = connection.execute(
            """
            SELECT image_data, image_type, created_at, match_id, season_id
            FROM news_articles WHERE id = ?
            """,
            (article_id,),
        ).fetchone()
        if current is not None and image_data is None:
            image_data, image_type = current["image_data"], current["image_type"]
        if current is not None and "matchId" not in payload:
            match_id = str(current["match_id"] or "")
        if current is not None and "seasonId" not in payload:
            season_id = str(current["season_id"] or "")
        created_at = current["created_at"] if current is not None else now
        connection.execute(
            """
            INSERT INTO news_articles (
                id, title, summary, body, category, author, published_at, status,
                featured, image_data, image_type, image_alt, video_url, created_at,
                updated_at, match_id, season_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                title = excluded.title, summary = excluded.summary, body = excluded.body,
                category = excluded.category, author = excluded.author,
                published_at = excluded.published_at, status = excluded.status,
                featured = excluded.featured, image_data = excluded.image_data,
                image_type = excluded.image_type, image_alt = excluded.image_alt,
                video_url = excluded.video_url, updated_at = excluded.updated_at,
                match_id = excluded.match_id, season_id = excluded.season_id
            """,
            (
                article_id, title, summary, body, category, author, published_at, status,
                1 if payload.get("featured") else 0, image_data, image_type, image_alt,
                video_url, created_at, now, match_id or None, season_id or None,
            ),
        )
        if player_ids is not None:
            connection.execute("DELETE FROM news_player_links WHERE article_id = ?", (article_id,))
            for player_id in player_ids:
                connection.execute(
                    "INSERT INTO news_player_links (article_id, player_id) VALUES (?, ?)",
                    (article_id, player_id),
                )
        audit_record(
            connection,
            "news.saved",
            "news_article",
            article_id,
            {"matchId": match_id or None, "seasonId": season_id or None},
            username,
        )
        connection.commit()
        row = connection.execute(
            """
            SELECT id, title, summary, body, category, author, published_at,
                   status, featured, image_type, image_alt, video_url, created_at, updated_at,
                   match_id, season_id
            FROM news_articles WHERE id = ?
            """,
            (article_id,),
        ).fetchone()
    return news_record(row)


def delete_news_article(article_id: str, username: str = "admin") -> bool:
    with connect_database() as connection:
        connection.execute(
            "DELETE FROM news_comment_reports WHERE comment_id IN (SELECT id FROM news_comments WHERE article_id = ?)",
            (article_id,),
        )
        connection.execute("DELETE FROM news_comments WHERE article_id = ?", (article_id,))
        connection.execute("DELETE FROM news_ratings WHERE article_id = ?", (article_id,))
        connection.execute("DELETE FROM news_player_links WHERE article_id = ?", (article_id,))
        connection.execute(
            "DELETE FROM content_reactions WHERE content_type = 'news' AND content_id = ?",
            (article_id,),
        )
        connection.execute(
            """
            DELETE FROM community_post_reports
            WHERE post_id IN (
                SELECT id FROM community_posts
                WHERE content_type = 'news' AND content_id = ?
            )
            """,
            (article_id,),
        )
        connection.execute(
            "DELETE FROM community_posts WHERE content_type = 'news' AND content_id = ?",
            (article_id,),
        )
        cursor = connection.execute("DELETE FROM news_articles WHERE id = ?", (article_id,))
        if cursor.rowcount:
            audit_record(connection, "news.deleted", "news_article", article_id, {}, username)
        connection.commit()
    return cursor.rowcount == 1


def validate_news_visitor(value: object) -> str:
    visitor = str(value or "").strip()
    if not (16 <= len(visitor) <= 100) or any(
        not (character.isalnum() or character in "-_.") for character in visitor
    ):
        raise ValueError("Identificação do visitante inválida. Atualize a página e tente novamente.")
    return visitor


def news_article_exists(article_id: str, include_hidden: bool = False) -> bool:
    query = "SELECT status, published_at FROM news_articles WHERE id = ?"
    with connect_database() as connection:
        row = connection.execute(query, (article_id,)).fetchone()
    if row is None:
        return False
    return include_hidden or (row["status"] == "published" and str(row["published_at"]) <= utc_now())


def news_engagement(article_id: str, visitor_value: object, include_hidden: bool = False) -> dict[str, object]:
    visitor_id = validate_news_visitor(visitor_value)
    if not news_article_exists(article_id, include_hidden):
        raise LookupError("Notícia não encontrada.")
    with connect_database() as connection:
        comments = connection.execute(
            """
            SELECT c.id, c.author, c.body, c.created_at,
                   (SELECT COUNT(*) FROM news_comment_reports r WHERE r.comment_id = c.id) AS report_count
            FROM news_comments c WHERE c.article_id = ?
            ORDER BY created_at DESC
            """,
            (article_id,),
        ).fetchall()
        summary = connection.execute(
            "SELECT COUNT(*) AS rating_count, AVG(score) AS rating_average FROM news_ratings WHERE article_id = ?",
            (article_id,),
        ).fetchone()
        own_rating = connection.execute(
            "SELECT score FROM news_ratings WHERE article_id = ? AND visitor_id = ?",
            (article_id, visitor_id),
        ).fetchone()
    return {
        "comments": [
            {
                "id": row["id"],
                "author": row["author"],
                "body": row["body"],
                "createdAt": row["created_at"],
                **({"reportCount": int(row["report_count"] or 0)} if include_hidden else {}),
            }
            for row in comments
        ],
        "rating": {
            "count": int(summary["rating_count"] or 0),
            "average": round(float(summary["rating_average"] or 0), 1),
            "userScore": int(own_rating["score"]) if own_rating else 0,
        },
    }


def save_news_comment(article_id: object, visitor_value: object, payload: dict[str, object]) -> dict[str, object]:
    article_key = str(article_id or "").strip()
    visitor_id = validate_news_visitor(visitor_value)
    if not news_article_exists(article_key):
        raise LookupError("Notícia não encontrada.")
    if str(payload.get("website") or "").strip():
        raise ValueError("Não foi possível enviar o comentário.")
    author = " ".join(str(payload.get("author") or "").strip().split()) or "Anônimo"
    if len(author) > 50 or any(ord(character) < 32 for character in author):
        raise ValueError("O nome deve ter no máximo 50 caracteres.")
    body = str(payload.get("body") or "").strip()
    if not (2 <= len(body) <= 500):
        raise ValueError("O comentário deve ter entre 2 e 500 caracteres.")
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat(timespec="seconds")
    now = datetime.now(timezone.utc).isoformat(timespec="microseconds")
    with DB_LOCK, connect_database() as connection:
        recent = connection.execute(
            "SELECT COUNT(*) AS total FROM news_comments WHERE visitor_id = ? AND created_at >= ?",
            (visitor_id, cutoff),
        ).fetchone()
        if int(recent["total"] or 0) >= 3:
            raise ValueError("Você enviou vários comentários. Aguarde alguns minutos para continuar.")
        connection.execute(
            "INSERT INTO news_comments (id, article_id, visitor_id, author, body, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (f"comment-{uuid.uuid4()}", article_key, visitor_id, author, body, now),
        )
        connection.commit()
    return news_engagement(article_key, visitor_id)


def save_news_rating(article_id: object, visitor_value: object, score_value: object) -> dict[str, object]:
    article_key = str(article_id or "").strip()
    visitor_id = validate_news_visitor(visitor_value)
    if not news_article_exists(article_key):
        raise LookupError("Notícia não encontrada.")
    try:
        score = int(score_value)
    except (TypeError, ValueError) as error:
        raise ValueError("Escolha uma nota de 1 a 5.") from error
    if not 1 <= score <= 5:
        raise ValueError("Escolha uma nota de 1 a 5.")
    now = datetime.now(timezone.utc).isoformat(timespec="microseconds")
    with DB_LOCK, connect_database() as connection:
        connection.execute(
            """
            INSERT INTO news_ratings (article_id, visitor_id, score, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(article_id, visitor_id) DO UPDATE SET
                score = excluded.score, updated_at = excluded.updated_at
            """,
            (article_key, visitor_id, score, now, now),
        )
        connection.commit()
    return news_engagement(article_key, visitor_id)


def report_news_comment(comment_id: object, visitor_value: object) -> dict[str, object]:
    comment_key = str(comment_id or "").strip()
    visitor_id = validate_news_visitor(visitor_value)
    with DB_LOCK, connect_database() as connection:
        comment = connection.execute(
            "SELECT id FROM news_comments WHERE id = ?", (comment_key,)
        ).fetchone()
        if comment is None:
            raise LookupError("Comentário não encontrado.")
        existing = connection.execute(
            "SELECT 1 FROM news_comment_reports WHERE comment_id = ? AND visitor_id = ?",
            (comment_key, visitor_id),
        ).fetchone()
        if existing is None:
            connection.execute(
                "INSERT INTO news_comment_reports (comment_id, visitor_id, created_at) VALUES (?, ?, ?)",
                (comment_key, visitor_id, utc_now()),
            )
            connection.commit()
    return {"ok": True, "alreadyReported": existing is not None}


def delete_news_comment(comment_id: str) -> bool:
    with connect_database() as connection:
        connection.execute("DELETE FROM news_comment_reports WHERE comment_id = ?", (comment_id,))
        cursor = connection.execute("DELETE FROM news_comments WHERE id = ?", (comment_id,))
        connection.commit()
    return cursor.rowcount == 1


def official_players(state: dict[str, object]) -> dict[str, dict[str, object]]:
    return {
        str(player["id"]): player
        for player in (state.get("players") or [])
        if isinstance(player, dict) and player.get("id")
    }


def calculate_player_statistics(state: dict[str, object]) -> dict[str, dict[str, object]]:
    players = official_players(state)
    settings = state.get("settings") if isinstance(state.get("settings"), dict) else {}
    league_settings = settings.get("league") if isinstance(settings.get("league"), dict) else {}
    try:
        win_points = int(league_settings.get("winPoints") or 3)
    except (TypeError, ValueError):
        win_points = 3
    stats = {
        player_id: {
            "playerId": player_id,
            "played": 0,
            "wins": 0,
            "losses": 0,
            "points": 0,
            "ballsMade": 0,
            "ballsAgainst": 0,
            "ballBalance": 0,
            "winRate": 0,
            "currentStreak": 0,
            "recentForm": [],
        }
        for player_id in players
    }
    completed: list[tuple[str, dict[str, object], dict[str, object]]] = []
    league = state.get("league") if isinstance(state.get("league"), dict) else {}
    results = league.get("results") if isinstance(league.get("results"), dict) else {}
    for match_id, match in league_matches(state).items():
        result = results.get(match_id)
        if not isinstance(result, dict):
            continue
        player_a = str(match.get("playerAId") or "")
        player_b = str(match.get("playerBId") or "")
        winner = str(result.get("winnerId") or "")
        if (
            player_a not in stats
            or player_b not in stats
            or result.get("playerAId") != player_a
            or result.get("playerBId") != player_b
            or winner not in {player_a, player_b}
        ):
            continue
        try:
            balls_a = max(0, min(8, int(result.get("ballsA") or 0)))
            balls_b = max(0, min(8, int(result.get("ballsB") or 0)))
        except (TypeError, ValueError):
            balls_a = balls_b = 0
        loser = player_b if winner == player_a else player_a
        for player_id in (player_a, player_b):
            stats[player_id]["played"] += 1
        stats[winner]["wins"] += 1
        stats[winner]["points"] += win_points
        stats[loser]["losses"] += 1
        stats[player_a]["ballsMade"] += balls_a
        stats[player_a]["ballsAgainst"] += balls_b
        stats[player_b]["ballsMade"] += balls_b
        stats[player_b]["ballsAgainst"] += balls_a
        completed.append((str(result.get("playedAt") or ""), match, result))
    completed.sort(key=lambda item: item[0])
    streaks = {player_id: 0 for player_id in players}
    for _, match, result in completed:
        winner = str(result["winnerId"])
        loser = str(match["playerBId"] if winner == match["playerAId"] else match["playerAId"])
        streaks[winner] = max(0, streaks[winner]) + 1
        streaks[loser] = 0
        stats[winner]["recentForm"].append("W")
        stats[loser]["recentForm"].append("L")
    for player_id, row in stats.items():
        row["ballBalance"] = int(row["ballsMade"]) - int(row["ballsAgainst"])
        row["winRate"] = round((int(row["wins"]) / int(row["played"])) * 100, 1) if row["played"] else 0
        row["currentStreak"] = streaks[player_id]
        row["recentForm"] = row["recentForm"][-5:]
    ordered = sorted(
        stats.values(),
        key=lambda row: (
            -int(row["points"]),
            -int(row["wins"]),
            -int(row["ballBalance"]),
            -int(row["ballsMade"]),
            str(players[str(row["playerId"])].get("name") or "").casefold(),
        ),
    )
    for index, row in enumerate(ordered, 1):
        row["position"] = index
    return stats


def decode_profile_image(value: object) -> tuple[bytes | None, str | None]:
    if value in (None, ""):
        return None, None
    raw = str(value)
    if not raw.startswith("data:image/") or ";base64," not in raw:
        raise ValueError("A foto enviada é inválida.")
    header, encoded = raw.split(",", 1)
    content_type = header[5:].split(";", 1)[0].lower()
    if content_type not in {"image/jpeg", "image/png", "image/webp"}:
        raise ValueError("Use uma foto JPG, PNG ou WebP.")
    try:
        content = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as error:
        raise ValueError("A foto enviada está corrompida.") from error
    if len(content) > MAX_PROFILE_IMAGE_BYTES:
        raise ValueError("A foto ultrapassa o limite de 700 KB.")
    validate_image_signature(content, content_type)
    return content, content_type


def profile_record(
    player_id: str,
    player: dict[str, object],
    row: object | None,
    stats: dict[str, object],
    *,
    details: bool = False,
    include_hidden: bool = False,
) -> dict[str, object]:
    profile = {
        "playerId": player_id,
        "name": str(player.get("name") or "Jogador"),
        "displayName": row["display_name"] if row else "",
        "nickname": row["nickname"] if row else "",
        "bio": row["bio"] if row else "",
        "favoriteShot": row["favorite_shot"] if row else "",
        "joinedAt": row["joined_at"] if row else player.get("createdAt"),
        "imageUrl": f"/api/players/profile/image?id={player_id}" if row and row["image_type"] else "",
        "createdAt": row["created_at"] if row else None,
        "updatedAt": row["updated_at"] if row else None,
        "statistics": stats,
    }
    if details:
        with connect_database() as connection:
            awards = connection.execute(
                """
                SELECT id, type, title, description, season_id, poll_id, awarded_at
                FROM player_awards WHERE player_id = ? ORDER BY awarded_at DESC
                """,
                (player_id,),
            ).fetchall()
            articles = connection.execute(
                """
                SELECT l.article_id FROM news_player_links l
                JOIN news_articles n ON n.id = l.article_id
                WHERE l.player_id = ?
                AND (? = 1 OR (n.status = 'published' AND n.published_at <= ?))
                ORDER BY n.published_at DESC LIMIT 20
                """,
                (player_id, 1 if include_hidden else 0, utc_now()),
            ).fetchall()
        profile["awards"] = [{
            "id": item["id"],
            "type": item["type"],
            "title": item["title"],
            "description": item["description"],
            "seasonId": item["season_id"],
            "pollId": item["poll_id"],
            "awardedAt": item["awarded_at"],
        } for item in awards]
        profile["newsIds"] = [item["article_id"] for item in articles]
    return profile


def list_player_profiles(
    player_id: str | None = None,
    include_hidden: bool = False,
) -> list[dict[str, object]]:
    state = read_state()["state"] or {}
    players = official_players(state)
    if player_id and player_id not in players:
        raise LookupError("Jogador não encontrado.")
    stats = calculate_player_statistics(state)
    with connect_database() as connection:
        if player_id:
            rows = connection.execute(
                "SELECT * FROM player_profiles WHERE player_id = ?", (player_id,)
            ).fetchall()
        else:
            rows = connection.execute("SELECT * FROM player_profiles").fetchall()
    rows_by_id = {str(row["player_id"]): row for row in rows}
    selected = [player_id] if player_id else list(players)
    profiles = [
        profile_record(
            key,
            players[key],
            rows_by_id.get(key),
            stats.get(key, {}),
            details=bool(player_id),
            include_hidden=include_hidden,
        )
        for key in selected
    ]
    if player_id and profiles:
        profiles[0]["nextOpponent"] = next_opponent(state, player_id)
    return profiles


def save_player_profile(payload: dict[str, object], username: str) -> dict[str, object]:
    player_id = clean_short_text(payload.get("playerId") or payload.get("id"), 120)
    state = read_state()["state"] or {}
    if player_id not in official_players(state):
        raise LookupError("Jogador não encontrado.")
    display_name = clean_short_text(payload.get("displayName"), 80)
    nickname = clean_short_text(payload.get("nickname"), 80)
    bio = str(payload.get("bio") or "").strip()
    favorite_shot = clean_short_text(payload.get("favoriteShot"), 120)
    if len(bio) > 2000:
        raise ValueError("A biografia deve ter no máximo 2.000 caracteres.")
    joined_at = parse_iso_datetime(payload.get("joinedAt"), field="A data de entrada")
    image_data, image_type = decode_profile_image(payload.get("imageData"))
    now = utc_now()
    with DB_LOCK, connect_database() as connection:
        current = connection.execute(
            "SELECT image_data, image_type, created_at FROM player_profiles WHERE player_id = ?",
            (player_id,),
        ).fetchone()
        if current and image_data is None and not payload.get("removeImage"):
            image_data, image_type = current["image_data"], current["image_type"]
        if payload.get("removeImage"):
            image_data = image_type = None
        created_at = current["created_at"] if current else now
        connection.execute(
            """
            INSERT INTO player_profiles (
                player_id, display_name, bio, nickname, image_data, image_type,
                favorite_shot, joined_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(player_id) DO UPDATE SET
                display_name = excluded.display_name, bio = excluded.bio,
                nickname = excluded.nickname, image_data = excluded.image_data,
                image_type = excluded.image_type, favorite_shot = excluded.favorite_shot,
                joined_at = excluded.joined_at, updated_at = excluded.updated_at
            """,
            (
                player_id, display_name, bio, nickname, image_data, image_type,
                favorite_shot, joined_at, created_at, now,
            ),
        )
        audit_record(connection, "profile.saved", "player_profile", player_id, {}, username)
        connection.commit()
    return list_player_profiles(player_id, include_hidden=True)[0]


def next_opponent(state: dict[str, object], player_id: str) -> dict[str, object] | None:
    league = state.get("league") if isinstance(state.get("league"), dict) else {}
    programming = league.get("programming") if isinstance(league.get("programming"), dict) else {}
    completed_ids = completed_league_match_ids(state)
    candidates = []
    for match_id, match in league_matches(state).items():
        if match_id in completed_ids or player_id not in {match.get("playerAId"), match.get("playerBId")}:
            continue
        opponent = match.get("playerBId") if match.get("playerAId") == player_id else match.get("playerAId")
        scheduled = (
            programming.get("matches", {}).get(match_id, {}).get("scheduledAt")
            if isinstance(programming.get("matches"), dict)
            else None
        )
        weight = 0 if programming.get("nextMatchId") == match_id else 1 if scheduled else 2
        candidates.append((weight, scheduled or "", int(match.get("roundNumber") or 0), match_id, opponent))
    if not candidates:
        return None
    _, scheduled, round_number, match_id, opponent = sorted(candidates)[0]
    return {
        "matchId": match_id,
        "opponentId": opponent,
        "roundNumber": round_number,
        "scheduledAt": scheduled or None,
    }


def match_details(match_id: str) -> dict[str, object]:
    state = read_state()["state"] or {}
    matches = league_matches(state)
    match = matches.get(match_id)
    if not match:
        raise LookupError("Confronto não encontrado.")
    league = state.get("league") if isinstance(state.get("league"), dict) else {}
    results = league.get("results") if isinstance(league.get("results"), dict) else {}
    completed_ids = completed_league_match_ids(state)
    programming = league.get("programming") if isinstance(league.get("programming"), dict) else {}
    player_a = str(match.get("playerAId") or "")
    player_b = str(match.get("playerBId") or "")
    stats = calculate_player_statistics(state)
    previous: list[dict[str, object]] = []
    for candidate_id, candidate in matches.items():
        result = results.get(candidate_id) if candidate_id in completed_ids else None
        if not isinstance(result, dict):
            continue
        if {candidate.get("playerAId"), candidate.get("playerBId")} != {player_a, player_b}:
            continue
        previous.append({
            "matchId": candidate_id,
            "roundNumber": candidate.get("roundNumber"),
            "result": result,
        })
    previous.sort(key=lambda item: str(item["result"].get("playedAt") or ""), reverse=True)
    return {
        "id": match_id,
        "roundNumber": match.get("roundNumber"),
        "playerAId": player_a,
        "playerBId": player_b,
        "result": results.get(match_id) if match_id in completed_ids else None,
        "inProgress": bool(league.get("inProgress", {}).get(match_id)) if isinstance(league.get("inProgress"), dict) else False,
        "programming": programming.get("matches", {}).get(match_id) if isinstance(programming.get("matches"), dict) else None,
        "isNext": programming.get("nextMatchId") == match_id,
        "isFeatured": match_id in (programming.get("featuredMatchIds") or []),
        "availability": {
            player_a: (state.get("availability") or {}).get(player_a, []),
            player_b: (state.get("availability") or {}).get(player_b, []),
        },
        "statistics": {
            player_a: stats.get(player_a, {}),
            player_b: stats.get(player_b, {}),
        },
        "headToHead": previous,
    }


def season_record(
    row: object,
    include_snapshot: bool = False,
    include_private: bool = False,
) -> dict[str, object]:
    record = {
        "id": row["id"],
        "title": row["title"],
        "startedAt": row["started_at"],
        "endedAt": row["ended_at"],
        "championPlayerId": row["champion_player_id"],
        "runnerUpPlayerId": row["runner_up_player_id"],
        "championName": row["champion_name"],
        "runnerUpName": row["runner_up_name"],
        "summary": row["summary"],
        "createdBy": row["created_by"],
        "createdAt": row["created_at"],
    }
    if include_snapshot:
        snapshot = json.loads(row["snapshot_json"])
        if not include_private:
            league = snapshot.get("league") if isinstance(snapshot, dict) else None
            programming = league.get("programming") if isinstance(league, dict) else None
            if isinstance(programming, dict) and isinstance(programming.get("matches"), dict):
                for entry in programming["matches"].values():
                    if isinstance(entry, dict):
                        entry["note"] = ""
        record["snapshot"] = snapshot
    return record


def list_seasons(
    season_id: str | None = None,
    include_private: bool = False,
) -> list[dict[str, object]]:
    with connect_database() as connection:
        if season_id:
            rows = connection.execute(
                "SELECT * FROM season_archives WHERE id = ?", (season_id,)
            ).fetchall()
        else:
            rows = connection.execute(
                """
                SELECT id, title, started_at, ended_at, champion_player_id,
                       runner_up_player_id, champion_name, runner_up_name,
                       summary, created_by, created_at
                FROM season_archives ORDER BY ended_at DESC, created_at DESC
                """
            ).fetchall()
    if season_id and not rows:
        raise LookupError("Temporada não encontrada.")
    return [
        season_record(
            row,
            include_snapshot=bool(season_id),
            include_private=include_private,
        )
        for row in rows
    ]


def archive_season(payload: dict[str, object], username: str) -> dict[str, object]:
    state_payload = read_state()
    state = state_payload.get("state") if isinstance(state_payload.get("state"), dict) else {}
    players = official_players(state)
    matches = league_matches(state)
    league = state.get("league") if isinstance(state.get("league"), dict) else {}
    results = league.get("results") if isinstance(league.get("results"), dict) else {}
    completed_ids = completed_league_match_ids(state)
    pending = [match_id for match_id in matches if match_id not in completed_ids]
    if pending and not payload.get("confirmPending"):
        raise ValueError(f"A temporada ainda possui {len(pending)} partida(s) pendente(s). Confirme o arquivamento.")
    title = clean_news_text(payload.get("title"), "O título", 3, 140)
    ended_at = parse_iso_datetime(payload.get("endedAt") or utc_now(), field="A data final") or utc_now()
    started_at = parse_iso_datetime(payload.get("startedAt"), field="A data inicial")
    stats = calculate_player_statistics(state)
    ranking = sorted(stats.values(), key=lambda row: int(row.get("position") or 9999))
    has_results = bool(completed_ids)
    champion = clean_short_text(payload.get("championPlayerId"), 120)
    runner_up = clean_short_text(payload.get("runnerUpPlayerId"), 120)
    if not champion and has_results and ranking:
        champion = str(ranking[0]["playerId"])
    if not runner_up and has_results and len(ranking) > 1:
        runner_up = str(ranking[1]["playerId"])
    if champion and champion not in players:
        raise ValueError("Campeão inválido.")
    if runner_up and runner_up not in players:
        raise ValueError("Vice-campeão inválido.")
    if champion and champion == runner_up:
        raise ValueError("Campeão e vice devem ser jogadores diferentes.")
    summary = str(payload.get("summary") or "").strip()
    if len(summary) > 3000:
        raise ValueError("O resumo deve ter no máximo 3.000 caracteres.")
    with connect_database() as connection:
        awards = connection.execute(
            "SELECT * FROM player_awards ORDER BY awarded_at"
        ).fetchall()
    snapshot = {
        "stateVersion": state.get("version"),
        "stateRevision": state_payload.get("revision"),
        "players": list(players.values()),
        "settings": state.get("settings"),
        "league": state.get("league"),
        "tournament": state.get("tournament"),
        "ranking": [
            {
                **row,
                "id": row["playerId"],
                "name": str(players[str(row["playerId"])].get("name") or "Jogador"),
            }
            for row in ranking
        ],
        "awards": [dict(item) for item in awards],
        "archivedAt": utc_now(),
        "archivedBy": username,
    }
    season_id = clean_short_text(payload.get("id"), 120) or f"season-{uuid.uuid4()}"
    now = utc_now()
    with DB_LOCK, connect_database() as connection:
        if connection.execute("SELECT 1 FROM season_archives WHERE id = ?", (season_id,)).fetchone():
            raise ValueError("Já existe uma temporada com esse identificador.")
        connection.execute(
            """
            INSERT INTO season_archives (
                id, title, started_at, ended_at, champion_player_id,
                runner_up_player_id, champion_name, runner_up_name,
                snapshot_json, summary, created_by, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                season_id, title, started_at, ended_at, champion or None,
                runner_up or None,
                str(players[champion].get("name") or "") if champion else None,
                str(players[runner_up].get("name") or "") if runner_up else None,
                json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")),
                summary, username, now,
            ),
        )
        audit_record(connection, "season.archived", "season", season_id, {"pendingMatches": len(pending)}, username)
        connection.commit()
    return list_seasons(season_id, include_private=True)[0]


def generic_visitor(value: object) -> str:
    return validate_news_visitor(value)


def enforce_social_rate_limit(
    connection: object,
    visitor_id: str,
    action: str,
    maximum: int,
    window_seconds: int = 600,
) -> None:
    now = time.time()
    cutoff = now - window_seconds
    connection.execute("DELETE FROM social_rate_events WHERE occurred_at < ?", (cutoff,))
    row = connection.execute(
        """
        SELECT COUNT(*) AS total FROM social_rate_events
        WHERE visitor_id = ? AND action = ? AND occurred_at >= ?
        """,
        (visitor_id, action, cutoff),
    ).fetchone()
    if int(row["total"] or 0) >= maximum:
        raise ValueError("Muitas ações em pouco tempo. Aguarde alguns minutos.")
    connection.execute(
        "INSERT INTO social_rate_events (visitor_id, action, occurred_at) VALUES (?, ?, ?)",
        (visitor_id, action, now),
    )


def poll_record(connection: object, row: object, visitor_id: str | None = None) -> dict[str, object]:
    options = connection.execute(
        """
        SELECT o.id, o.player_id, o.match_id, o.label, o.sort_order,
               (SELECT COUNT(*) FROM poll_votes v WHERE v.option_id = o.id) AS vote_count
        FROM poll_options o WHERE o.poll_id = ? ORDER BY o.sort_order, o.id
        """,
        (row["id"],),
    ).fetchall()
    own_vote = None
    if visitor_id:
        vote = connection.execute(
            "SELECT option_id FROM poll_votes WHERE poll_id = ? AND visitor_id = ?",
            (row["id"], visitor_id),
        ).fetchone()
        own_vote = vote["option_id"] if vote else None
    return {
        "id": row["id"],
        "type": row["type"],
        "title": row["title"],
        "description": row["description"],
        "startsAt": row["starts_at"],
        "endsAt": row["ends_at"],
        "status": row["status"],
        "createdBy": row["created_by"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "options": [{
            "id": option["id"],
            "playerId": option["player_id"],
            "matchId": option["match_id"],
            "label": option["label"],
            "voteCount": int(option["vote_count"] or 0),
        } for option in options],
        "totalVotes": sum(int(option["vote_count"] or 0) for option in options),
        "userOptionId": own_vote,
    }


def list_polls(visitor_id: str | None, include_hidden: bool = False) -> list[dict[str, object]]:
    now = utc_now()
    query = "SELECT * FROM polls"
    parameters: tuple[object, ...] = ()
    if not include_hidden:
        query += " WHERE status IN ('open', 'closed') AND starts_at <= ?"
        parameters = (now,)
    query += " ORDER BY created_at DESC"
    with connect_database() as connection:
        rows = connection.execute(query, parameters).fetchall()
        return [poll_record(connection, row, visitor_id) for row in rows]


def close_poll_awards(connection: object, poll_id: str, username: str) -> None:
    poll = connection.execute("SELECT title, type FROM polls WHERE id = ?", (poll_id,)).fetchone()
    if not poll:
        return
    winners = connection.execute(
        """
        SELECT o.player_id, o.label, COUNT(v.option_id) AS total
        FROM poll_options o LEFT JOIN poll_votes v ON v.option_id = o.id
        WHERE o.poll_id = ? AND o.player_id IS NOT NULL
        GROUP BY o.id, o.player_id, o.label
        HAVING COUNT(v.option_id) = (
            SELECT MAX(total) FROM (
                SELECT COUNT(v2.option_id) AS total
                FROM poll_options o2 LEFT JOIN poll_votes v2 ON v2.option_id = o2.id
                WHERE o2.poll_id = ? GROUP BY o2.id
            ) vote_totals
        ) AND COUNT(v.option_id) > 0
        """,
        (poll_id, poll_id),
    ).fetchall()
    for winner in winners:
        connection.execute(
            """
            INSERT INTO player_awards (
                id, player_id, type, title, description, season_id,
                poll_id, awarded_at, created_by
            ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)
            ON CONFLICT(player_id, type, poll_id) DO NOTHING
            """,
            (
                f"award-{uuid.uuid4()}", winner["player_id"], poll["type"],
                poll["title"], f"Vencedor da votação: {winner['label']}",
                poll_id, utc_now(), username,
            ),
        )


def save_poll(payload: dict[str, object], username: str) -> dict[str, object]:
    poll_id = clean_short_text(payload.get("id"), 120) or f"poll-{uuid.uuid4()}"
    poll_type = clean_short_text(payload.get("type") or "custom", 50)
    title = clean_news_text(payload.get("title"), "O título", 3, 180)
    description = str(payload.get("description") or "").strip()
    if len(description) > 1000:
        raise ValueError("A descrição deve ter no máximo 1.000 caracteres.")
    status = str(payload.get("status") or "draft")
    if status not in POLL_STATUSES:
        raise ValueError("Status da enquete inválido.")
    starts_at = parse_iso_datetime(payload.get("startsAt") or utc_now(), field="A data inicial") or utc_now()
    ends_at = parse_iso_datetime(payload.get("endsAt"), field="A data final")
    if ends_at and ends_at <= starts_at:
        raise ValueError("A data final deve ser posterior à data inicial.")
    raw_options = payload.get("options")
    if not isinstance(raw_options, list) or not 2 <= len(raw_options) <= 20:
        raise ValueError("Informe de 2 a 20 opções.")
    state = read_state()["state"] or {}
    players = official_players(state)
    matches = league_matches(state)
    options: list[dict[str, object]] = []
    for index, raw in enumerate(raw_options):
        if not isinstance(raw, dict):
            raise ValueError("Opção de enquete inválida.")
        label = clean_news_text(raw.get("label"), "O texto da opção", 1, 120)
        player_id = clean_short_text(raw.get("playerId"), 120)
        match_id = clean_short_text(raw.get("matchId"), 120)
        if player_id and player_id not in players:
            raise ValueError("Uma opção referencia jogador inexistente.")
        if match_id and match_id not in matches:
            raise ValueError("Uma opção referencia partida inexistente.")
        options.append({
            "id": clean_short_text(raw.get("id"), 120) or f"poll-option-{uuid.uuid4()}",
            "playerId": player_id or None,
            "matchId": match_id or None,
            "label": label,
            "sortOrder": index,
        })
    now = utc_now()
    with DB_LOCK, connect_database() as connection:
        current = connection.execute("SELECT status, created_at FROM polls WHERE id = ?", (poll_id,)).fetchone()
        if current and connection.execute(
            "SELECT 1 FROM poll_votes WHERE poll_id = ? LIMIT 1", (poll_id,)
        ).fetchone():
            current_option_ids = {
                row["id"] for row in connection.execute(
                    "SELECT id FROM poll_options WHERE poll_id = ?", (poll_id,)
                ).fetchall()
            }
            if {str(option["id"]) for option in options} != current_option_ids:
                raise ValueError("As opções não podem ser alteradas depois do primeiro voto.")
        connection.execute(
            """
            INSERT INTO polls (
                id, type, title, description, starts_at, ends_at,
                status, created_by, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                type = excluded.type, title = excluded.title,
                description = excluded.description, starts_at = excluded.starts_at,
                ends_at = excluded.ends_at, status = excluded.status,
                updated_at = excluded.updated_at
            """,
            (
                poll_id, poll_type, title, description, starts_at, ends_at,
                status, username, current["created_at"] if current else now, now,
            ),
        )
        if not current or not connection.execute(
            "SELECT 1 FROM poll_votes WHERE poll_id = ? LIMIT 1", (poll_id,)
        ).fetchone():
            connection.execute("DELETE FROM poll_options WHERE poll_id = ?", (poll_id,))
            for option in options:
                connection.execute(
                    """
                    INSERT INTO poll_options (id, poll_id, player_id, match_id, label, sort_order)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        option["id"], poll_id, option["playerId"], option["matchId"],
                        option["label"], option["sortOrder"],
                    ),
                )
        if status == "closed" and (not current or current["status"] != "closed"):
            close_poll_awards(connection, poll_id, username)
        audit_record(connection, "poll.saved", "poll", poll_id, {"status": status}, username)
        connection.commit()
        row = connection.execute("SELECT * FROM polls WHERE id = ?", (poll_id,)).fetchone()
        return poll_record(connection, row)


def vote_poll(payload: dict[str, object], visitor_value: object) -> dict[str, object]:
    visitor_id = generic_visitor(visitor_value)
    poll_id = clean_short_text(payload.get("pollId"), 120)
    option_id = clean_short_text(payload.get("optionId"), 120)
    with DB_LOCK, connect_database() as connection:
        enforce_social_rate_limit(connection, visitor_id, "poll_vote", 20)
        cutoff = (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat(timespec="seconds")
        recent = connection.execute(
            "SELECT COUNT(*) AS total FROM poll_votes WHERE visitor_id = ? AND created_at >= ?",
            (visitor_id, cutoff),
        ).fetchone()
        if int(recent["total"] or 0) >= 20:
            raise ValueError("Muitos votos em pouco tempo. Aguarde alguns minutos.")
        poll = connection.execute("SELECT * FROM polls WHERE id = ?", (poll_id,)).fetchone()
        if not poll:
            raise LookupError("Enquete não encontrada.")
        now = utc_now()
        if poll["status"] != "open" or poll["starts_at"] > now or (poll["ends_at"] and poll["ends_at"] <= now):
            raise ValueError("Esta enquete não está aberta para votação.")
        option = connection.execute(
            "SELECT 1 FROM poll_options WHERE id = ? AND poll_id = ?", (option_id, poll_id)
        ).fetchone()
        if not option:
            raise ValueError("Opção de voto inválida.")
        try:
            connection.execute(
                "INSERT INTO poll_votes (poll_id, option_id, visitor_id, created_at) VALUES (?, ?, ?, ?)",
                (poll_id, option_id, visitor_id, now),
            )
        except Exception as error:
            if is_integrity_error(error):
                raise ValueError("Você já votou nesta enquete.") from error
            raise
        connection.commit()
        return poll_record(connection, poll, visitor_id)


def delete_poll(poll_id: str, username: str) -> bool:
    with DB_LOCK, connect_database() as connection:
        connection.execute("DELETE FROM player_awards WHERE poll_id = ?", (poll_id,))
        connection.execute("DELETE FROM poll_votes WHERE poll_id = ?", (poll_id,))
        connection.execute("DELETE FROM poll_options WHERE poll_id = ?", (poll_id,))
        cursor = connection.execute("DELETE FROM polls WHERE id = ?", (poll_id,))
        if cursor.rowcount:
            audit_record(connection, "poll.deleted", "poll", poll_id, {}, username)
        connection.commit()
    return cursor.rowcount == 1


def content_exists(content_type: str, content_id: str) -> bool:
    if content_type == "news":
        return news_article_exists(content_id)
    if content_type == "match":
        state = read_state()["state"] or {}
        return content_id in league_matches(state)
    if content_type == "season":
        with connect_database() as connection:
            return connection.execute(
                "SELECT 1 FROM season_archives WHERE id = ?", (content_id,)
            ).fetchone() is not None
    return False


def reaction_summary(content_type: str, content_id: str, visitor_id: str | None) -> dict[str, object]:
    if content_type not in {"news", "match", "season"} or not content_exists(content_type, content_id):
        raise LookupError("Conteúdo não encontrado.")
    with connect_database() as connection:
        rows = connection.execute(
            """
            SELECT reaction, COUNT(*) AS total FROM content_reactions
            WHERE content_type = ? AND content_id = ? GROUP BY reaction
            """,
            (content_type, content_id),
        ).fetchall()
        own = None
        if visitor_id:
            own = connection.execute(
                """
                SELECT reaction FROM content_reactions
                WHERE content_type = ? AND content_id = ? AND visitor_id = ?
                """,
                (content_type, content_id, visitor_id),
            ).fetchone()
    return {
        "counts": {reaction: next(
            (int(row["total"]) for row in rows if row["reaction"] == reaction), 0
        ) for reaction in sorted(REACTIONS)},
        "userReaction": own["reaction"] if own else None,
    }


def save_reaction(payload: dict[str, object], visitor_value: object) -> dict[str, object]:
    visitor_id = generic_visitor(visitor_value)
    content_type = clean_short_text(payload.get("contentType"), 30)
    content_id = clean_short_text(payload.get("contentId"), 120)
    reaction = clean_short_text(payload.get("reaction"), 40)
    if reaction and reaction not in REACTIONS:
        raise ValueError("Reação inválida.")
    if not content_exists(content_type, content_id):
        raise LookupError("Conteúdo não encontrado.")
    now = utc_now()
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat(timespec="seconds")
    with DB_LOCK, connect_database() as connection:
        enforce_social_rate_limit(connection, visitor_id, "reaction", 40)
        recent = connection.execute(
            "SELECT COUNT(*) AS total FROM content_reactions WHERE visitor_id = ? AND updated_at >= ?",
            (visitor_id, cutoff),
        ).fetchone()
        existing = connection.execute(
            """
            SELECT 1 FROM content_reactions
            WHERE content_type = ? AND content_id = ? AND visitor_id = ?
            """,
            (content_type, content_id, visitor_id),
        ).fetchone()
        if not existing and int(recent["total"] or 0) >= 30:
            raise ValueError("Muitas reações em pouco tempo. Aguarde alguns minutos.")
        if not reaction:
            connection.execute(
                """
                DELETE FROM content_reactions
                WHERE content_type = ? AND content_id = ? AND visitor_id = ?
                """,
                (content_type, content_id, visitor_id),
            )
        else:
            connection.execute(
                """
                INSERT INTO content_reactions (
                    content_type, content_id, visitor_id, reaction, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(content_type, content_id, visitor_id) DO UPDATE SET
                    reaction = excluded.reaction, updated_at = excluded.updated_at
                """,
                (content_type, content_id, visitor_id, reaction, now, now),
            )
        connection.commit()
    return reaction_summary(content_type, content_id, visitor_id)


def community_record(row: object, include_hidden: bool) -> dict[str, object]:
    record = {
        "id": row["id"],
        "contentType": row["content_type"],
        "contentId": row["content_id"],
        "author": row["author"],
        "body": row["body"],
        "status": row["status"],
        "createdAt": row["created_at"],
    }
    if include_hidden:
        record.update({
            "status": row["status"],
            "reportCount": int(row["report_count"] or 0),
            "updatedAt": row["updated_at"],
            "moderatedBy": row["moderated_by"],
            "moderatedAt": row["moderated_at"],
        })
    return record


def list_community(
    include_hidden: bool = False,
    content_type: str | None = "community",
    content_id: str = "",
) -> list[dict[str, object]]:
    query = "SELECT * FROM community_posts"
    clauses: list[str] = []
    parameters: list[object] = []
    if content_type is not None:
        clauses.extend(["content_type = ?", "content_id = ?"])
        parameters.extend([content_type, content_id])
    if not include_hidden:
        clauses.append("status = ?")
        parameters.append("published")
    if clauses:
        query += " WHERE " + " AND ".join(clauses)
    query += " ORDER BY created_at DESC LIMIT 200"
    with connect_database() as connection:
        rows = connection.execute(query, parameters).fetchall()
    return [community_record(row, include_hidden) for row in rows]


def save_community_post(payload: dict[str, object], visitor_value: object) -> dict[str, object]:
    visitor_id = generic_visitor(visitor_value)
    if str(payload.get("website") or "").strip():
        raise ValueError("Não foi possível publicar a mensagem.")
    author = " ".join(str(payload.get("author") or "").strip().split()) or "Anônimo"
    body = str(payload.get("body") or "").strip()
    if not (1 <= len(author) <= 80) or any(ord(character) < 32 for character in author):
        raise ValueError("O nome deve ter no máximo 80 caracteres.")
    if not (2 <= len(body) <= 800):
        raise ValueError("A mensagem deve ter entre 2 e 800 caracteres.")
    content_type = clean_short_text(payload.get("contentType") or "community", 30)
    content_id = clean_short_text(payload.get("contentId"), 120)
    if content_type == "community":
        content_id = ""
    elif content_type not in {"match", "news"} or not content_id or not content_exists(content_type, content_id):
        raise ValueError("O conteúdo relacionado é inválido.")
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat(timespec="seconds")
    now = datetime.now(timezone.utc).isoformat(timespec="microseconds")
    post_id = f"community-{uuid.uuid4()}"
    with DB_LOCK, connect_database() as connection:
        enforce_social_rate_limit(connection, visitor_id, "community_post", 3)
        recent = connection.execute(
            "SELECT COUNT(*) AS total FROM community_posts WHERE visitor_id = ? AND created_at >= ?",
            (visitor_id, cutoff),
        ).fetchone()
        if int(recent["total"] or 0) >= 3:
            raise ValueError("Você publicou várias mensagens. Aguarde alguns minutos.")
        connection.execute(
            """
            INSERT INTO community_posts (
                id, visitor_id, content_type, content_id, author, body, status, report_count,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, 'published', 0, ?, ?)
            """,
            (post_id, visitor_id, content_type, content_id, author, body, now, now),
        )
        connection.commit()
        row = connection.execute("SELECT * FROM community_posts WHERE id = ?", (post_id,)).fetchone()
    return community_record(row, False)


def report_community_post(post_id: object, visitor_value: object) -> dict[str, object]:
    visitor_id = generic_visitor(visitor_value)
    post_key = clean_short_text(post_id, 120)
    with DB_LOCK, connect_database() as connection:
        enforce_social_rate_limit(connection, visitor_id, "community_report", 20)
        cutoff = (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat(timespec="seconds")
        recent = connection.execute(
            """
            SELECT COUNT(*) AS total FROM community_post_reports
            WHERE visitor_id = ? AND created_at >= ?
            """,
            (visitor_id, cutoff),
        ).fetchone()
        if int(recent["total"] or 0) >= 20:
            raise ValueError("Muitas denúncias em pouco tempo. Aguarde alguns minutos.")
        post = connection.execute(
            "SELECT status FROM community_posts WHERE id = ?", (post_key,)
        ).fetchone()
        if not post or post["status"] == "deleted":
            raise LookupError("Mensagem não encontrada.")
        existing = connection.execute(
            "SELECT 1 FROM community_post_reports WHERE post_id = ? AND visitor_id = ?",
            (post_key, visitor_id),
        ).fetchone()
        if not existing:
            connection.execute(
                "INSERT INTO community_post_reports (post_id, visitor_id, created_at) VALUES (?, ?, ?)",
                (post_key, visitor_id, utc_now()),
            )
            count = connection.execute(
                "SELECT COUNT(*) AS total FROM community_post_reports WHERE post_id = ?",
                (post_key,),
            ).fetchone()
            total = int(count["total"] or 0)
            connection.execute(
                """
                UPDATE community_posts SET report_count = ?, updated_at = ?
                WHERE id = ?
                """,
                (total, utc_now(), post_key),
            )
            connection.commit()
    return {"ok": True, "alreadyReported": existing is not None}


def moderate_community_post(post_id: str, status: str, username: str) -> bool:
    if status not in COMMUNITY_STATUSES:
        raise ValueError("Status de moderação inválido.")
    now = utc_now()
    with DB_LOCK, connect_database() as connection:
        cursor = connection.execute(
            """
            UPDATE community_posts SET status = ?, updated_at = ?,
                moderated_by = ?, moderated_at = ? WHERE id = ?
            """,
            (status, now, username, now, post_id),
        )
        if cursor.rowcount:
            audit_record(
                connection, "community.moderated", "community_post", post_id,
                {"status": status}, username,
            )
        connection.commit()
    return cursor.rowcount == 1


def list_audit_log(limit: int = 100) -> list[dict[str, object]]:
    limit = max(1, min(500, limit))
    with connect_database() as connection:
        rows = connection.execute(
            "SELECT * FROM admin_audit_log ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [{
        "id": row["id"],
        "action": row["action"],
        "entityType": row["entity_type"],
        "entityId": row["entity_id"],
        "detail": json.loads(row["detail_json"] or "{}"),
        "adminUsername": row["admin_username"],
        "createdAt": row["created_at"],
    } for row in rows]


def list_awards(player_id: str = "", season_id: str = "") -> list[dict[str, object]]:
    query = "SELECT * FROM player_awards"
    clauses: list[str] = []
    parameters: list[object] = []
    if player_id:
        clauses.append("player_id = ?")
        parameters.append(player_id)
    if season_id:
        clauses.append("season_id = ?")
        parameters.append(season_id)
    if clauses:
        query += " WHERE " + " AND ".join(clauses)
    query += " ORDER BY awarded_at DESC"
    with connect_database() as connection:
        rows = connection.execute(query, parameters).fetchall()
    return [{
        "id": row["id"],
        "playerId": row["player_id"],
        "type": row["type"],
        "title": row["title"],
        "description": row["description"],
        "seasonId": row["season_id"],
        "pollId": row["poll_id"],
        "awardedAt": row["awarded_at"],
        "createdBy": row["created_by"],
    } for row in rows]


def save_award(payload: dict[str, object], username: str) -> dict[str, object]:
    player_id = clean_short_text(payload.get("playerId"), 120)
    state = read_state()["state"] or {}
    if player_id not in official_players(state):
        raise LookupError("Jogador não encontrado.")
    award_type = clean_short_text(payload.get("type") or "custom", 60)
    title = clean_news_text(payload.get("title"), "O título", 2, 120)
    description = str(payload.get("description") or "").strip()[:1000]
    season_id = clean_short_text(payload.get("seasonId"), 120)
    if season_id:
        with connect_database() as connection:
            if not connection.execute(
                "SELECT 1 FROM season_archives WHERE id = ?", (season_id,)
            ).fetchone():
                raise ValueError("Temporada não encontrada.")
    award_id = clean_short_text(payload.get("id"), 120) or f"award-{uuid.uuid4()}"
    awarded_at = parse_iso_datetime(payload.get("awardedAt") or utc_now(), field="A data da premiação") or utc_now()
    with DB_LOCK, connect_database() as connection:
        connection.execute(
            """
            INSERT INTO player_awards (
                id, player_id, type, title, description, season_id,
                poll_id, awarded_at, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                player_id = excluded.player_id, type = excluded.type,
                title = excluded.title, description = excluded.description,
                season_id = excluded.season_id, awarded_at = excluded.awarded_at
            """,
            (
                award_id, player_id, award_type, title, description,
                season_id or None, awarded_at, username,
            ),
        )
        audit_record(connection, "award.saved", "award", award_id, {"playerId": player_id}, username)
        connection.commit()
    return next(item for item in list_awards(player_id) if item["id"] == award_id)


def delete_award(award_id: str, username: str) -> bool:
    with DB_LOCK, connect_database() as connection:
        cursor = connection.execute("DELETE FROM player_awards WHERE id = ?", (award_id,))
        if cursor.rowcount:
            audit_record(connection, "award.deleted", "award", award_id, {}, username)
        connection.commit()
    return cursor.rowcount == 1



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
    authenticated = False
    default_password_hash: bytes | None = None
    for configured_username, configured_password in ADMIN_ACCOUNTS:
        username_matches = hmac.compare_digest(username, configured_username)
        if configured_password is None:
            if default_password_hash is None:
                default_password_hash = hashlib.pbkdf2_hmac(
                    "sha256",
                    password.encode("utf-8"),
                    DEFAULT_PASSWORD_SALT,
                    PASSWORD_ITERATIONS,
                )
            password_matches = hmac.compare_digest(default_password_hash, DEFAULT_PASSWORD_HASH)
        else:
            password_matches = hmac.compare_digest(password, configured_password)
        authenticated = authenticated or (username_matches and password_matches)
    return authenticated


def create_session(username: str) -> tuple[str, datetime]:
    token = secrets.token_urlsafe(36)
    expires_at = datetime.now(timezone.utc) + SESSION_DURATION
    now = utc_now()
    with connect_database() as connection:
        connection.execute(
            "DELETE FROM admin_sessions WHERE expires_at <= ?",
            (now,),
        )
        connection.execute(
            "INSERT INTO admin_sessions (token_hash, expires_at, created_at, username) VALUES (?, ?, ?, ?)",
            (token_digest(token), expires_at.isoformat(timespec="seconds"), now, username),
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


def session_username(token: str | None) -> str | None:
    if not token:
        return None
    with connect_database() as connection:
        row = connection.execute(
            "SELECT username FROM admin_sessions WHERE token_hash = ? AND expires_at > ?",
            (token_digest(token), utc_now()),
        ).fetchone()
    return str(row["username"] or ADMIN_USERNAME) if row else None


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
            "img-src 'self' data:; connect-src 'self'; "
            "frame-src https://www.youtube-nocookie.com https://player.vimeo.com; frame-ancestors 'none'; "
            "base-uri 'none'; form-action 'self'",
        )
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
        query = parse_qs(urlparse(self.path).query)
        if path == "/api/players/profiles":
            try:
                self.send_json(HTTPStatus.OK, {"profiles": list_player_profiles(include_hidden=self.is_authenticated())})
            except Exception as error:  # pragma: no cover
                self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "Não foi possível carregar os perfis.", "detail": str(error)})
            return
        if path == "/api/players/profile":
            try:
                player_id = query.get("id", [""])[0]
                if not player_id:
                    raise ValueError("Jogador não informado.")
                profiles = list_player_profiles(player_id, include_hidden=self.is_authenticated())
                self.send_json(HTTPStatus.OK, {"profile": profiles[0]})
            except ValueError as error:
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            except LookupError as error:
                self.send_json(HTTPStatus.NOT_FOUND, {"error": str(error)})
            except Exception as error:  # pragma: no cover
                self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "Não foi possível carregar o perfil.", "detail": str(error)})
            return
        if path == "/api/players/profile/image":
            self.send_profile_image(query.get("id", [""])[0])
            return
        if path == "/api/matches":
            try:
                details = match_details(query.get("id", [""])[0])
                if not self.is_authenticated():
                    if isinstance(details.get("programming"), dict):
                        details["programming"]["note"] = ""
                    for entries in details.get("availability", {}).values():
                        for entry in entries:
                            if isinstance(entry, dict):
                                entry["note"] = ""
                self.send_json(HTTPStatus.OK, {
                    "match": details
                })
            except LookupError as error:
                self.send_json(HTTPStatus.NOT_FOUND, {"error": str(error)})
            return
        if path == "/api/schedule":
            try:
                state = read_state()["state"] or {}
                league = state.get("league") if isinstance(state.get("league"), dict) else {}
                programming = json.loads(json.dumps(
                    league.get("programming") if isinstance(league.get("programming"), dict) else {
                        "nextMatchId": None, "featuredMatchIds": [], "matches": {},
                    }
                ))
                availability = json.loads(json.dumps(
                    state.get("availability") if isinstance(state.get("availability"), dict) else {}
                ))
                if not self.is_authenticated():
                    for entry in programming.get("matches", {}).values():
                        if isinstance(entry, dict):
                            entry["note"] = ""
                    for entries in availability.values():
                        for entry in entries:
                            if isinstance(entry, dict):
                                entry["note"] = ""
                warnings = availability_conflicts(state)
                if not self.is_authenticated():
                    for warning in warnings:
                        warning["note"] = ""
                self.send_json(HTTPStatus.OK, {
                    "programming": programming,
                    "availability": availability,
                    "warnings": warnings,
                    "matches": list(league_matches(state).values()),
                })
            except Exception as error:  # pragma: no cover
                self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "Não foi possível carregar a agenda.", "detail": str(error)})
            return
        if path == "/api/seasons":
            try:
                season_id = query.get("id", [""])[0] or None
                seasons = list_seasons(season_id, include_private=self.is_authenticated())
                self.send_json(HTTPStatus.OK, {"season": seasons[0]} if season_id else {"seasons": seasons})
            except LookupError as error:
                self.send_json(HTTPStatus.NOT_FOUND, {"error": str(error)})
            except Exception as error:  # pragma: no cover
                self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "Não foi possível carregar as temporadas.", "detail": str(error)})
            return
        if path == "/api/polls":
            try:
                visitor = self.visitor_id(required=False)
                self.send_json(HTTPStatus.OK, {"polls": list_polls(visitor, self.is_authenticated())})
            except ValueError as error:
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            return
        if path == "/api/reactions":
            try:
                payload = reaction_summary(
                    query.get("contentType", [""])[0],
                    query.get("contentId", [""])[0],
                    self.visitor_id(required=False),
                )
                self.send_json(HTTPStatus.OK, payload)
            except ValueError as error:
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            except LookupError as error:
                self.send_json(HTTPStatus.NOT_FOUND, {"error": str(error)})
            return
        if path == "/api/community":
            try:
                content_type = clean_short_text(query.get("contentType", ["community"])[0], 30) or "community"
                content_id = clean_short_text(query.get("contentId", [""])[0], 120)
                all_scopes = content_type == "all" and self.is_authenticated()
                if all_scopes:
                    content_type = None
                    content_id = ""
                elif content_type == "community":
                    content_id = ""
                elif content_type not in {"match", "news"} or not content_id:
                    raise ValueError("O conteúdo relacionado é inválido.")
                self.send_json(HTTPStatus.OK, {
                    "posts": list_community(self.is_authenticated(), content_type, content_id)
                })
            except ValueError as error:
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            except Exception as error:  # pragma: no cover
                self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "Não foi possível carregar o mural.", "detail": str(error)})
            return
        if path == "/api/awards":
            self.send_json(HTTPStatus.OK, {
                "awards": list_awards(
                    query.get("playerId", [""])[0],
                    query.get("seasonId", [""])[0],
                )
            })
            return
        if path == "/api/stats":
            try:
                state = read_state()["state"] or {}
                statistics = sorted(
                    calculate_player_statistics(state).values(),
                    key=lambda item: int(item.get("position") or 9999),
                )
                self.send_json(HTTPStatus.OK, {"statistics": statistics})
            except Exception as error:  # pragma: no cover
                self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "Não foi possível calcular as estatísticas.", "detail": str(error)})
            return
        if path == "/api/admin/audit":
            if not self.require_authentication():
                return
            try:
                limit = int(query.get("limit", ["100"])[0])
            except ValueError:
                limit = 100
            self.send_json(HTTPStatus.OK, {"entries": list_audit_log(limit)})
            return
        if path == "/api/news":
            try:
                self.send_json(HTTPStatus.OK, {"articles": list_news(self.is_authenticated())})
            except Exception as error:  # pragma: no cover
                self.send_json(
                    HTTPStatus.INTERNAL_SERVER_ERROR,
                    {"error": "Não foi possível carregar as notícias.", "detail": str(error)},
                )
            return

        if path == "/api/news/image":
            article_id = query.get("id", [""])[0]
            self.send_news_image(article_id)
            return

        if path == "/api/news/engagement":
            article_id = query.get("id", [""])[0]
            try:
                payload = news_engagement(
                    article_id,
                    self.headers.get(NEWS_VISITOR_HEADER),
                    self.is_authenticated(),
                )
                self.send_json(HTTPStatus.OK, payload)
            except ValueError as error:
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            except LookupError as error:
                self.send_json(HTTPStatus.NOT_FOUND, {"error": str(error)})
            return

        if path == "/api/state":
            try:
                self.send_json(
                    HTTPStatus.OK,
                    read_state() if self.is_authenticated() else public_state_payload(),
                )
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
            username = session_username(self.session_token())
            authenticated = username is not None
            self.send_json(
                HTTPStatus.OK,
                {
                    "authenticated": authenticated,
                    "username": username,
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
            expected_raw = body.get("expectedRevision")
            expected_revision: int | None = None
            if expected_raw is not None:
                try:
                    expected_revision = int(expected_raw)
                except (TypeError, ValueError) as error:
                    raise ValueError("A revisão esperada é inválida.") from error
                if expected_revision < 0:
                    raise ValueError("A revisão esperada é inválida.")
            username = session_username(self.session_token()) or ADMIN_USERNAME
            with BET_ACTION_LOCK:
                result = save_state(
                    state,
                    expected_revision=expected_revision,
                    username=username,
                )
            self.send_json(
                HTTPStatus.CONFLICT if result.get("conflict") else HTTPStatus.OK,
                result,
            )
        except ValueError as error:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
        except Exception as error:  # pragma: no cover
            self.send_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"error": "Não foi possível salvar no banco.", "detail": str(error)},
            )

    def do_POST(self) -> None:  # noqa: N802
        path = self.request_path()
        if path == "/api/players/profile":
            if not self.require_authentication():
                return
            try:
                profile = save_player_profile(
                    self.read_json_body(),
                    session_username(self.session_token()) or ADMIN_USERNAME,
                )
                self.send_json(HTTPStatus.OK, {"ok": True, "profile": profile})
            except ValueError as error:
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            except LookupError as error:
                self.send_json(HTTPStatus.NOT_FOUND, {"error": str(error)})
            return
        if path == "/api/seasons/archive":
            if not self.require_authentication():
                return
            try:
                season = archive_season(
                    self.read_json_body(),
                    session_username(self.session_token()) or ADMIN_USERNAME,
                )
                self.send_json(HTTPStatus.CREATED, {"ok": True, "season": season})
            except ValueError as error:
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            return
        if path == "/api/polls":
            if not self.require_authentication():
                return
            try:
                poll = save_poll(
                    self.read_json_body(),
                    session_username(self.session_token()) or ADMIN_USERNAME,
                )
                self.send_json(HTTPStatus.OK, {"ok": True, "poll": poll})
            except ValueError as error:
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            return
        if path == "/api/polls/vote":
            try:
                poll = vote_poll(self.read_json_body(), self.visitor_id())
                self.send_json(HTTPStatus.OK, {"ok": True, "poll": poll})
            except ValueError as error:
                status = HTTPStatus.CONFLICT if "já votou" in str(error) else HTTPStatus.BAD_REQUEST
                self.send_json(status, {"error": str(error)})
            except LookupError as error:
                self.send_json(HTTPStatus.NOT_FOUND, {"error": str(error)})
            return
        if path == "/api/reactions":
            try:
                payload = save_reaction(self.read_json_body(), self.visitor_id())
                self.send_json(HTTPStatus.OK, payload)
            except ValueError as error:
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            except LookupError as error:
                self.send_json(HTTPStatus.NOT_FOUND, {"error": str(error)})
            return
        if path == "/api/community":
            try:
                post = save_community_post(self.read_json_body(), self.visitor_id())
                self.send_json(HTTPStatus.CREATED, {"ok": True, "post": post})
            except ValueError as error:
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            return
        if path == "/api/community/report":
            try:
                body = self.read_json_body()
                result = report_community_post(body.get("postId"), self.visitor_id())
                self.send_json(HTTPStatus.OK, result)
            except ValueError as error:
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            except LookupError as error:
                self.send_json(HTTPStatus.NOT_FOUND, {"error": str(error)})
            return
        if path == "/api/community/moderate":
            if not self.require_authentication():
                return
            try:
                body = self.read_json_body()
                post_id = clean_short_text(body.get("postId"), 120)
                status = str(body.get("status") or "")
                if not moderate_community_post(
                    post_id,
                    status,
                    session_username(self.session_token()) or ADMIN_USERNAME,
                ):
                    raise LookupError("Mensagem não encontrada.")
                self.send_json(HTTPStatus.OK, {"ok": True})
            except ValueError as error:
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            except LookupError as error:
                self.send_json(HTTPStatus.NOT_FOUND, {"error": str(error)})
            return
        if path == "/api/awards":
            if not self.require_authentication():
                return
            try:
                award = save_award(
                    self.read_json_body(),
                    session_username(self.session_token()) or ADMIN_USERNAME,
                )
                self.send_json(HTTPStatus.OK, {"ok": True, "award": award})
            except ValueError as error:
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            except LookupError as error:
                self.send_json(HTTPStatus.NOT_FOUND, {"error": str(error)})
            return
        if path == "/api/news":
            if not self.require_authentication():
                return
            try:
                article = save_news_article(
                    self.read_json_body(),
                    session_username(self.session_token()) or ADMIN_USERNAME,
                )
                self.send_json(HTTPStatus.OK, {"ok": True, "article": article})
            except ValueError as error:
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            except Exception as error:  # pragma: no cover
                self.send_json(
                    HTTPStatus.INTERNAL_SERVER_ERROR,
                    {"error": "Não foi possível salvar a notícia.", "detail": str(error)},
                )
            return
        if path == "/api/news/comments":
            try:
                body = self.read_json_body()
                payload = save_news_comment(
                    body.get("articleId"),
                    self.headers.get(NEWS_VISITOR_HEADER),
                    body,
                )
                self.send_json(HTTPStatus.CREATED, payload)
            except ValueError as error:
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            except LookupError as error:
                self.send_json(HTTPStatus.NOT_FOUND, {"error": str(error)})
            except Exception as error:  # pragma: no cover
                self.send_json(
                    HTTPStatus.INTERNAL_SERVER_ERROR,
                    {"error": "Não foi possível enviar o comentário.", "detail": str(error)},
                )
            return
        if path == "/api/news/ratings":
            try:
                body = self.read_json_body()
                payload = save_news_rating(
                    body.get("articleId"),
                    self.headers.get(NEWS_VISITOR_HEADER),
                    body.get("score"),
                )
                self.send_json(HTTPStatus.OK, payload)
            except ValueError as error:
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            except LookupError as error:
                self.send_json(HTTPStatus.NOT_FOUND, {"error": str(error)})
            except Exception as error:  # pragma: no cover
                self.send_json(
                    HTTPStatus.INTERNAL_SERVER_ERROR,
                    {"error": "Não foi possível salvar a avaliação.", "detail": str(error)},
                )
            return
        if path == "/api/news/comments/report":
            try:
                body = self.read_json_body()
                payload = report_news_comment(
                    body.get("commentId"),
                    self.headers.get(NEWS_VISITOR_HEADER),
                )
                self.send_json(HTTPStatus.OK, payload)
            except ValueError as error:
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            except LookupError as error:
                self.send_json(HTTPStatus.NOT_FOUND, {"error": str(error)})
            except Exception as error:  # pragma: no cover
                self.send_json(
                    HTTPStatus.INTERNAL_SERVER_ERROR,
                    {"error": "Não foi possível enviar a denúncia.", "detail": str(error)},
                )
            return
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

    def do_DELETE(self) -> None:  # noqa: N802
        path = self.request_path()
        if path not in {"/api/news", "/api/news/comments", "/api/polls", "/api/community", "/api/awards"}:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        if not self.require_authentication():
            return
        item_id = parse_qs(urlparse(self.path).query).get("id", [""])[0]
        if not item_id:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "Item não informado."})
            return
        username = session_username(self.session_token()) or ADMIN_USERNAME
        if path == "/api/polls":
            if not delete_poll(item_id, username):
                self.send_json(HTTPStatus.NOT_FOUND, {"error": "Enquete não encontrada."})
                return
        elif path == "/api/community":
            if not moderate_community_post(item_id, "deleted", username):
                self.send_json(HTTPStatus.NOT_FOUND, {"error": "Mensagem não encontrada."})
                return
        elif path == "/api/awards":
            if not delete_award(item_id, username):
                self.send_json(HTTPStatus.NOT_FOUND, {"error": "Premiação não encontrada."})
                return
        elif path == "/api/news/comments":
            if not delete_news_comment(item_id):
                self.send_json(HTTPStatus.NOT_FOUND, {"error": "Comentário não encontrado."})
                return
        elif not delete_news_article(item_id, username):
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "Notícia não encontrada."})
            return
        self.send_json(HTTPStatus.OK, {"ok": True})

    def send_news_image(self, article_id: str) -> None:
        if not article_id:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        with connect_database() as connection:
            row = connection.execute(
                "SELECT image_data, image_type, status, published_at FROM news_articles WHERE id = ?",
                (article_id,),
            ).fetchone()
        if row is None or row["image_data"] is None:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        if not self.is_authenticated() and (
            row["status"] != "published" or str(row["published_at"]) > utc_now()
        ):
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        content = bytes(row["image_data"])
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", row["image_type"] or "application/octet-stream")
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "public, max-age=3600")
        self.end_headers()
        self.wfile.write(content)

    def send_profile_image(self, player_id: str) -> None:
        if not player_id:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        state = read_state()["state"] or {}
        if player_id not in official_players(state):
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        with connect_database() as connection:
            row = connection.execute(
                "SELECT image_data, image_type, updated_at FROM player_profiles WHERE player_id = ?",
                (player_id,),
            ).fetchone()
        if row is None or row["image_data"] is None:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        content = bytes(row["image_data"])
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", row["image_type"] or "application/octet-stream")
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "public, max-age=3600")
        self.send_header("Last-Modified", format_datetime(
            datetime.fromisoformat(str(row["updated_at"]).replace("Z", "+00:00")).astimezone(timezone.utc),
            usegmt=True,
        ))
        self.end_headers()
        self.wfile.write(content)

    def visitor_id(self, *, required: bool = True) -> str | None:
        value = self.headers.get(VISITOR_HEADER) or self.headers.get(NEWS_VISITOR_HEADER)
        if not value and not required:
            return None
        generic_visitor(value)
        origin = self.client_origin_key()
        digest = hashlib.sha256(f"sinuca-social-v1:{origin}".encode("utf-8")).hexdigest()
        return f"origin-{digest}"

    def client_origin_key(self) -> str:
        candidate = str(self.client_address[0] or "").strip()
        if TRUST_PROXY_HEADERS:
            forwarded = self.headers.get("X-Forwarded-For", "")
            forwarded_candidates = [item.strip() for item in forwarded.split(",") if item.strip()]
            if forwarded_candidates:
                candidate = forwarded_candidates[-1]
        try:
            return str(ipaddress.ip_address(candidate))
        except ValueError:
            return str(self.client_address[0] or "unknown")

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
        client_key = self.client_origin_key()
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
        token, expires_at = create_session(username)
        max_age = int(SESSION_DURATION.total_seconds())
        secure = "; Secure" if os.environ.get("VERCEL") == "1" else ""
        cookie = (
            f"{SESSION_COOKIE}={token}; Path=/; HttpOnly; SameSite=Strict; "
            f"Max-Age={max_age}; Expires={format_datetime(expires_at, usegmt=True)}{secure}"
        )
        self.send_json(
            HTTPStatus.OK,
            {"ok": True, "authenticated": True, "username": username},
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
        self.send_header(
            "Cache-Control",
            "public, max-age=86400" if relative.parts[0] == "assets" else "no-cache",
        )
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
        self.send_header("Cache-Control", "no-store")
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

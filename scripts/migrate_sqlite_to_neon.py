"""Copia com validação o campeonato e o bolão do SQLite para o Neon."""

from __future__ import annotations

from pathlib import Path
import argparse
import json
import os
import sqlite3
import sys


ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from scripts.migration_common import (  # noqa: E402
    assert_manifests_equal,
    build_manifest,
    normalize_league_results,
)


def rows_as_dicts(connection: sqlite3.Connection, query: str) -> list[dict[str, object]]:
    connection.row_factory = sqlite3.Row
    return [dict(row) for row in connection.execute(query).fetchall()]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Confirma a gravação no Neon.")
    parser.add_argument(
        "--sqlite",
        default=str(ROOT / "data" / "campeonato.db"),
        help="Caminho do banco SQLite de origem.",
    )
    args = parser.parse_args()

    source_path = Path(args.sqlite).resolve()
    if not source_path.is_file():
        raise SystemExit(f"Banco SQLite não encontrado: {source_path}")

    with sqlite3.connect(source_path) as source:
        source.execute("BEGIN")
        app_state = rows_as_dicts(source, "SELECT * FROM app_state")
        bettors = rows_as_dicts(source, "SELECT * FROM bettors ORDER BY id")
        bets = rows_as_dicts(source, "SELECT * FROM bets ORDER BY id")

    if len(app_state) != 1 or int(app_state[0].get("id") or 0) != 1:
        raise SystemExit("A origem precisa conter exatamente o app_state id=1.")
    try:
        source_state = json.loads(str(app_state[0]["data"]))
        normalized_state, changed_results = normalize_league_results(source_state)
    except (json.JSONDecodeError, TypeError, ValueError) as error:
        raise SystemExit(f"Estado SQLite inválido: {error}") from error
    app_state[0]["data"] = json.dumps(
        normalized_state, ensure_ascii=False, separators=(",", ":")
    )
    source_manifest = build_manifest(normalized_state, bettors, bets)

    print(
        f"Origem pronta: {len(app_state)} estado, {len(bettors)} perfis, "
        f"{len(bets)} apostas; {len(changed_results)} resultado(s) a normalizar."
    )
    print(json.dumps(source_manifest, ensure_ascii=False, indent=2))
    if not args.apply:
        print("Simulação concluída. Execute novamente com --apply para gravar no Neon.")
        return

    database_url = os.environ.get("DATABASE_URL", "").strip()
    if not database_url.startswith(("postgres://", "postgresql://")):
        raise SystemExit("Defina DATABASE_URL com a connection string do Neon.")

    try:
        import psycopg
    except ImportError as error:
        raise SystemExit("Instale as dependências com: python -m pip install -r requirements.txt") from error

    os.environ["DATABASE_URL"] = database_url
    from server import initialize_database

    initialize_database()

    with psycopg.connect(database_url) as target:
        for row in app_state:
            target.execute(
                """
                INSERT INTO app_state (id, data, revision, updated_at)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET
                    data = EXCLUDED.data,
                    revision = EXCLUDED.revision,
                    updated_at = EXCLUDED.updated_at
                """,
                (row["id"], row["data"], row["revision"], row["updated_at"]),
            )

        for row in bettors:
            target.execute(
                """
                INSERT INTO bettors
                    (id, name, name_key, pin_salt, pin_hash, token_hash,
                     initial_balance, active, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET
                    name = EXCLUDED.name,
                    name_key = EXCLUDED.name_key,
                    pin_salt = EXCLUDED.pin_salt,
                    pin_hash = EXCLUDED.pin_hash,
                    token_hash = EXCLUDED.token_hash,
                    initial_balance = EXCLUDED.initial_balance,
                    active = EXCLUDED.active,
                    updated_at = EXCLUDED.updated_at
                """,
                tuple(row[key] for key in (
                    "id", "name", "name_key", "pin_salt", "pin_hash", "token_hash",
                    "initial_balance", "active", "created_at", "updated_at",
                )),
            )

        for row in bets:
            target.execute(
                """
                INSERT INTO bets
                    (id, bettor_id, match_kind, match_id, player_a_id, player_b_id,
                     predicted_winner_id, stake, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (bettor_id, match_kind, match_id) DO UPDATE SET
                    id = EXCLUDED.id,
                    player_a_id = EXCLUDED.player_a_id,
                    player_b_id = EXCLUDED.player_b_id,
                    predicted_winner_id = EXCLUDED.predicted_winner_id,
                    stake = EXCLUDED.stake,
                    updated_at = EXCLUDED.updated_at
                """,
                tuple(row[key] for key in (
                    "id", "bettor_id", "match_kind", "match_id", "player_a_id", "player_b_id",
                    "predicted_winner_id", "stake", "created_at", "updated_at",
                )),
            )

        target.execute(
            """
            SELECT setval(
                pg_get_serial_sequence('bets', 'id'),
                COALESCE(MAX(id), 1),
                MAX(id) IS NOT NULL
            )
            FROM bets
            """
        )
        target_state_row = target.execute(
            "SELECT data FROM app_state WHERE id = 1"
        ).fetchone()
        if target_state_row is None:
            raise RuntimeError("Validação pós-escrita: app_state id=1 ausente no Neon.")
        target_state = json.loads(target_state_row[0])
        if normalized_state != target_state:
            raise RuntimeError(
                "Validação pós-escrita: o estado completo divergiu; winnerId/balls/IDs não conferem."
            )
        target_bettors = [
            {"id": row[0]}
            for row in target.execute("SELECT id FROM bettors ORDER BY id").fetchall()
        ]
        target_bets = [
            {
                "id": row[0],
                "bettor_id": row[1],
                "match_kind": row[2],
                "match_id": row[3],
            }
            for row in target.execute(
                "SELECT id, bettor_id, match_kind, match_id FROM bets ORDER BY id"
            ).fetchall()
        ]
        target_manifest = build_manifest(target_state, target_bettors, target_bets)
        assert_manifests_equal(source_manifest, target_manifest)
        target.commit()

    print("Migração validada e concluída. O SQLite de origem não foi alterado.")


if __name__ == "__main__":
    main()

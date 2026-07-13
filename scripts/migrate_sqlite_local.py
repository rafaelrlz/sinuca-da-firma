"""Normaliza o SQLite local com backup, relatório e validação, sem recriar tabelas."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
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


def snapshot(connection: sqlite3.Connection) -> tuple[dict[str, object], dict[str, object]]:
    connection.row_factory = sqlite3.Row
    row = connection.execute(
        "SELECT id, data, revision, updated_at FROM app_state WHERE id = 1"
    ).fetchone()
    if row is None:
        raise RuntimeError("app_state id=1 não encontrado.")
    state = json.loads(row["data"])
    bettors = rows_as_dicts(connection, "SELECT * FROM bettors ORDER BY id")
    bets = rows_as_dicts(connection, "SELECT * FROM bets ORDER BY id")
    return dict(row), build_manifest(state, bettors, bets)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Aplica a normalização no SQLite.")
    parser.add_argument("--sqlite", default=str(ROOT / "data" / "campeonato.db"))
    parser.add_argument("--backup-dir", default=str(ROOT / "data" / "migration-backups"))
    parser.add_argument("--report", help="Grava também o relatório JSON neste caminho.")
    args = parser.parse_args()

    database_path = Path(args.sqlite).resolve()
    if not database_path.is_file():
        raise SystemExit(f"Banco SQLite não encontrado: {database_path}")

    with sqlite3.connect(database_path) as connection:
        source_row, before_manifest = snapshot(connection)
        source_state = json.loads(source_row["data"])
        normalized_state, changed_results = normalize_league_results(source_state)
        bettors = rows_as_dicts(connection, "SELECT * FROM bettors ORDER BY id")
        bets = rows_as_dicts(connection, "SELECT * FROM bets ORDER BY id")
        expected_manifest = build_manifest(normalized_state, bettors, bets)

    report: dict[str, object] = {
        "mode": "apply" if args.apply else "dry-run",
        "database": str(database_path),
        "changedResultIds": changed_results,
        "before": before_manifest,
        "expected": expected_manifest,
        "backup": None,
        "applied": False,
    }

    if args.apply:
        backup_dir = Path(args.backup_dir).resolve()
        backup_dir.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        backup_path = backup_dir / f"{database_path.stem}-before-duel-normalization-{stamp}.db"
        with sqlite3.connect(database_path) as source, sqlite3.connect(backup_path) as backup:
            source.backup(backup)
        with sqlite3.connect(backup_path) as backup:
            if backup.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                raise RuntimeError(f"Backup SQLite inválido; operação abortada: {backup_path}")
        report["backup"] = str(backup_path)

        if normalized_state != source_state:
            serialized = json.dumps(normalized_state, ensure_ascii=False, separators=(",", ":"))
            updated_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
            with sqlite3.connect(database_path) as connection:
                connection.row_factory = sqlite3.Row
                connection.execute("PRAGMA foreign_keys = ON")
                connection.execute("BEGIN IMMEDIATE")
                current = connection.execute(
                    "SELECT data, revision FROM app_state WHERE id = 1"
                ).fetchone()
                if current is None or current["data"] != source_row["data"]:
                    raise RuntimeError("O estado mudou durante a migração; operação abortada.")
                connection.execute(
                    "UPDATE app_state SET data = ?, revision = ?, updated_at = ? WHERE id = 1",
                    (serialized, int(current["revision"]) + 1, updated_at),
                )
                written_state = json.loads(connection.execute(
                    "SELECT data FROM app_state WHERE id = 1"
                ).fetchone()[0])
                if written_state != normalized_state:
                    raise RuntimeError(
                        "Validação pós-escrita falhou; winnerId/balls/IDs não conferem."
                    )
                _, actual_manifest = snapshot(connection)
                assert_manifests_equal(expected_manifest, actual_manifest)
                connection.commit()
            report["applied"] = True

    output = json.dumps(report, ensure_ascii=False, indent=2)
    print(output)
    if args.report:
        report_path = Path(args.report).resolve()
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(output + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()

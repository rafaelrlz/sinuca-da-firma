"""Valida o bônus único dos perfis do bolão sem acessar o banco real."""

from __future__ import annotations

import sqlite3
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from server import (  # noqa: E402
    BET_EXISTING_BALANCE_BONUS,
    BET_INITIAL_BALANCE,
    migrate_bettor_initial_balance,
)


def main() -> None:
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    connection.execute(
        """
        CREATE TABLE bettors (
            id TEXT PRIMARY KEY,
            initial_balance INTEGER NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    connection.executemany(
        "INSERT INTO bettors (id, initial_balance, updated_at) VALUES (?, 1000, 'antes')",
        [("bettor-1",), ("bettor-2",)],
    )

    assert BET_INITIAL_BALANCE == 10_000
    assert BET_EXISTING_BALANCE_BONUS == 9_000
    assert migrate_bettor_initial_balance(connection) is True
    assert [row["initial_balance"] for row in connection.execute("SELECT initial_balance FROM bettors ORDER BY id")] == [10_000, 10_000]

    assert migrate_bettor_initial_balance(connection) is False
    assert [row["initial_balance"] for row in connection.execute("SELECT initial_balance FROM bettors ORDER BY id")] == [10_000, 10_000]

    connection.execute(
        "INSERT INTO bettors (id, initial_balance, updated_at) VALUES (?, ?, 'depois')",
        ("bettor-3", BET_INITIAL_BALANCE),
    )
    assert connection.execute("SELECT initial_balance FROM bettors WHERE id = 'bettor-3'").fetchone()[0] == 10_000
    connection.close()
    print("OK: perfis antigos recebem +9.000 uma vez; novos perfis começam com 10.000.")


if __name__ == "__main__":
    main()

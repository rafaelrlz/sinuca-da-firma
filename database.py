"""Camada mínima de banco compatível com SQLite local e PostgreSQL/Neon."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Iterable
import os
import sqlite3


PROJECT_DIR = Path(__file__).resolve().parent
DATABASE_PATH = Path(
    os.environ.get("SINUCA_DATABASE_PATH") or PROJECT_DIR / "data" / "campeonato.db"
).expanduser().resolve()
DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
IS_POSTGRES = DATABASE_URL.startswith(("postgres://", "postgresql://"))
IS_VERCEL = bool(os.environ.get("VERCEL"))


class DatabaseConnection:
    """Normaliza placeholders e ciclo de vida das duas conexões."""

    def __init__(self) -> None:
        if IS_VERCEL and not IS_POSTGRES:
            raise RuntimeError(
                "DATABASE_URL do Neon é obrigatória no deploy da Vercel."
            )
        if IS_POSTGRES:
            try:
                import psycopg
                from psycopg.rows import dict_row
            except ImportError as error:  # pragma: no cover - depende do deploy
                raise RuntimeError(
                    "DATABASE_URL aponta para PostgreSQL, mas psycopg não está instalado."
                ) from error
            self.raw = psycopg.connect(DATABASE_URL, row_factory=dict_row)
        else:
            DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
            self.raw = sqlite3.connect(DATABASE_PATH, timeout=10)
            self.raw.row_factory = sqlite3.Row
            self.raw.execute("PRAGMA foreign_keys=ON")
            self.raw.execute("PRAGMA journal_mode=WAL")
            self.raw.execute("PRAGMA synchronous=FULL")
            self.raw.execute("PRAGMA busy_timeout=10000")

    @staticmethod
    def _sql(statement: str) -> str:
        if not IS_POSTGRES:
            return statement
        return statement.replace("?", "%s")

    def execute(self, statement: str, parameters: Iterable[Any] | None = None):
        values = tuple(parameters or ())
        return self.raw.execute(self._sql(statement), values)

    def commit(self) -> None:
        self.raw.commit()

    def rollback(self) -> None:
        self.raw.rollback()

    def close(self) -> None:
        self.raw.close()

    def __enter__(self) -> "DatabaseConnection":
        return self

    def __exit__(self, exc_type, exc_value, traceback) -> None:
        try:
            if exc_type is None:
                self.raw.commit()
            else:
                self.raw.rollback()
        finally:
            self.raw.close()


def connect_database() -> DatabaseConnection:
    return DatabaseConnection()


def database_label() -> str:
    return "postgresql-neon" if IS_POSTGRES else DATABASE_PATH.name


def is_integrity_error(error: BaseException) -> bool:
    if isinstance(error, sqlite3.IntegrityError):
        return True
    if IS_POSTGRES:
        try:
            import psycopg
        except ImportError:  # pragma: no cover
            return False
        return isinstance(error, psycopg.IntegrityError)
    return False

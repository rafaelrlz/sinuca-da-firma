"""Entrada serverless da API na Vercel."""

from __future__ import annotations

from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from server import TournamentHandler, initialize_database  # noqa: E402


initialize_database()


class handler(TournamentHandler):
    """Mantém o mesmo contrato HTTP do servidor local."""


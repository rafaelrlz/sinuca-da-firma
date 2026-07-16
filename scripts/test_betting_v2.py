"""Testes de migração, domínio e APIs do bolão 2.0 em banco temporário."""

from __future__ import annotations

from http.cookiejar import CookieJar
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import HTTPCookieProcessor, Request, build_opener
import json
import inspect
import os
import shutil
import sqlite3
import sys
import tempfile
import threading


ROOT = Path(__file__).resolve().parents[1]
TEMP_DIR = Path(tempfile.mkdtemp(prefix="sinuca-betting-v2-"))
os.environ["SINUCA_DATABASE_PATH"] = str(TEMP_DIR / "test.db")
os.environ["SINUCA_DATA_DIR"] = str(TEMP_DIR)
os.environ["SINUCA_ADMIN_USER"] = "admin-test"
os.environ["SINUCA_ADMIN_PASSWORD"] = "password-test"
os.environ["NO_BROWSER"] = "1"
sys.path.insert(0, str(ROOT))

import server  # noqa: E402


class Client:
    def __init__(self, base_url: str) -> None:
        self.base_url = base_url
        self.opener = build_opener(HTTPCookieProcessor(CookieJar()))
        self.token = ""

    def request(self, method: str, path: str, body: dict[str, object] | None = None):
        headers = {}
        data = None
        if body is not None:
            data = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"
        if self.token:
            headers[server.BET_TOKEN_HEADER] = self.token
        request = Request(self.base_url + path, data=data, headers=headers, method=method)
        try:
            response = self.opener.open(request, timeout=5)
            status, raw = response.status, response.read()
        except HTTPError as error:
            status, raw = error.code, error.read()
        return status, json.loads(raw) if raw else {}


def legacy_database() -> None:
    connection = sqlite3.connect(TEMP_DIR / "test.db")
    connection.executescript(
        """
        CREATE TABLE bettors (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE,
            pin_salt TEXT NOT NULL, pin_hash TEXT NOT NULL, token_hash TEXT,
            initial_balance INTEGER NOT NULL DEFAULT 1000, active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE bets (
            id INTEGER PRIMARY KEY AUTOINCREMENT, bettor_id TEXT NOT NULL,
            match_kind TEXT NOT NULL, match_id TEXT NOT NULL, player_a_id TEXT NOT NULL,
            player_b_id TEXT NOT NULL, predicted_winner_id TEXT NOT NULL, stake INTEGER NOT NULL,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
            UNIQUE (bettor_id, match_kind, match_id)
        );
        CREATE TABLE app_state (
            id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL,
            revision INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL
        );
        """
    )
    salt = "11" * 16
    pin_hash = server.hash_bettor_pin("1234", salt)
    connection.execute(
        "INSERT INTO bettors VALUES ('b1','Ana','ana',?,?,NULL,1000,1,?,?)",
        (salt, pin_hash, server.utc_now(), server.utc_now()),
    )
    connection.execute(
        "INSERT INTO bets (bettor_id,match_kind,match_id,player_a_id,player_b_id,predicted_winner_id,stake,created_at,updated_at) VALUES ('b1','league','m1','p1','p2','p1',100,?,?)",
        (server.utc_now(), server.utc_now()),
    )
    connection.execute(
        "INSERT INTO app_state (id, data, revision, updated_at) VALUES (1, ?, 1, ?)",
        (json.dumps(state("p1")), server.utc_now()),
    )
    connection.commit()
    connection.close()


def state(winner: str | None = None, in_progress: bool = False) -> dict[str, object]:
    result = {}
    if winner:
        result["m1"] = {
            "playerAId": "p1", "playerBId": "p2", "winnerId": winner,
            "ballsA": 8 if winner == "p1" else 4, "ballsB": 4 if winner == "p1" else 8,
            "playedAt": server.utc_now(),
        }
    return {
        "version": server.STATE_VERSION,
        "settings": {"title": "Teste", "league": {"winPoints": 3, "lossPoints": 0}},
        "players": [{"id": "p1", "name": "A"}, {"id": "p2", "name": "B"}],
        "league": {
            "rounds": [{"number": 1, "matches": [{"id": "m1", "playerAId": "p1", "playerBId": "p2"}]}],
            "results": result, "inProgress": {"m1": True} if in_progress else {},
            "programming": {"nextMatchId": "m1", "featuredMatchIds": [], "matches": {}},
        },
        "availability": {}, "tournament": None, "activity": [],
    }


def run() -> None:
    httpd = None
    try:
        legacy_database()
        server.initialize_database()
        server.initialize_database()
        connection = sqlite3.connect(TEMP_DIR / "test.db")
        connection.row_factory = sqlite3.Row
        assert connection.execute(
            "SELECT COUNT(*) FROM schema_migrations WHERE migration_id = 'betting_v2'"
        ).fetchone()[0] == 1
        migrated = connection.execute("SELECT * FROM bets").fetchone()
        assert migrated["season_id"] == "legacy-current"
        assert migrated["accepted_odds"] == 2
        assert migrated["potential_return"] == 200
        assert json.loads(migrated["rules_snapshot_json"])["lossPolicy"] == "refund"
        assert connection.execute("SELECT COUNT(*) FROM bet_events").fetchone()[0] >= 2
        assert migrated["settlement_status"] == "won" and migrated["settlement_delta"] == 100
        assert connection.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        connection.close()

        saved = server.save_state(state(), username="migration-test")
        assert saved["ok"]
        httpd = server.ThreadingHTTPServer(("127.0.0.1", 0), server.TournamentHandler)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        base = f"http://127.0.0.1:{httpd.server_port}"
        admin, bettor = Client(base), Client(base)
        assert admin.request("POST", "/api/login", {"username": "admin-test", "password": "password-test"})[0] == 200
        status, login = bettor.request("POST", "/api/bettors/login", {"name": "Ana", "pin": "1234"})
        assert status == 200
        bettor.token = login["token"]

        status, preview = bettor.request("GET", "/api/bets/preview?matchId=m1&winnerId=p2&stake=90")
        assert status == 200 and preview["potentialReturn"] == 180 and preview["lossPolicy"] == "refund"
        status, wager = bettor.request("POST", "/api/bets/wager", {
            "matchKind": "league", "matchId": "m1", "predictedWinnerId": "p2", "stake": 90,
        })
        assert status == 200 and wager["myBets"][0]["acceptedOdds"] == 2

        status, _ = admin.request("POST", "/api/admin/bets/lock-match", {"matchId": "m1"})
        assert status == 200
        assert bettor.request("POST", "/api/bets/wager", {
            "matchKind": "league", "matchId": "m1", "predictedWinnerId": "p1", "stake": 80,
        })[0] == 409
        assert admin.request("POST", "/api/admin/bets/reopen-match", {"matchId": "m1"})[0] == 200

        current = admin.request("GET", "/api/state")[1]
        assert admin.request("PUT", "/api/state", {
            "state": state("p2"), "expectedRevision": current["revision"],
        })[0] == 200
        settled = bettor.request("GET", "/api/bets/me")[1]
        assert settled["myBets"][0]["status"] == "won"
        first_balance = settled["profile"]["settledBalance"]
        assert admin.request("POST", "/api/admin/bets/reprocess", {})[1]["reprocessed"] == 0
        assert bettor.request("GET", "/api/bets/me")[1]["profile"]["settledBalance"] == first_balance

        current = admin.request("GET", "/api/state")[1]
        assert admin.request("PUT", "/api/state", {
            "state": state("p1"), "expectedRevision": current["revision"],
        })[0] == 200
        corrected = bettor.request("GET", "/api/bets/me")[1]
        assert corrected["myBets"][0]["status"] == "lost"
        assert corrected["myBets"][0]["settlementDelta"] == 0
        history = bettor.request("GET", "/api/bets/history")[1]
        assert any(event["type"] == "resettled" for event in history["bets"][0]["events"])

        status, profile = bettor.request("PUT", "/api/bettors/profile", {
            "publicProfileEnabled": True, "bio": "Perfil público de teste.", "favoritePlayerId": "p1",
        })
        assert status == 200 and profile["profile"]["publicProfileEnabled"]

        status, archived = admin.request("POST", "/api/admin/bets/seasons/archive", {})
        assert status == 200 and archived["season"]["snapshot"]["leaderboard"]
        old_season_id = archived["season"]["id"]
        assert bettor.request("GET", "/api/bets")[0] == 200
        assert bettor.request("GET", "/api/bets/rules")[1]["rules"]["bettingOpen"] is False
        assert admin.request("GET", "/api/admin/bets/settings")[1]["season"]["status"] == "archived"
        status, created = admin.request("POST", "/api/admin/bets/seasons", {
            "title": "Temporada parcial", "status": "active",
            "rules": {
                **server.DEFAULT_BETTING_RULES,
                "initialBalance": 5000, "lossPolicy": "partial", "lossRefundPercent": 50,
            },
        })
        assert status == 201
        new_season_id = created["season"]["id"]
        current = admin.request("GET", "/api/state")[1]
        assert admin.request("PUT", "/api/state", {
            "state": state(), "expectedRevision": current["revision"],
        })[0] == 200
        status, new_wager = bettor.request("POST", "/api/bets/wager", {
            "matchKind": "league", "matchId": "m1", "predictedWinnerId": "p2", "stake": 101,
        })
        assert status == 200 and new_wager["profile"]["initialBalance"] == 5000
        assert bettor.request("POST", "/api/bets/cancel", {
            "matchKind": "league", "matchId": "m1",
        })[0] == 200
        connection = sqlite3.connect(TEMP_DIR / "test.db")
        connection.row_factory = sqlite3.Row
        rows = connection.execute(
            "SELECT * FROM bets WHERE bettor_id = 'b1' AND match_id = 'm1' ORDER BY id"
        ).fetchall()
        assert len(rows) == 2 and {row["season_id"] for row in rows} == {old_season_id, new_season_id}
        assert rows[-1]["settlement_status"] == "void"
        assert connection.execute(
            "SELECT COUNT(*) FROM bet_events WHERE bet_id = ? AND event_type = 'cancelled'",
            (rows[-1]["id"],),
        ).fetchone()[0] == 1
        connection.execute(
            "UPDATE bets SET settlement_status = 'pending' WHERE season_id = ?",
            (old_season_id,),
        )
        crowd_rules = server.normalize_betting_rules({
            **server.DEFAULT_BETTING_RULES, "oddsMode": "crowd", "minimumCrowdStake": 1,
        })
        assert server.accepted_odds(
            connection, "league", "m1", "p2", crowd_rules, new_season_id
        ) == 2
        connection.execute(
            "UPDATE bets SET settlement_status = 'lost', settlement_delta = 0 WHERE season_id = ?",
            (old_season_id,),
        )
        connection.commit()
        connection.close()
        match_payload = bettor.request("GET", "/api/bets/matches")[1]
        assert match_payload["season"]["id"] == new_season_id
        assert match_payload["matches"][0]["myBet"]["status"] == "void"

        assert bettor.request("POST", "/api/bets/wager", {
            "matchKind": "league", "matchId": "m1", "predictedWinnerId": "p2", "stake": 101,
        })[0] == 200
        current = admin.request("GET", "/api/state")[1]
        close_payload = {"state": state(in_progress=True), "expectedRevision": current["revision"]}
        competing = Client(base)
        competing.token = bettor.token
        barrier = threading.Barrier(2)
        results: list[tuple[str, int]] = []

        def close_match() -> None:
            barrier.wait()
            results.append(("close", admin.request("PUT", "/api/state", close_payload)[0]))

        def race_wager() -> None:
            barrier.wait()
            results.append(("wager", competing.request("POST", "/api/bets/wager", {
                "matchKind": "league", "matchId": "m1", "predictedWinnerId": "p1", "stake": 99,
            })[0]))

        threads = [threading.Thread(target=close_match), threading.Thread(target=race_wager)]
        for item in threads:
            item.start()
        for item in threads:
            item.join()
        assert dict(results)["close"] == 200 and dict(results)["wager"] in {200, 409}
        connection = sqlite3.connect(TEMP_DIR / "test.db")
        connection.row_factory = sqlite3.Row
        active_bet = connection.execute(
            "SELECT * FROM bets WHERE bettor_id = 'b1' AND season_id = ?", (new_season_id,)
        ).fetchone()
        assert active_bet["locked_at"]
        assert connection.execute(
            "SELECT COUNT(*) FROM bet_events WHERE bet_id = ? AND event_type = 'locked'",
            (active_bet["id"],),
        ).fetchone()[0] == 1
        connection.close()

        current = admin.request("GET", "/api/state")[1]
        assert admin.request("PUT", "/api/state", {
            "state": state("p1"), "expectedRevision": current["revision"],
        })[0] == 200
        partial = bettor.request("GET", "/api/bets/me")[1]
        assert partial["profile"]["initialBalance"] == 5000
        partial_row = {
            "stake": 101, "void_reason": None, "player_a_id": "p1", "player_b_id": "p2",
            "predicted_winner_id": "p2", "accepted_odds": 2,
            "rules_snapshot_json": json.dumps({
                **server.DEFAULT_BETTING_RULES,
                "lossPolicy": "partial", "lossRefundPercent": 50,
            }),
        }
        assert server.settlement_for(partial_row, {
            "playerAId": "p1", "playerBId": "p2", "winnerId": "p1",
        })[1] == -51
        assert admin.request("GET", f"/api/bets/leaderboard?scope=round&round=1&seasonId={new_season_id}")[0] == 200
        assert admin.request("GET", f"/api/bets/leaderboard?scope=streak&seasonId={new_season_id}")[0] == 200
        old_board = admin.request("GET", f"/api/bets/leaderboard?scope=season&seasonId={old_season_id}")[1]
        assert old_board["seasonId"] == old_season_id

        status, live = admin.request("POST", "/api/admin/live/events", {
            "matchId": "m1", "eventType": "started", "payload": {"text": "Começou"},
        })
        assert status == 201 and live["event"]["eventType"] == "started"
        live_payload = admin.request("GET", "/api/live?matchId=m1")[1]
        assert live_payload["events"] and live_payload["season"]["id"] == new_season_id
        assert sum(item["participants"] for item in (live_payload["predictionDistribution"] or [])) == 1
        place_source = inspect.getsource(server.place_wager)
        cancel_source = inspect.getsource(server.cancel_wager)
        for source in (place_source, cancel_source):
            assert 'state_query += " FOR UPDATE"' in source
            assert 'season_query += " FOR UPDATE"' in source
            assert 'bettor_query += " FOR UPDATE"' in source
            assert source.index('state_row = connection.execute') < source.index('season = connection.execute')
            assert source.index('season = connection.execute') < source.index('locked_bettor = connection.execute')
        for _ in range(5):
            assert Client(base).request("POST", "/api/bettors/register", {"name": "Ana", "pin": "1234"})[0] in {409, 429}
        assert Client(base).request("POST", "/api/bettors/register", {"name": "Ana", "pin": "1234"})[0] == 429
        print("OK: betting_v2 migração, snapshots, fechamento, apuração e APIs.")
    finally:
        if httpd:
            httpd.shutdown()
            httpd.server_close()
        shutil.rmtree(TEMP_DIR, ignore_errors=True)


if __name__ == "__main__":
    run()

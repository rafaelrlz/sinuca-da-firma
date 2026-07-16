"""Teste de integração das APIs da expansão usando somente banco temporário."""

from __future__ import annotations

from http.cookiejar import CookieJar
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import HTTPCookieProcessor, Request, build_opener
import base64
import json
import os
import shutil
import sqlite3
import sys
import tempfile
import threading


ROOT = Path(__file__).resolve().parent.parent
TEMP_DIR = Path(tempfile.mkdtemp(prefix="sinuca-expansion-api-"))
os.environ["SINUCA_DATA_DIR"] = str(TEMP_DIR)
os.environ["SINUCA_DATABASE_PATH"] = str(TEMP_DIR / "test.db")
os.environ["SINUCA_ADMIN_USER"] = "admin-one"
os.environ["SINUCA_ADMIN_PASSWORD"] = "password-one"
os.environ["SINUCA_ADMIN_USER_2"] = "admin-two"
os.environ["SINUCA_ADMIN_PASSWORD_2"] = "password-two"
os.environ["NO_BROWSER"] = "1"
sys.path.insert(0, str(ROOT))

import server  # noqa: E402


def assert_true(condition: object, message: str) -> None:
    if not condition:
        raise AssertionError(message)


class ApiClient:
    def __init__(self, base_url: str) -> None:
        self.base_url = base_url
        self.opener = build_opener(HTTPCookieProcessor(CookieJar()))

    def request(
        self,
        method: str,
        path: str,
        payload: dict[str, object] | None = None,
        headers: dict[str, str] | None = None,
    ) -> tuple[int, dict[str, object]]:
        data = None
        request_headers = dict(headers or {})
        if payload is not None:
            data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            request_headers["Content-Type"] = "application/json"
        request = Request(
            self.base_url + path,
            data=data,
            headers=request_headers,
            method=method,
        )
        try:
            response = self.opener.open(request, timeout=5)
            status = response.status
            raw = response.read()
        except HTTPError as error:
            status = error.code
            raw = error.read()
        return status, json.loads(raw.decode("utf-8")) if raw else {}

    def login(self, username: str, password: str) -> None:
        status, payload = self.request(
            "POST", "/api/login", {"username": username, "password": password}
        )
        assert_true(status == 200 and payload.get("authenticated"), "Falha no login administrativo.")


def sample_state() -> dict[str, object]:
    return {
        "version": 3,
        "settings": {
            "title": "Teste",
            "league": {"winPoints": 3, "lossPoints": 0},
        },
        "players": [
            {"id": "p1", "name": "Álvaro", "createdAt": server.utc_now()},
            {"id": "p2", "name": "Bia", "createdAt": server.utc_now()},
            {"id": "p3", "name": "Caio", "createdAt": server.utc_now()},
        ],
        "league": {
            "rounds": [
                {"number": 1, "matches": [{"id": "m1", "playerAId": "p1", "playerBId": "p2"}]},
                {
                    "number": 2,
                    "matches": [
                        {"id": "m2", "playerAId": "p1", "playerBId": "p3"},
                        {"id": "m3", "playerAId": "p2", "playerBId": "p3"},
                    ],
                },
            ],
            "results": {
                "m3": {
                    "playerAId": "p2",
                    "playerBId": "p3",
                    "winnerId": "p2",
                    "ballsA": 8,
                    "ballsB": 5,
                    "playedAt": "2026-07-15T17:00:00-03:00",
                }
            },
            "inProgress": {"m3": True, "ghost": True},
            "programming": {
                "nextMatchId": "m2",
                "featuredMatchIds": ["m1", "m2", "m3", "ghost", "m1"],
                "matches": {
                    "m2": {
                        "scheduledAt": "2026-07-18T17:30:00-03:00",
                        "location": "Sala",
                        "status": "scheduled",
                        "priority": 1,
                        "note": "Nota interna",
                        "publicNote": "Confirmado",
                    },
                    "m3": {"status": "postponed", "note": "Já terminou"},
                    "ghost": {"status": "scheduled"},
                },
            },
        },
        "availability": {
            "p1": [{
                "id": "availability-one",
                "status": "unavailable",
                "startsAt": "2026-07-18T17:00:00-03:00",
                "endsAt": "2026-07-18T18:00:00-03:00",
                "note": "Compromisso",
            }],
            "ghost": [{"id": "bad", "status": "available"}],
        },
        "tournament": None,
        "activity": [],
    }


def prepare_legacy_database() -> None:
    legacy_state = {
        "version": 3,
        "settings": {"title": "Legado"},
        "players": [{"id": "legacy-player", "name": "Legado", "createdAt": server.utc_now()}],
        "league": None,
        "tournament": None,
        "activity": [],
    }
    connection = sqlite3.connect(TEMP_DIR / "test.db")
    connection.execute(
        """
        CREATE TABLE app_state (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            data TEXT NOT NULL,
            revision INTEGER NOT NULL DEFAULT 1,
            updated_at TEXT NOT NULL
        )
        """
    )
    connection.execute(
        "INSERT INTO app_state (id, data, revision, updated_at) VALUES (1, ?, 7, ?)",
        (json.dumps(legacy_state, ensure_ascii=False), server.utc_now()),
    )
    connection.execute(
        """
        CREATE TABLE news_articles (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            summary TEXT NOT NULL,
            body TEXT NOT NULL,
            category TEXT NOT NULL,
            author TEXT NOT NULL,
            published_at TEXT NOT NULL,
            status TEXT NOT NULL,
            featured INTEGER NOT NULL DEFAULT 0,
            image_data BLOB,
            image_type TEXT,
            image_alt TEXT NOT NULL DEFAULT '',
            video_url TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    now = server.utc_now()
    connection.execute(
        """
        INSERT INTO news_articles (
            id, title, summary, body, category, author, published_at, status,
            featured, image_data, image_type, image_alt, video_url, created_at, updated_at
        ) VALUES ('legacy-news', 'Notícia legada', 'Resumo preservado',
                  'Conteúdo legado preservado integralmente.', 'Liga', 'Organização',
                  ?, 'published', 0, NULL, NULL, '', '', ?, ?)
        """,
        (now, now, now),
    )
    connection.commit()
    connection.close()


def run() -> None:
    httpd = None
    try:
        prepare_legacy_database()
        server.initialize_database()
        migration_check = sqlite3.connect(TEMP_DIR / "test.db")
        news_columns = {
            row[1] for row in migration_check.execute("PRAGMA table_info(news_articles)")
        }
        community_columns = {
            row[1] for row in migration_check.execute("PRAGMA table_info(community_posts)")
        }
        season_columns = {
            row[1] for row in migration_check.execute("PRAGMA table_info(season_archives)")
        }
        expansion_migration = migration_check.execute(
            "SELECT 1 FROM schema_migrations WHERE migration_id = 'site_expansion_v1'"
        ).fetchone()
        migration_check.close()
        assert_true({"match_id", "season_id"} <= news_columns, "Colunas de associação não migraram.")
        assert_true({"content_type", "content_id"} <= community_columns, "Escopo do mural não migrou.")
        assert_true({"champion_name", "runner_up_name"} <= season_columns, "Nomes históricos não migraram.")
        assert_true(expansion_migration is not None, "Migração da expansão não foi registrada.")
        httpd = server.ThreadingHTTPServer(("127.0.0.1", 0), server.TournamentHandler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        base_url = f"http://127.0.0.1:{httpd.server_port}"
        admin_one = ApiClient(base_url)
        admin_two = ApiClient(base_url)
        public = ApiClient(base_url)
        admin_one.login("admin-one", "password-one")
        admin_two.login("admin-two", "password-two")

        status, initial = admin_one.request("GET", "/api/state")
        assert_true(
            status == 200
            and initial["revision"] == 7
            and initial["state"]["players"][0]["id"] == "legacy-player",
            "Migração descartou o estado legado.",
        )
        status, legacy_news = public.request("GET", "/api/news")
        assert_true(
            status == 200 and legacy_news["articles"][0]["id"] == "legacy-news",
            "Migração descartou notícia legada.",
        )
        status, saved = admin_one.request(
            "PUT",
            "/api/state",
            {"state": sample_state(), "expectedRevision": initial["revision"]},
        )
        assert_true(status == 200 and saved["revision"] == 8, "Estado expandido não foi salvo.")
        assert_true(saved["warnings"] and saved["warnings"][0]["matchId"] == "m2", "Conflito de disponibilidade não detectado.")

        status, current = public.request("GET", "/api/state")
        state = current["state"]
        programming = state["league"]["programming"]
        assert_true(state["version"] == server.STATE_VERSION, "Versão do estado não migrou.")
        assert_true(programming["nextMatchId"] == "m2", "Próximo jogo de outra rodada não foi preservado.")
        assert_true(programming["featuredMatchIds"] == ["m1", "m2"], "Destaques não foram normalizados.")
        assert_true(set(programming["matches"]) == {"m2"}, "Referências concluídas/inexistentes não foram removidas.")
        assert_true(programming["matches"]["m2"]["updatedBy"] == "admin-one", "Ator da agenda não foi carimbado.")
        assert_true(state["availability"]["p1"][0]["updatedBy"] == "admin-one", "Ator da disponibilidade não foi carimbado.")
        assert_true("ghost" not in state["availability"], "Jogador inexistente permaneceu na disponibilidade.")
        assert_true(programming["matches"]["m2"]["note"] == "", "Nota interna vazou em /api/state público.")
        assert_true(state["availability"]["p1"][0]["note"] == "", "Nota de disponibilidade vazou em /api/state público.")
        status, admin_state = admin_one.request("GET", "/api/state")
        assert_true(
            admin_state["state"]["league"]["programming"]["matches"]["m2"]["note"] == "Nota interna"
            and admin_state["state"]["availability"]["p1"][0]["note"] == "Compromisso",
            "Sanitização removeu notas da resposta administrativa.",
        )
        static_response = public.opener.open(base_url + "/expansion-domain.js", timeout=5)
        static_source = static_response.read()
        assert_true(
            static_response.status == 200 and b"SinucaExpansionDomain" in static_source,
            "Módulo expansion-domain.js não foi servido.",
        )

        conflict_state = sample_state()
        conflict_state["league"]["programming"]["nextMatchId"] = "m1"
        status, conflict = admin_two.request(
            "PUT", "/api/state", {"state": conflict_state, "expectedRevision": 1}
        )
        assert_true(status == 409 and conflict["revision"] == 8 and conflict["conflict"], "Conflito de revisão não retornou 409.")
        invalid_state = json.loads(json.dumps(state))
        invalid_state["league"]["programming"]["matches"]["m2"]["scheduledAt"] = "data-inválida"
        status, invalid_date = admin_one.request(
            "PUT", "/api/state", {"state": invalid_state, "expectedRevision": 8}
        )
        assert_true(status == 400 and "data" in invalid_date["error"].lower(), "Data inválida não foi rejeitada.")

        status, public_schedule = public.request("GET", "/api/schedule")
        assert_true(status == 200, "Agenda pública falhou.")
        assert_true(public_schedule["programming"]["matches"]["m2"]["note"] == "", "Nota interna vazou na agenda pública.")
        assert_true(public_schedule["programming"]["matches"]["m2"]["publicNote"] == "Confirmado", "Nota pública foi perdida.")
        assert_true(public_schedule["availability"]["p1"][0]["note"] == "", "Nota de disponibilidade vazou.")

        tiny_png = "data:image/png;base64," + base64.b64encode(b"\x89PNG\r\n\x1a\nsmall").decode()
        status, profile_saved = admin_two.request(
            "POST",
            "/api/players/profile",
            {
                "playerId": "p1",
                "displayName": "Álvaro Souza",
                "nickname": "Mestre",
                "bio": "Jogador de teste.",
                "favoriteShot": "Tabela",
                "imageData": tiny_png,
            },
        )
        assert_true(status == 200 and profile_saved["profile"]["nickname"] == "Mestre", "Perfil não foi salvo.")
        status, profiles = public.request("GET", "/api/players/profiles")
        assert_true(status == 200 and len(profiles["profiles"]) == 3, "Perfis padrão não cobrem todos os jogadores.")
        status, profile = public.request("GET", "/api/players/profile?id=p1")
        assert_true(status == 200 and profile["profile"]["nextOpponent"]["matchId"] == "m2", "Detalhes do perfil estão incompletos.")

        status, pending_archive = admin_one.request(
            "POST", "/api/seasons/archive", {"title": "Temporada teste"}
        )
        assert_true(status == 400 and "pendente" in pending_archive["error"], "Arquivamento não alertou sobre pendências.")
        status, archived = admin_one.request(
            "POST",
            "/api/seasons/archive",
            {
                "title": "Temporada teste",
                "confirmPending": True,
            },
        )
        assert_true(
            status == 201
            and archived["season"]["snapshot"]["players"]
            and archived["season"]["championPlayerId"] == "p2"
            and archived["season"]["snapshot"]["ranking"][0]["name"] == "Bia",
            "Snapshot/inferência da temporada falhou.",
        )
        season_id = archived["season"]["id"]
        status, seasons = public.request("GET", "/api/seasons")
        assert_true(status == 200 and "snapshot" not in seasons["seasons"][0], "Lista de temporadas carregou snapshot pesado.")

        status, poll_saved = admin_one.request(
            "POST",
            "/api/polls",
            {
                "type": "player_of_round",
                "title": "Craque da rodada",
                "status": "open",
                "options": [
                    {"label": "Álvaro", "playerId": "p1"},
                    {"label": "Bia", "playerId": "p2"},
                ],
            },
        )
        assert_true(status == 200, "Enquete não foi criada.")
        poll_id = poll_saved["poll"]["id"]
        option_id = poll_saved["poll"]["options"][0]["id"]
        visitor_one = "visitor-0000000001"
        status, voted = public.request(
            "POST",
            "/api/polls/vote",
            {"pollId": poll_id, "optionId": option_id},
            {"X-Visitor-ID": visitor_one},
        )
        assert_true(status == 200 and voted["poll"]["userOptionId"] == option_id, "Voto não foi registrado.")
        status, _ = public.request(
            "POST",
            "/api/polls/vote",
            {"pollId": poll_id, "optionId": option_id},
            {"X-Visitor-ID": visitor_one},
        )
        assert_true(status == 409, "Segundo voto do visitante não foi bloqueado.")
        poll_payload = {
            **poll_saved["poll"],
            "status": "closed",
            "options": poll_saved["poll"]["options"],
        }
        status, _ = admin_one.request("POST", "/api/polls", poll_payload)
        assert_true(status == 200, "Encerramento da enquete falhou.")
        status, awards = public.request("GET", "/api/awards?playerId=p1")
        assert_true(status == 200 and any(item["pollId"] == poll_id for item in awards["awards"]), "Vencedor da enquete não virou premiação.")

        status, reaction = public.request(
            "POST",
            "/api/reactions",
            {"contentType": "match", "contentId": "m2", "reaction": "surprise"},
            {"X-Visitor-ID": visitor_one},
        )
        assert_true(status == 200 and reaction["counts"]["surprise"] == 1, "Reação não foi registrada.")
        status, reaction = public.request(
            "POST",
            "/api/reactions",
            {"contentType": "match", "contentId": "m2", "reaction": "historic"},
            {"X-Visitor-ID": visitor_one},
        )
        assert_true(reaction["counts"]["surprise"] == 0 and reaction["counts"]["historic"] == 1, "Reação não foi alterada.")

        status, post_saved = public.request(
            "POST",
            "/api/community",
            {
                "author": "Torcedor",
                "body": "Que confronto!",
                "contentType": "match",
                "contentId": "m2",
            },
            {"X-Visitor-ID": visitor_one},
        )
        assert_true(status == 201 and post_saved["post"]["contentId"] == "m2", "Comentário do confronto falhou.")
        post_id = post_saved["post"]["id"]
        status, general = public.request("GET", "/api/community")
        assert_true(status == 200 and not general["posts"], "Comentário de confronto vazou no mural geral.")
        status, match_posts = public.request("GET", "/api/community?contentType=match&contentId=m2")
        assert_true(status == 200 and len(match_posts["posts"]) == 1, "Filtro de comentários do confronto falhou.")
        for index in range(2, 5):
            status, _ = public.request(
                "POST",
                "/api/community/report",
                {"postId": post_id},
                {"X-Visitor-ID": f"visitor-000000000{index}"},
            )
            assert_true(status == 200, "Denúncia do mural falhou.")
        status, hidden = public.request("GET", "/api/community?contentType=match&contentId=m2")
        assert_true(not hidden["posts"], "Conteúdo com três denúncias não foi ocultado.")
        status, admin_posts = admin_two.request("GET", "/api/community?contentType=match&contentId=m2")
        assert_true(admin_posts["posts"][0]["status"] == "hidden", "Moderação não recebeu conteúdo oculto.")
        status, all_posts = admin_two.request("GET", "/api/community?contentType=all")
        assert_true(status == 200 and all_posts["posts"][0]["id"] == post_id, "Fila geral de moderação falhou.")
        status, _ = admin_two.request(
            "POST", "/api/community/moderate", {"postId": post_id, "status": "published"}
        )
        assert_true(status == 200, "Restauração administrativa do post falhou.")

        status, news = admin_one.request(
            "POST",
            "/api/news",
            {
                "title": "Resultado preparado",
                "summary": "Resumo automatizado do confronto.",
                "body": "Texto completo preparado, aguardando confirmação editorial.",
                "category": "Liga",
                "author": "Organização",
                "status": "draft",
                "matchId": "m2",
                "seasonId": season_id,
                "playerIds": ["p1", "p3"],
            },
        )
        assert_true(status == 200 and news["article"]["playerIds"] == ["p1", "p3"], "Associações da notícia falharam.")

        status, latest = admin_one.request("GET", "/api/state")
        completed_state = latest["state"]
        completed_state["league"]["results"]["m2"] = {
            "playerAId": "p1",
            "playerBId": "p3",
            "winnerId": "p1",
            "ballsA": 8,
            "ballsB": 4,
            "playedAt": server.utc_now(),
        }
        status, completed = admin_one.request(
            "PUT",
            "/api/state",
            {"state": completed_state, "expectedRevision": latest["revision"]},
        )
        assert_true(status == 200, "Conclusão do próximo jogo falhou.")
        status, after_completed = public.request("GET", "/api/state")
        assert_true(after_completed["state"]["league"]["programming"]["nextMatchId"] is None, "Jogo concluído permaneceu como próximo.")
        tasks = after_completed["state"].get("adminTasks", [])
        assert_true(tasks and tasks[0]["type"] == "choose-next-match", "Pendência para escolher próximo jogo não foi criada.")

        status, audit = admin_one.request("GET", "/api/admin/audit")
        actors = {entry["adminUsername"] for entry in audit["entries"]}
        assert_true({"admin-one", "admin-two"} <= actors, "Auditoria não registrou múltiplos administradores.")
        assert_true((TEMP_DIR / "backup-latest.json").is_file(), "Backup temporário não foi atualizado.")
        assert_true(not (ROOT / "data" / "test.db").exists(), "Teste tocou um caminho de dados do projeto.")
        print("OK: APIs de expansão validadas com banco temporário.")
    finally:
        if httpd is not None:
            httpd.shutdown()
            httpd.server_close()
        shutil.rmtree(TEMP_DIR, ignore_errors=True)


if __name__ == "__main__":
    run()

import asyncio
import hashlib
import json
import sqlite3
import socket
import ssl
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import httpx
from fastapi import HTTPException
from fastapi.testclient import TestClient

from main import create_app
from providers import generate_reply, request_provider


class APITests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "test.sqlite3"
        self.generate = AsyncMock(return_value={"content": "建议", "model": "test-model", "finishReason": "stop"})
        self.app = create_app(self.path, self.generate)
        self.client = TestClient(self.app)
        self.addCleanup(self.client.close)
        session = self.client.post("/api/sessions", json={"name": "玩家", "profile": {"rank": "Gold"}}).json()
        self.token, self.user_id = session["token"], session["user_id"]
        self.headers = {"Authorization": "Bearer " + self.token}
        self.conversation = self.client.post("/api/conversations", headers=self.headers).json()["conversation_id"]

    def body(self, **patches):
        return {"conversation_id": self.conversation, "request_id": str(uuid4()), "message": "选什么辅助？",
                "context": "蓝方：艾希", "instructions": "回复简体中文", "mode": "quick",
                "user": {"name": "新昵称", "profile": {"rank": "Diamond"}}, **patches}

    def post(self, body):
        return self.client.post("/api/chat", headers=self.headers, json=body)

    def test_history_is_loaded_by_server_and_profile_and_pair_are_saved(self):
        first = self.post(self.body())
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.json()["model"], "test-model")
        self.assertEqual(self.post(self.body(message="为什么？", mode="coach")).status_code, 200)
        messages, instructions, mode, provider = self.generate.call_args.args
        self.assertEqual(provider, "gemini")
        self.assertEqual([item["role"] for item in messages], ["user", "assistant", "user"])
        self.assertEqual(messages[0]["content"], "蓝方：艾希\n\n选什么辅助？")
        self.assertEqual(messages[1]["content"], "建议")
        self.assertEqual((instructions, mode), ("回复简体中文", "coach"))
        with closing(sqlite3.connect(self.path)) as db, db:
            name, profile = db.execute("SELECT name, profile FROM users WHERE id = ?", (self.user_id,)).fetchone()
            self.assertEqual((self.app.state.vault.open(name), json.loads(self.app.state.vault.open(profile))), ("新昵称", {"rank": "Diamond"}))
            self.assertEqual(db.execute("SELECT count(*) FROM messages").fetchone()[0], 4)
            saved_token = db.execute("SELECT token_hash FROM sessions").fetchone()[0]
            self.assertEqual(saved_token, hashlib.sha256(self.token.encode()).hexdigest())
        history = self.client.get(f"/api/conversations/{self.conversation}/messages", headers=self.headers).json()
        self.assertEqual([item["content"] for item in history], ["选什么辅助？", "建议", "为什么？", "建议"])

    def test_missing_invalid_expired_and_revoked_sessions(self):
        for headers in ({}, {"Authorization": "Bearer wrong"}, {"Authorization": "Basic wrong"}):
            self.assertEqual(self.client.post("/api/chat", headers=headers, json=self.body()).status_code, 401)
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute("UPDATE sessions SET expires_at = 0")
        self.assertEqual(self.post(self.body()).status_code, 401)
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute("UPDATE sessions SET expires_at = 9999999999")
        self.assertEqual(self.client.delete("/api/sessions/current", headers=self.headers).status_code, 204)
        self.assertEqual(self.post(self.body()).status_code, 401)
        self.generate.assert_not_called()

    def test_users_cannot_access_other_conversations(self):
        token = self.client.post("/api/sessions", json={"name": "其他玩家"}).json()["token"]
        headers = {"Authorization": "Bearer " + token}
        self.assertEqual(self.client.post("/api/chat", headers=headers, json=self.body()).status_code, 404)
        self.assertEqual(self.client.get(f"/api/conversations/{self.conversation}/messages", headers=headers).status_code, 404)
        self.assertEqual(self.client.get("/api/conversations", headers=headers).json(), [])
        self.generate.assert_not_called()

    def test_upstream_failure_saves_neither_half_turn_nor_profile_changes(self):
        self.generate.side_effect = HTTPException(502, "failed")
        self.assertEqual(self.post(self.body()).status_code, 502)
        with closing(sqlite3.connect(self.path)) as db, db:
            self.assertEqual(db.execute("SELECT count(*) FROM messages").fetchone()[0], 0)
            self.assertEqual(self.app.state.vault.open(db.execute("SELECT name FROM users").fetchone()[0]), "玩家")
        self.generate.side_effect = None
        self.generate.return_value = {"content": " "}
        self.assertEqual(self.post(self.body()).status_code, 502)

    def test_database_failure_rolls_back_entire_turn(self):
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute("CREATE TRIGGER fail_assistant BEFORE INSERT ON messages "
                       "WHEN NEW.role = 'assistant' BEGIN SELECT RAISE(ABORT, 'test failure'); END")
        with TestClient(self.app, raise_server_exceptions=False) as client:
            self.assertEqual(client.post("/api/chat", headers=self.headers, json=self.body()).status_code, 500)
        with closing(sqlite3.connect(self.path)) as db, db:
            self.assertEqual(db.execute("SELECT count(*) FROM messages").fetchone()[0], 0)
            self.assertEqual(db.execute("SELECT version FROM conversations").fetchone()[0], 0)
            self.assertEqual(self.app.state.vault.open(db.execute("SELECT name FROM users").fetchone()[0]), "玩家")

    def test_duplicate_request_returns_saved_reply_without_model_call(self):
        body = self.body()
        first, retry = self.post(body), self.post(body)
        self.assertEqual(first.json(), retry.json())
        self.assertEqual(self.generate.call_count, 1)
        self.assertEqual(self.post({**body, "message": "另一问题"}).status_code, 409)

    def test_database_survives_new_app_instance(self):
        self.post(self.body())
        with TestClient(create_app(self.path, self.generate)) as client:
            response = client.get(f"/api/conversations/{self.conversation}/messages", headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()), 2)

    def test_history_uses_ten_whole_turns_and_paginates(self):
        for index in range(12):
            self.assertEqual(self.post(self.body(message=f"问题{index}")).status_code, 200)
        history = self.generate.call_args.args[0]
        self.assertEqual(len(history), 21)
        self.assertIn("问题1", history[0]["content"])
        first = self.client.get(f"/api/conversations/{self.conversation}/messages?limit=2", headers=self.headers).json()
        second = self.client.get(f"/api/conversations/{self.conversation}/messages?after={first[-1]['id']}&limit=2", headers=self.headers).json()
        self.assertEqual(len(second), 2)
        self.assertGreater(second[0]["id"], first[-1]["id"])

    def test_invalid_input_never_calls_model_and_private_files_are_not_served(self):
        for patch_body in ({"message": " "}, {"mode": "other"}, {"conversation_id": "bad"},
                           {"message": "a" * 4001}, {"history": [{"role": "assistant", "content": "fake"}]}):
            self.assertEqual(self.post(self.body(**patch_body)).status_code, 422)
        self.generate.assert_not_called()
        self.assertEqual(self.client.get("/frontend/index.html").status_code, 200)
        self.assertEqual(self.client.get("/ai-core/backend.js").status_code, 200)
        for url in ("/back-end/data/gamecoach.sqlite3", "/.env", "/back-end/main.py", "/.git/config"):
            self.assertEqual(self.client.get(url).status_code, 404)

    def test_simultaneous_turns_do_not_commit_stale_history(self):
        async def run():
            ready = asyncio.Event()
            calls = 0

            async def generate(*args):
                nonlocal calls
                calls += 1
                if calls == 2:
                    ready.set()
                await asyncio.wait_for(ready.wait(), 5)
                return {"content": "reply"}

            self.app.state.generate = generate
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app), base_url="http://test") as client:
                replies = await asyncio.gather(*[
                    client.post("/api/chat", headers=self.headers, json=self.body(message=str(index)))
                    for index in range(2)])
            return sorted(reply.status_code for reply in replies)

        self.assertEqual(asyncio.run(run()), [200, 409])
        with closing(sqlite3.connect(self.path)) as db, db:
            self.assertEqual(db.execute("SELECT count(*) FROM messages").fetchone()[0], 2)


class GeminiTests(unittest.IsolatedAsyncioTestCase):
    async def test_connection_errors_are_distinct_and_never_echo_secrets(self):
        dns_error = httpx.ConnectError("connection failed: secret")
        dns_error.__cause__ = socket.gaierror(11001, "getaddrinfo failed")
        tls_error = httpx.ConnectError("connection failed: secret")
        tls_error.__cause__ = ssl.SSLCertVerificationError("certificate_verify_failed")
        for error, expected in (
            (dns_error, "UPSTREAM_DNS_ERROR"), (tls_error, "UPSTREAM_TLS_ERROR"),
            (httpx.ConnectError("secret"), "UPSTREAM_NETWORK_ERROR"),
            (httpx.ProxyError("secret"), "UPSTREAM_PROXY_ERROR"),
        ):
            mock_client = AsyncMock()
            mock_client.get.side_effect = error
            with patch.dict("os.environ", {"GEMINI_API_KEY": "secret"}), patch("providers.httpx.AsyncClient") as factory:
                factory.return_value.__aenter__.return_value = mock_client
                with self.assertRaises(HTTPException) as failure:
                    await request_provider("gemini", "models/test")
            self.assertEqual(failure.exception.detail, {"code": expected, "provider": "gemini"})
            self.assertNotIn("secret", json.dumps(failure.exception.detail))

    async def test_connection_probe_checks_both_models_without_generation(self):
        with tempfile.TemporaryDirectory() as temp:
            app = create_app(Path(temp) / "probe.sqlite3")
            with patch("providers.request_provider", new_callable=AsyncMock) as upstream:
                upstream.return_value = {"supportedGenerationMethods": ["generateContent"]}
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                    session = await client.post("/api/sessions", json={"name": "probe"})
                    probe_headers = {"Authorization": "Bearer " + session.json()["token"]}
                    response = await client.get("/api/connection", headers=probe_headers)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(upstream.call_count, 2)
                for call in upstream.call_args_list:
                    self.assertEqual(len(call.args), 2)
                    self.assertEqual(call.args[0], "gemini")
                    self.assertNotIn(":generateContent", call.args[1])
                upstream.side_effect = HTTPException(502, {"code": "UPSTREAM_DNS_ERROR"})
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                    response = await client.get("/api/connection", headers=probe_headers)
                self.assertEqual(response.status_code, 502)
                self.assertEqual(response.json()["detail"]["code"], "UPSTREAM_DNS_ERROR")

    async def test_request_mapping_and_hidden_thoughts(self):
        mock_client = AsyncMock()
        mock_client.post.return_value = httpx.Response(200, json={"candidates": [{
            "content": {"parts": [{"text": "hidden", "thought": True}, {"text": "answer"}]},
            "finishReason": "STOP"}]})
        with patch.dict("os.environ", {"GEMINI_API_KEY": "secret"}), patch("providers.httpx.AsyncClient") as factory:
            factory.return_value.__aenter__.return_value = mock_client
            result = await generate_reply([{"role": "user", "content": "hi"},
                                           {"role": "assistant", "content": "hello"},
                                           {"role": "user", "content": "why"}], "rules", "coach")
        self.assertEqual(result["content"], "answer")
        payload = mock_client.post.call_args.kwargs
        self.assertEqual([item["role"] for item in payload["json"]["contents"]], ["user", "model", "user"])
        self.assertNotIn("secret", mock_client.post.call_args.args[0])
        self.assertEqual(payload["headers"], {"x-goog-api-key": "secret"})

    async def test_provider_errors_hide_upstream_details(self):
        for response, expected in (
            (httpx.Response(403, json={"error": {"message": "secret"}}), 502),
            (httpx.Response(200, text="not json"), 502),
            (httpx.Response(200, json={"candidates": []}), 502),
            (httpx.Response(200, json={"candidates": [{"finishReason": "SAFETY"}]}), 502),
        ):
            mock_client = AsyncMock()
            mock_client.post.return_value = response
            with patch.dict("os.environ", {"GEMINI_API_KEY": "secret"}), patch("providers.httpx.AsyncClient") as factory:
                factory.return_value.__aenter__.return_value = mock_client
                with self.assertRaises(HTTPException) as failure:
                    await generate_reply([{"role": "user", "content": "hi"}], "", "quick")
            self.assertEqual(failure.exception.status_code, expected)
            self.assertNotIn("secret", failure.exception.detail)

    async def test_missing_key_and_timeout(self):
        with patch.dict("os.environ", {"GEMINI_API_KEY": ""}):
            with self.assertRaises(HTTPException) as failure:
                await generate_reply([], "", "quick")
            self.assertEqual(failure.exception.status_code, 503)
        mock_client = AsyncMock()
        mock_client.post.side_effect = httpx.ReadTimeout("secret")
        with patch.dict("os.environ", {"GEMINI_API_KEY": "secret"}), patch("providers.httpx.AsyncClient") as factory:
            factory.return_value.__aenter__.return_value = mock_client
            with self.assertRaises(HTTPException) as failure:
                await generate_reply([], "", "quick")
        self.assertEqual(failure.exception.status_code, 504)
        self.assertNotIn("secret", failure.exception.detail)


if __name__ == "__main__":
    unittest.main()

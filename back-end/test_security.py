import json
import os
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from main import create_app


class SecurityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "test.sqlite3"
        self.environment = patch.dict(os.environ, {"GAMECOACH_ENV": "development", "GAMECOACH_ACCESS_CODE": "",
            "GAMECOACH_ENCRYPTION_KEY": Fernet.generate_key().decode(), "GAMECOACH_MAX_REQUESTS_PER_MINUTE": "0"})
        self.environment.start(); self.addCleanup(self.environment.stop)
        self.generate = AsyncMock(return_value={"content": "private answer", "model": "test", "finishReason": "stop"})
        self.app = create_app(self.path, self.generate)
        self.client = TestClient(self.app)
        self.addCleanup(self.client.close)
        self.session = self.client.post("/api/sessions", json={"name": "Private player"}).json()
        self.headers = {"Authorization": "Bearer " + self.session["token"]}

    def snapshot(self):
        return {"id": "local-user", "name": "Private player", "profile": {"rank": "private rank"},
            "updatedAt": "2026-10-26T20:00:00Z", "api_key": "never-back-up-this",
            "memory": {"version": 1, "enabled": True, "entries": [{"id": "m1", "title": "Support preference", "topics": ["support"], "text": "private training memory", "enabled": True}]},
            "sessions": [{"id": "local-conversation", "messages": [
                {"role": "user", "content": "private imported question"},
                {"role": "coach", "content": "private imported answer", "status": "complete", "isDemo": False},
                {"role": "user", "content": "failed question"},
                {"role": "coach", "content": "failed answer", "status": "error", "isDemo": False}]}]}

    def test_credentials_are_encrypted_isolated_and_never_returned(self):
        key = "only-this-user-private-api-key"
        result = self.client.put("/api/credentials/deepseek", headers=self.headers, json={"api_key": key})
        self.assertEqual(result.status_code, 200)
        self.assertNotIn(key, result.text)
        self.assertTrue(self.client.get("/api/credentials", headers=self.headers).json()["deepseek"]["saved"])
        second = self.client.post("/api/sessions", json={"name": "Other"}).json()
        other_headers = {"Authorization": "Bearer " + second["token"]}
        self.assertFalse(self.client.get("/api/credentials", headers=other_headers).json()["deepseek"]["saved"])
        conversation = self.client.post("/api/conversations", headers=self.headers).json()["conversation_id"]
        body = {"conversation_id": conversation, "request_id": str(uuid4()), "message": "private question",
                "user": {"name": "Private player"}, "provider": "deepseek"}
        self.assertEqual(self.client.post("/api/chat", headers=self.headers, json=body).status_code, 200)
        self.assertEqual(self.generate.call_args.kwargs, {"api_key": key})
        with closing(sqlite3.connect(self.path)) as db:
            ciphertext = db.execute("SELECT encrypted_key FROM credentials").fetchone()[0]
            self.assertNotIn(key, ciphertext)
            self.assertEqual(self.app.state.vault.open(ciphertext), key)
            rows = db.execute("SELECT content, context, metadata FROM messages").fetchall()
            self.assertTrue(all(value.startswith("enc:") for row in rows for value in row))
        self.assertNotIn(key.encode(), self.path.read_bytes())
        self.client.delete("/api/credentials/deepseek", headers=other_headers)
        self.assertTrue(self.client.get("/api/credentials", headers=self.headers).json()["deepseek"]["saved"])
        self.client.delete("/api/credentials/deepseek", headers=self.headers)
        self.assertFalse(self.client.get("/api/credentials", headers=self.headers).json()["deepseek"]["saved"])

    def test_memory_and_imported_history_are_shared_for_all_providers(self):
        response = self.client.put("/api/user-state", headers=self.headers, json={"version": 0, "user": self.snapshot()})
        self.assertEqual(response.status_code, 200, response.text)
        state = self.client.get("/api/user-state", headers=self.headers).json()
        self.assertEqual(state["user"]["memory"]["entries"][0]["text"], "private training memory")
        self.assertNotIn("api_key", state["user"])
        self.assertNotIn("never-back-up-this", json.dumps(state))
        conversation = self.client.post("/api/conversations", headers=self.headers, json={"local_id": "local-conversation"}).json()["conversation_id"]
        for provider in ("deepseek", "openai", "claude", "grok", "gemini"):
            response = self.client.post("/api/chat", headers=self.headers, json={
                "conversation_id": conversation, "request_id": str(uuid4()), "message": "Which support should I pick?",
                "provider": provider, "user": {"name": "Private player"}})
            self.assertEqual(response.status_code, 200, response.text)
            history = self.generate.call_args.args[0]
            self.assertEqual(history[0]["content"], "private imported question")
            self.assertEqual(history[1]["content"], "private imported answer")
            self.assertNotIn("failed answer", json.dumps(history))
            self.assertIn("private training memory", history[-1]["content"])
            self.assertEqual(response.json()["usedMemories"][0]["id"], "m1")
            self.assertEqual(self.client.get("/api/user-state", headers=self.headers).json()["user"]["memory"], state["user"]["memory"])
        self.assertEqual(self.client.put("/api/user-state", headers=self.headers, json={"version": 0, "user": self.snapshot()}).status_code, 409)
        self.assertNotIn(b"private training memory", self.path.read_bytes())
        self.assertNotIn(b"private imported question", self.path.read_bytes())

    def test_recovery_restores_same_user_state_and_saved_key_after_session_loss(self):
        self.client.put("/api/user-state", headers=self.headers, json={"version": 0, "user": self.snapshot()})
        self.client.put("/api/credentials/claude", headers=self.headers, json={"api_key": "saved-api-key-private"})
        self.client.delete("/api/sessions/current", headers=self.headers)
        restored = self.client.post("/api/sessions/restore", json={"recovery": self.session["recovery"]})
        self.assertEqual(restored.status_code, 200)
        self.assertEqual(restored.json()["user_id"], self.session["user_id"])
        headers = {"Authorization": "Bearer " + restored.json()["token"]}
        self.assertTrue(self.client.get("/api/credentials", headers=headers).json()["claude"]["saved"])
        self.assertEqual(self.client.get("/api/user-state", headers=headers).json()["version"], 1)

    def test_completed_reply_is_recovered_after_the_browser_loses_the_response(self):
        snapshot = self.snapshot()
        snapshot["sessions"] = [{"id": "lost-response-chat", "messages": [
            {"role": "user", "content": "lost request"},
            {"id": "reply-to-recover", "role": "coach", "content": "", "status": "pending", "isDemo": False}]}]
        self.client.put("/api/user-state", headers=self.headers, json={"version": 0, "user": snapshot})
        conversation = self.client.post("/api/conversations", headers=self.headers, json={"local_id": "lost-response-chat"}).json()["conversation_id"]
        self.client.post("/api/chat", headers=self.headers, json={"conversation_id": conversation, "request_id": str(uuid4()),
            "client_reply_id": "reply-to-recover", "message": "lost request", "provider": "deepseek", "user": {"name": "Private player"}})
        state = self.client.get("/api/user-state", headers=self.headers).json()
        self.assertTrue(state["recovered_replies"])
        recovered = state["user"]["sessions"][0]["messages"][1]
        self.assertEqual(recovered["content"], "private answer")
        self.assertEqual(recovered["status"], "complete")
        self.assertEqual(recovered["upstreamProvider"], "deepseek")
        self.assertEqual(self.generate.call_count, 1)

    def test_validation_headers_and_sensitive_files_do_not_expose_credentials(self):
        value = "secret-with-whitespace unsafe"
        response = self.client.put("/api/credentials/openai", headers=self.headers, json={"api_key": value})
        self.assertEqual(response.status_code, 422)
        self.assertNotIn(value, response.text)
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        self.assertIn("connect-src 'self'", response.headers["Content-Security-Policy"])
        for url in ("/.secrets/server.json", "/back-end/.secrets/storage.key", "/.env", "/back-end/data/gamecoach.sqlite3"):
            self.assertEqual(self.client.get(url).status_code, 404)
        self.assertEqual(self.client.get("/api/connection").status_code, 401)
        response = self.client.put("/api/user-state", headers={**self.headers, "Content-Type": "application/json"},
                                   content=(b"x" * 1_000_000 for _ in range(13)))
        self.assertEqual(response.status_code, 413)

    def test_missing_original_master_key_never_returns_or_overwrites_private_data(self):
        self.client.put("/api/user-state", headers=self.headers, json={"version": 0, "user": self.snapshot()})
        with patch.dict(os.environ, {"GAMECOACH_ENCRYPTION_KEY": Fernet.generate_key().decode()}):
            with TestClient(create_app(self.path, self.generate)) as other:
                response = other.get("/api/user-state", headers=self.headers)
                self.assertEqual(response.status_code, 503)
                self.assertEqual(response.json()["detail"]["code"], "STORAGE_KEY_ERROR")
        self.assertEqual(self.client.get("/api/user-state", headers=self.headers).json()["user"]["memory"], self.snapshot()["memory"])

    def test_production_requires_https_invite_and_restricts_hosts_and_requests(self):
        invite = "long-random-invite-for-team-only"
        settings = {"GAMECOACH_ENV": "production", "GAMECOACH_ALLOWED_HOSTS": "coach.example.com",
                    "GAMECOACH_ACCESS_CODE": invite, "GAMECOACH_MAX_REQUESTS_PER_MINUTE": "1"}
        with patch.dict(os.environ, settings):
            app = create_app(Path(self.temp.name) / "production.sqlite3", self.generate)
            with TestClient(app, base_url="http://coach.example.com") as insecure:
                self.assertEqual(insecure.get("/api/health").status_code, 400)
            with TestClient(app, base_url="https://coach.example.com") as client:
                self.assertEqual(client.post("/api/sessions", json={"name": "Tester"}).status_code, 403)
                created = client.post("/api/sessions", headers={"X-GameCoach-Access": invite}, json={"name": "Tester"})
                self.assertEqual(created.status_code, 201)
                headers = {"Authorization": "Bearer " + created.json()["token"]}
                conversation = client.post("/api/conversations", headers=headers).json()["conversation_id"]
                body = {"conversation_id": conversation, "request_id": str(uuid4()), "message": "hello", "user": {"name": "Tester"}}
                self.assertEqual(client.post("/api/chat", headers=headers, json=body).status_code, 200)
                body["request_id"] = str(uuid4())
                self.assertEqual(client.post("/api/chat", headers=headers, json=body).status_code, 429)
                self.assertIn("max-age", client.get("/api/health").headers["Strict-Transport-Security"])
            with TestClient(app, base_url="https://other.example.com") as client:
                self.assertEqual(client.get("/api/health").status_code, 400)
        with patch.dict(os.environ, {"GAMECOACH_ENV": "production", "GAMECOACH_ENCRYPTION_KEY": ""}):
            with self.assertRaises(RuntimeError):
                create_app(Path(self.temp.name) / "unsafe.sqlite3")

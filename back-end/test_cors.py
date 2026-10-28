import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from main import create_app
from secure_config import parse_frontend_origins


class CorsTests(unittest.TestCase):
    def test_pages_preflight_errors_and_authenticated_requests(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {
            "GAMECOACH_ENV": "production", "GAMECOACH_ALLOWED_HOSTS": "coach.example.com",
            "GAMECOACH_ACCESS_CODE": "long-private-team-access-code",
            "GAMECOACH_ENCRYPTION_KEY": Fernet.generate_key().decode(),
            "GAMECOACH_CORS_ORIGINS": "https://team.github.io",
        }):
            app = create_app(Path(directory) / "test.sqlite3", AsyncMock())
            with TestClient(app, base_url="https://coach.example.com") as client:
                preflight = {"Origin": "https://team.github.io", "Access-Control-Request-Method": "POST",
                             "Access-Control-Request-Headers": "authorization,content-type,x-gamecoach-access"}
                response = client.options("/api/sessions", headers=preflight)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.headers["access-control-allow-origin"], "https://team.github.io")
                self.assertNotIn("access-control-allow-credentials", response.headers)
                self.assertIn("Origin", response.headers["vary"])
                response = client.get("/api/user-state", headers={"Origin": "https://team.github.io"})
                self.assertEqual(response.status_code, 401)
                self.assertEqual(response.headers["access-control-allow-origin"], "https://team.github.io")
                response = client.post("/api/sessions", headers={"Origin": "https://team.github.io",
                    "X-GameCoach-Access": "long-private-team-access-code"}, json={"name": "Tester"})
                self.assertEqual(response.status_code, 201)
                session = response.json()
                response = client.get("/api/user-state", headers={"Origin": "https://team.github.io",
                    "Authorization": "Bearer " + session["token"]})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.headers["access-control-allow-origin"], "https://team.github.io")
                for origin in ["https://evil.example.com", "https://team.github.io.evil.example", "null"]:
                    denied = client.options("/api/chat", headers={**preflight, "Origin": origin})
                    self.assertEqual(denied.status_code, 400)
                    self.assertNotIn("access-control-allow-origin", denied.headers)
                    self.assertNotIn("access-control-allow-origin", client.get("/api/health", headers={"Origin": origin}).headers)
                denied = client.options("/api/chat", headers={**preflight, "Access-Control-Request-Headers": "x-untrusted"})
                self.assertEqual(denied.status_code, 400)

    def test_invalid_cors_configuration_fails_closed(self):
        for value in ["*", "https://*.github.io", "http://team.github.io", "https://team.github.io/GameCoach/",
                      "https://user:password@team.github.io", "https://team.github.io?key=secret", "null",
                      "https://team.github.io/", "https://team.github.io:99999", "https://team.github.io#fragment"]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                parse_frontend_origins(value)
        self.assertEqual(parse_frontend_origins(""), [])
        self.assertEqual(parse_frontend_origins("https://team.github.io,https://team.github.io"), ["https://team.github.io"])
        self.assertEqual(parse_frontend_origins("http://localhost:8000", allow_local_http=True), ["http://localhost:8000"])

    def test_no_cors_headers_are_added_without_an_allowlist(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {
            "GAMECOACH_ENV": "development", "GAMECOACH_CORS_ORIGINS": "", "GAMECOACH_ACCESS_CODE": "",
            "GAMECOACH_ENCRYPTION_KEY": Fernet.generate_key().decode(),
        }):
            with TestClient(create_app(Path(directory) / "test.sqlite3", AsyncMock())) as client:
                response = client.get("/api/health", headers={"Origin": "https://team.github.io"})
                self.assertEqual(response.status_code, 200)
                self.assertNotIn("access-control-allow-origin", response.headers)

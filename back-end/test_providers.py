import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import httpx
from fastapi import HTTPException
from fastapi.testclient import TestClient

from main import create_app
from providers import PROVIDERS, check_connection, generate_reply, provider_info, request_provider


KEYS = {config.key_env: "test-secret-" + name for name, config in PROVIDERS.items()}
KEYS["GAMECOACH_PROVIDER"] = "gemini"
HISTORY = [{"role": "user", "content": "first question"},
           {"role": "assistant", "content": "previous answer"},
           {"role": "user", "content": "follow-up"}]


def response_for(name, limited=False):
    if name == "gemini":
        return {"candidates": [{"finishReason": "MAX_TOKENS" if limited else "STOP", "content": {"parts": [
            {"text": "hidden", "thought": True}, {"text": "answer"}]}}],
            "usageMetadata": {"promptTokenCount": 10, "candidatesTokenCount": 3, "totalTokenCount": 13}}
    if name == "deepseek":
        return {"choices": [{"finish_reason": "length" if limited else "stop",
                             "message": {"content": "answer", "reasoning_content": "hidden"}}],
                "usage": {"prompt_tokens": 10, "completion_tokens": 3, "total_tokens": 13}}
    if name == "claude":
        return {"stop_reason": "max_tokens" if limited else "end_turn", "content": [
            {"type": "thinking", "thinking": "hidden"}, {"type": "text", "text": "answer"}],
            "usage": {"input_tokens": 7, "cache_read_input_tokens": 3, "output_tokens": 3}}
    return {"status": "incomplete" if limited else "completed",
            "incomplete_details": {"reason": "max_output_tokens"} if limited else None,
            "output": [{"type": "reasoning", "summary": "hidden"},
                       {"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": "answer"}]}],
            "usage": {"input_tokens": 10, "output_tokens": 3, "total_tokens": 13}}


class AdapterTests(unittest.IsolatedAsyncioTestCase):
    async def test_all_five_providers_map_history_credentials_and_normalized_results(self):
        for name, config in PROVIDERS.items():
            for mode in ("quick", "coach"):
                with self.subTest(provider=name, mode=mode):
                    client = AsyncMock()
                    client.post.return_value = httpx.Response(200, json=response_for(name))
                    with patch.dict(os.environ, KEYS), patch("providers.httpx.AsyncClient") as factory:
                        factory.return_value.__aenter__.return_value = client
                        result = await generate_reply(HISTORY, "custom rules", mode, name)
                    self.assertEqual(result, {"content": "answer", "model": config.model(mode),
                                             "upstream_provider": name, "finishReason": "stop",
                                             "usage": {"inputTokens": 10, "outputTokens": 3, "totalTokens": 13}})
                    url = client.post.call_args.args[0]
                    request = client.post.call_args.kwargs
                    payload = request["json"]
                    self.assertTrue(url.startswith(config.base_url + "/"))
                    self.assertNotIn("test-secret", url + json.dumps(payload))
                    self.assertIn(KEYS[config.key_env], str(request["headers"]))
                    self.assertIn("custom rules", json.dumps(payload))
                    self.assertIn("first question", json.dumps(payload))
                    self.assertIn("previous answer", json.dumps(payload))
                    self.assertIn("follow-up", json.dumps(payload))
                    budget = 512 if mode == "quick" else 4096
                    if name == "gemini":
                        self.assertEqual(payload["generationConfig"]["maxOutputTokens"], budget)
                        self.assertEqual(request["headers"], {"x-goog-api-key": KEYS[config.key_env]})
                    elif name == "claude":
                        self.assertTrue(url.endswith("/messages"))
                        self.assertEqual(payload["max_tokens"], budget)
                        self.assertTrue(request["headers"].get("anthropic-version"))
                        self.assertEqual([item["role"] for item in payload["messages"]], ["user", "assistant", "user"])
                    elif name == "deepseek":
                        self.assertTrue(url.endswith("/chat/completions"))
                        self.assertEqual(payload["max_tokens"], budget)
                        self.assertEqual(payload["thinking"], {"type": "disabled"})
                    else:
                        self.assertTrue(url.endswith("/responses"))
                        self.assertEqual(payload["max_output_tokens"], budget)
                        self.assertIs(payload["store"], False)
                    self.assertFalse(factory.call_args.kwargs["follow_redirects"])

    async def test_truncation_and_malformed_or_incomplete_answers(self):
        for name in PROVIDERS:
            for raw, reason in ((response_for(name, True), "length"), ({}, None),
                                ({"choices": [], "output": [], "content": [], "candidates": []}, None)):
                with patch("providers.request_provider", new_callable=AsyncMock, return_value=raw):
                    if reason:
                        self.assertEqual((await generate_reply(HISTORY, "", "quick", name))["finishReason"], reason)
                    else:
                        with self.assertRaises(HTTPException):
                            await generate_reply(HISTORY, "", "quick", name)
        for raw in ({"status": "failed", "output": []},
                    {"status": "incomplete", "incomplete_details": {"reason": "content_filter"}, "output": []},
                    {"status": "completed", "output": [{"type": "message", "role": "assistant", "content": [
                        {"type": "refusal", "refusal": "refused"}, {"type": "output_text", "text": "partial"}]}]}):
            with patch("providers.request_provider", new_callable=AsyncMock, return_value=raw):
                with self.assertRaises(HTTPException):
                    await generate_reply(HISTORY, "", "quick", "openai")

    async def test_http_errors_missing_keys_and_secret_redaction_for_every_provider(self):
        for name, config in PROVIDERS.items():
            with patch.dict(os.environ, {config.key_env: ""}):
                with self.assertRaises(HTTPException) as failure:
                    await request_provider(name, "models")
                self.assertEqual(failure.exception.status_code, 503)
            for status, code in ((401, "UPSTREAM_KEY_INVALID"), (402, "UPSTREAM_BALANCE_INSUFFICIENT"),
                                 (403, "UPSTREAM_PERMISSION_DENIED"), (404, "UPSTREAM_MODEL_NOT_FOUND"),
                                 (429, "UPSTREAM_QUOTA_EXCEEDED"), (500, "UPSTREAM_HTTP_ERROR")):
                client = AsyncMock()
                client.get.return_value = httpx.Response(status, json={"error": {"message": "test-secret"}})
                with patch.dict(os.environ, KEYS), patch("providers.httpx.AsyncClient") as factory:
                    factory.return_value.__aenter__.return_value = client
                    with self.assertRaises(HTTPException) as failure:
                        await request_provider(name, "models")
                self.assertEqual(failure.exception.detail, {"code": code, "provider": name})
                self.assertNotIn("test-secret", json.dumps(failure.exception.detail))

    async def test_probes_use_selected_provider_and_do_not_generate(self):
        for name, config in PROVIDERS.items():
            models = set(provider_info(name)["models"].values())
            async def get_metadata(provider, path):
                self.assertEqual(provider, name)
                self.assertNotIn("completions", path)
                self.assertNotIn("responses", path)
                if name in ("deepseek", "grok"):
                    return {"data": [{"id": model} for model in models]}
                return {"id": "model", "supportedGenerationMethods": ["generateContent"]}
            with patch("providers.request_provider", side_effect=get_metadata):
                result = await check_connection(name)
            self.assertEqual(result["provider"], name)
            with patch("providers.request_provider", new_callable=AsyncMock, return_value={"data": []}):
                with self.assertRaises(HTTPException):
                    await check_connection(name)

    async def test_env_overrides_default_and_model_without_cross_provider_fallback(self):
        with patch.dict(os.environ, {**KEYS, "GAMECOACH_PROVIDER": "deepseek", "DEEPSEEK_QUICK_MODEL": "custom-model"}), \
                patch("providers.request_provider", new_callable=AsyncMock, return_value=response_for("deepseek")) as request:
            result = await generate_reply(HISTORY, "", "quick")
        self.assertEqual(result["upstream_provider"], "deepseek")
        self.assertEqual(result["model"], "custom-model")
        self.assertEqual(request.call_args.args[0], "deepseek")


class UnifiedAPITests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.client = TestClient(create_app(Path(self.temp.name) / "test.sqlite3"))
        self.addCleanup(self.client.close)
        self.environment = patch.dict(os.environ, KEYS)
        self.environment.start()
        self.addCleanup(self.environment.stop)
        token = self.client.post("/api/sessions", json={"name": "test"}).json()["token"]
        self.headers = {"Authorization": "Bearer " + token}
        self.conversation = self.client.post("/api/conversations", headers=self.headers).json()["conversation_id"]

    def body(self, name, request_id=None):
        return {"conversation_id": self.conversation, "request_id": request_id or str(uuid4()),
                "message": "hi", "provider": name, "user": {"name": "test", "profile": {}}}

    def test_switching_providers_preserves_history_and_uniform_json_and_idempotency(self):
        for index, name in enumerate(PROVIDERS):
            with patch("providers.request_provider", new_callable=AsyncMock, return_value=response_for(name)) as upstream:
                body = self.body(name)
                response = self.client.post("/api/chat", headers=self.headers, json=body)
                self.assertEqual(response.status_code, 200, response.text)
                data = response.json()
                self.assertEqual(data["upstream_provider"], name)
                self.assertEqual(data["provider"], "backend")
                self.assertEqual(data["content"], "answer")
                self.assertIn("usage", data)
                payload = upstream.call_args.args[2]
                self.assertEqual(json.dumps(payload).count('"answer"'), index)
                retry = self.client.post("/api/chat", headers=self.headers, json=body)
                self.assertEqual(retry.json(), data)
                self.assertEqual(upstream.call_count, 1)
                changed = {**body, "provider": "openai" if name != "openai" else "claude"}
                self.assertEqual(self.client.post("/api/chat", headers=self.headers, json=changed).status_code, 409)
        history = self.client.get(f"/api/conversations/{self.conversation}/messages", headers=self.headers).json()
        self.assertEqual(len(history), 10)

    def test_provider_catalog_health_validation_and_errors(self):
        catalog = self.client.get("/api/providers").json()
        self.assertEqual(len(catalog["providers"]), 5)
        self.assertNotIn("test-secret", json.dumps(catalog))
        self.assertEqual(catalog["default_provider"], "gemini")
        for name in PROVIDERS:
            health = self.client.get("/api/health", params={"provider": name}).json()
            self.assertTrue(health["model_configured"])
            self.assertEqual(health["provider"], name)
        for route in ("/api/health?provider=unsupported", "/api/connection?provider=unsupported"):
            self.assertEqual(self.client.get(route, headers=self.headers).status_code, 422)
        self.assertEqual(self.client.post("/api/chat", headers=self.headers, json=self.body("unsupported")).status_code, 422)
        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": ""}):
            response = self.client.post("/api/chat", headers=self.headers, json=self.body("deepseek"))
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["detail"]["provider"], "deepseek")
        self.assertEqual(self.client.get(f"/api/conversations/{self.conversation}/messages", headers=self.headers).json(), [])


if __name__ == "__main__":
    unittest.main()

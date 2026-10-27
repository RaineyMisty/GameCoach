"""Text-only provider adapters. Credentials and endpoints stay on the server."""

import os
import socket
import ssl
from dataclasses import dataclass
from typing import Literal
from urllib.parse import quote

import httpx
from fastapi import HTTPException
from secure_config import setting

ProviderName = Literal["gemini", "deepseek", "openai", "grok", "claude"]


@dataclass(frozen=True)
class Provider:
    label: str
    prefix: str
    base_url: str
    protocol: str
    quick: str
    coach: str

    @property
    def key_env(self):
        return self.prefix + "_API_KEY"

    def model(self, mode):
        return setting(self.prefix + "_" + mode.upper() + "_MODEL", getattr(self, mode)).strip()


PROVIDERS = {
    "gemini": Provider("Google Gemini", "GEMINI", "https://generativelanguage.googleapis.com/v1beta",
                       "gemini", "gemini-3.5-flash-lite", "gemini-3.8-flash"),
    "deepseek": Provider("DeepSeek", "DEEPSEEK", "https://api.deepseek.com",
                         "chat", "deepseek-flash", "deepseek-v4-pro"),
    "openai": Provider("OpenAI (ChatGPT API)", "OPENAI", "https://api.openai.com/v1",
                       "responses", "gpt-4.1-mini", "gpt-4.1"),
    "grok": Provider("xAI Grok", "XAI", "https://api.x.ai/v1",
                     "responses", "grok-4.3", "grok-4.3"),
    "claude": Provider("Anthropic Claude", "ANTHROPIC", "https://api.anthropic.com/v1",
                       "messages", "claude-haiku-5-5", "claude-sonnet-5-5"),
}


def upstream_error(code, status=502, provider=None):
    return HTTPException(status, {"code": code, **({"provider": provider} if provider else {})})


def selected_provider(value=None):
    name = value if value is not None else setting("GAMECOACH_PROVIDER", "gemini").strip().lower()
    if name not in PROVIDERS:
        raise upstream_error("SERVER_PROVIDER_INVALID", 503)
    return name


def provider_info(name):
    config = PROVIDERS[name]
    return {"id": name, "name": config.label, "key_env": config.key_env,
            "configured": bool(setting(config.key_env).strip()),
            "models": {mode: config.model(mode) for mode in ("quick", "coach")}}


def connection_error_code(error):
    pending, visited = [error], set()
    while pending:
        current = pending.pop()
        if id(current) in visited:
            continue
        visited.add(id(current))
        if isinstance(current, socket.gaierror) or "getaddrinfo failed" in str(current).lower():
            return "UPSTREAM_DNS_ERROR"
        if isinstance(current, ssl.SSLCertVerificationError) or "certificate_verify_failed" in str(current).lower():
            return "UPSTREAM_TLS_ERROR"
        pending.extend(item for item in (current.__cause__, current.__context__) if item is not None)
    return "UPSTREAM_NETWORK_ERROR"


async def request_provider(name, path, payload=None, *, api_key=None):
    config = PROVIDERS[name]
    key = setting(config.key_env).strip() if api_key is None else api_key
    if not key:
        raise upstream_error("SERVER_KEY_MISSING", 503, name)
    if name == "gemini":
        headers = {"x-goog-api-key": key}
    else:
        headers = {"Authorization": "Bearer " + key}
    if name == "claude":
        headers["anthropic-version"] = "2026-10-21"
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(60, connect=10), follow_redirects=False) as client:
            url = config.base_url + "/" + path
            response = (await client.get(url, headers=headers) if payload is None else
                        await client.post(url, headers=headers, json=payload))
        if response.status_code != 200:
            code = {400: "UPSTREAM_INVALID_REQUEST", 401: "UPSTREAM_KEY_INVALID",
                    402: "UPSTREAM_BALANCE_INSUFFICIENT", 403: "UPSTREAM_PERMISSION_DENIED",
                    404: "UPSTREAM_MODEL_NOT_FOUND", 429: "UPSTREAM_QUOTA_EXCEEDED"}.get(
                        response.status_code, "UPSTREAM_HTTP_ERROR")
            if name == "gemini":
                try:
                    details = response.json().get("error", {}).get("details", [])
                    if any(item.get("reason") in ("API_KEY_INVALID", "API_KEY_EXPIRED")
                           for item in details if isinstance(item, dict)):
                        code = "UPSTREAM_KEY_INVALID"
                except (ValueError, AttributeError, TypeError):
                    pass
            raise upstream_error(code, provider=name)
        data = response.json()
        if not isinstance(data, dict):
            raise upstream_error("UPSTREAM_INVALID_RESPONSE", provider=name)
        return data
    except httpx.TimeoutException:
        raise upstream_error("UPSTREAM_TIMEOUT", 504, name) from None
    except httpx.ProxyError:
        raise upstream_error("UPSTREAM_PROXY_ERROR", provider=name) from None
    except httpx.ConnectError as error:
        raise upstream_error(connection_error_code(error), provider=name) from None
    except httpx.HTTPError:
        raise upstream_error("UPSTREAM_NETWORK_ERROR", provider=name) from None
    except ValueError:
        raise upstream_error("UPSTREAM_INVALID_RESPONSE", provider=name) from None


def usage_for(name, data):
    raw = data.get("usageMetadata" if name == "gemini" else "usage")
    if not isinstance(raw, dict):
        return None
    fields = ("promptTokenCount", "candidatesTokenCount", "totalTokenCount") if name == "gemini" else (
        ("prompt_tokens", "completion_tokens", "total_tokens") if name == "deepseek" else
        ("input_tokens", "output_tokens", "total_tokens"))
    values = [raw.get(field) for field in fields]
    if any(type(value) is not int or value < 0 for value in values[:2]):
        return None
    if name == "claude":
        values[0] += sum(raw.get(field, 0) for field in ("cache_creation_input_tokens", "cache_read_input_tokens")
                         if type(raw.get(field, 0)) is int and raw.get(field, 0) >= 0)
    total = values[2] if type(values[2]) is int and values[2] >= 0 else values[0] + values[1]
    return {"inputTokens": values[0], "outputTokens": values[1], "totalTokens": total}


async def generate_reply(messages, instructions, mode, provider=None, *, api_key=None):
    name = selected_provider(provider)
    config, budget = PROVIDERS[name], 512 if mode == "quick" else 4096
    model = config.model(mode)
    system = "You are GameCoach, a helpful game coach.\n" + instructions + "\n" + (
        "Quick: answer briefly and directly." if mode == "quick" else
        "Coach: explain the current question in a few paragraphs unless more detail is requested.")
    # Send only ordinary conversation text, never provider-specific reasoning traces.
    history = [{"role": message["role"], "content": message["content"]} for message in messages]
    if config.protocol == "gemini":
        contents = []
        for message in history:
            role = "model" if message["role"] == "assistant" else "user"
            if contents and contents[-1]["role"] == role:
                contents[-1]["parts"].append({"text": message["content"]})
            else:
                contents.append({"role": role, "parts": [{"text": message["content"]}]})
        path = "models/" + quote(model, safe="") + ":generateContent"
        payload = {"contents": contents, "systemInstruction": {"parts": [{"text": system}]},
                   "generationConfig": {"maxOutputTokens": budget}}
    elif config.protocol == "chat":
        path = "chat/completions"
        payload = {"model": model, "messages": [{"role": "system", "content": system}, *history],
                   "max_tokens": budget, "stream": False, "thinking": {"type": "disabled"}}
    elif config.protocol == "responses":
        path = "responses"
        payload = {"model": model, "input": [{"role": "system", "content": system}, *history],
                   "max_output_tokens": budget, "stream": False, "store": False}
        if name == "grok" and model == "grok-4.3":
            payload["reasoning"] = {"effort": "none" if mode == "quick" else "low"}
    else:
        path = "messages"
        payload = {"model": model, "messages": history, "system": system,
                   "max_tokens": budget, "stream": False}
    data = await request_provider(name, path, payload, **({"api_key": api_key} if api_key is not None else {}))
    try:
        if config.protocol == "gemini":
            candidate = (data.get("candidates") or [{}])[0]
            reason = candidate.get("finishReason")
            text = "".join(part["text"] for part in candidate.get("content", {}).get("parts", [])
                           if not part.get("thought") and "text" in part)
            valid, limited = reason in ("STOP", "MAX_TOKENS"), reason == "MAX_TOKENS"
        elif config.protocol == "chat":
            choice = data["choices"][0]
            text, reason = choice["message"].get("content"), choice.get("finish_reason")
            valid, limited = reason in ("stop", "length"), reason == "length"
        elif config.protocol == "responses":
            chunks = [part for item in data.get("output", []) if item.get("type") == "message"
                      and item.get("role") == "assistant" for part in item.get("content", [])]
            if any(part.get("type") == "refusal" for part in chunks):
                raise upstream_error("UPSTREAM_INCOMPLETE_REPLY", provider=name)
            text = "".join(part["text"] for part in chunks if part.get("type") == "output_text")
            limited = (data.get("status") == "incomplete" and
                       (data.get("incomplete_details") or {}).get("reason") == "max_output_tokens")
            valid = data.get("status") == "completed" or limited
        else:
            text = "".join(part["text"] for part in data.get("content", []) if part.get("type") == "text")
            reason = data.get("stop_reason")
            valid, limited = reason in ("end_turn", "stop_sequence", "max_tokens"), reason == "max_tokens"
        if not valid or not isinstance(text, str) or not text.strip():
            raise upstream_error("UPSTREAM_INCOMPLETE_REPLY", provider=name)
        return {"content": text, "model": model, "upstream_provider": name,
                "finishReason": "length" if limited else "stop", "usage": usage_for(name, data)}
    except (ValueError, KeyError, IndexError, TypeError, AttributeError):
        raise upstream_error("UPSTREAM_INVALID_RESPONSE", provider=name) from None


async def check_connection(provider=None, *, api_key=None):
    name = selected_provider(provider)
    models = set(provider_info(name)["models"].values())
    if name in ("deepseek", "grok"):
        data = await request_provider(name, "models", **({"api_key": api_key} if api_key is not None else {}))
        if not isinstance(data.get("data"), list):
            raise upstream_error("UPSTREAM_INVALID_RESPONSE", provider=name)
        available = {item["id"] for item in data["data"] if isinstance(item, dict) and isinstance(item.get("id"), str)}
        if not models.issubset(available):
            raise upstream_error("UPSTREAM_MODEL_NOT_FOUND", provider=name)
    else:
        for model in models:
            data = await request_provider(name, "models/" + quote(model, safe=""), **({"api_key": api_key} if api_key is not None else {}))
            if name == "gemini":
                if "generateContent" not in data.get("supportedGenerationMethods", []):
                    raise upstream_error("UPSTREAM_MODEL_NOT_FOUND", provider=name)
            elif not isinstance(data.get("id"), str):
                raise upstream_error("UPSTREAM_INVALID_RESPONSE", provider=name)
    return {"status": "ok", "provider": name, "models": provider_info(name)["models"]}

"""Local GameCoach API. Run from this directory with uvicorn main:app."""

import hashlib
import json
import os
import secrets
import re
import sqlite3
import time
from contextlib import contextmanager
from collections import deque
from pathlib import Path
from typing import Literal
from uuid import UUID, uuid4

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator
from starlette.middleware.trustedhost import TrustedHostMiddleware

from providers import (PROVIDERS, ProviderName, check_connection, generate_reply,
                       provider_info, selected_provider)
from secure_config import Vault, production, setting, parse_frontend_origins
from training_memory import retrieve

ROOT = Path(__file__).resolve().parent
SESSION_SECONDS = 7 * 24 * 60 * 60
HISTORY_TURNS = 10
security = HTTPBearer(auto_error=False)


class BodyLimitMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        size = 0
        async def limited_receive():
            nonlocal size
            message = await receive()
            size += len(message.get("body", b""))
            if size > 12_000_000:
                raise HTTPException(413, {"code": "REQUEST_TOO_LARGE"})
            return message
        await self.app(scope, limited_receive, send)


class UserInfo(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    name: str = Field(min_length=1, max_length=24)
    profile: dict = Field(default_factory=dict)

    @field_validator("profile")
    @classmethod
    def limit_profile(cls, value):
        if len(json.dumps(value, ensure_ascii=False)) > 8000:
            raise ValueError("Profile is too large")
        return value


class ChatInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    conversation_id: UUID
    request_id: UUID
    message: str = Field(min_length=1, max_length=4000)
    context: str = Field(default="", max_length=24000)
    instructions: str = Field(default="", max_length=16000)
    mode: Literal["quick", "coach"] = "quick"
    user: UserInfo
    provider: ProviderName | None = None
    client_reply_id: str | None = Field(default=None, pattern=r"^[A-Za-z0-9-]{1,80}$")


class CredentialInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    api_key: SecretStr

    @field_validator("api_key")
    @classmethod
    def validate_key(cls, value):
        key = value.get_secret_value().strip()
        if not 8 <= len(key) <= 8192 or any(ord(char) < 33 or ord(char) > 126 for char in key):
            raise ValueError("Invalid credential")
        return SecretStr(key)


class StateInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: int = Field(ge=0)
    user: dict

    @field_validator("user")
    @classmethod
    def bounded_snapshot(cls, value):
        if len(json.dumps(value, ensure_ascii=False).encode()) > 10_000_000:
            raise ValueError("User backup is too large")
        return value


class ConversationInput(BaseModel):
    local_id: str | None = Field(default=None, pattern=r"^[A-Za-z0-9-]{1,80}$")


class RecoveryInput(BaseModel):
    recovery: SecretStr

    @field_validator("recovery")
    @classmethod
    def bounded_secret(cls, value):
        if not 32 <= len(value.get_secret_value()) <= 128:
            raise ValueError("Invalid recovery secret")
        return value


def clean_snapshot(raw):
    # Only data fields belong in backups. API credentials and access tokens have separate stores.
    allowed = ("id", "name", "profile", "memory", "draft", "drafts", "sessions", "updatedAt")
    clean = {key: raw[key] for key in allowed if key in raw}
    try:
        info = UserInfo(name=clean.get("name", "User"), profile=clean.get("profile", {}))
        clean["name"] = info.name
    except ValueError:
        raise HTTPException(422, {"code": "INVALID_INPUT"}) from None
    if (not isinstance(clean.get("sessions", []), list) or len(clean.get("sessions", [])) > 30 or
        any(not isinstance(item, dict) or not isinstance(item.get("id"), str) or not re.fullmatch(r"[A-Za-z0-9-]{1,80}", item["id"])
            or not isinstance(item.get("messages", []), list) or len(item.get("messages", [])) > 100
            or any(not isinstance(message, dict) for message in item.get("messages", []))
            for item in clean.get("sessions", [])) or
        not isinstance(clean.get("memory", {}), dict)):
        raise HTTPException(422, {"code": "INVALID_INPUT"})
    def remove_credentials(value):
        if isinstance(value, dict):
            return {key: remove_credentials(item) for key, item in value.items()
                    if key.lower().replace("_", "").replace("-", "") not in
                    ("apikey", "token", "authorization", "credentials", "accesstoken", "recoverytoken")}
        if isinstance(value, list):
            return [remove_credentials(item) for item in value]
        return value
    return remove_credentials(clean)


@contextmanager
def database(path):
    connection = sqlite3.connect(path, timeout=5)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA secure_delete = ON")
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def create_app(db_path=None, generator=None):
    origins = parse_frontend_origins(setting("GAMECOACH_CORS_ORIGINS"), allow_local_http=not production())
    vault = Vault()
    invite = setting("GAMECOACH_ACCESS_CODE")
    if production() and (len(invite) < 20 or not setting("GAMECOACH_ALLOWED_HOSTS").strip()):
        raise RuntimeError("Production requires a long access code and GAMECOACH_ALLOWED_HOSTS")
    path = Path(db_path or setting("GAMECOACH_DB", str(ROOT / "data" / "gamecoach.sqlite3")))
    path.parent.mkdir(parents=True, exist_ok=True)
    with database(path) as db:
        db.executescript("""
            PRAGMA journal_mode = WAL;
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, profile TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
                expires_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS conversations (
                id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
                version INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id TEXT NOT NULL REFERENCES conversations(id),
                request_id TEXT NOT NULL, request_hash TEXT NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
                content TEXT NOT NULL, context TEXT NOT NULL DEFAULT '',
                metadata TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL,
                UNIQUE(conversation_id, request_id, role)
            );
            CREATE INDEX IF NOT EXISTS conversation_owner ON conversations(user_id);
            CREATE INDEX IF NOT EXISTS message_history ON messages(conversation_id, id);
            CREATE TABLE IF NOT EXISTS credentials (
                user_id TEXT NOT NULL REFERENCES users(id), provider TEXT NOT NULL,
                encrypted_key TEXT NOT NULL, PRIMARY KEY(user_id, provider)
            );
            CREATE TABLE IF NOT EXISTS user_state (
                user_id TEXT PRIMARY KEY REFERENCES users(id), snapshot TEXT NOT NULL,
                version INTEGER NOT NULL, updated_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS user_recovery (
                user_id TEXT PRIMARY KEY REFERENCES users(id), recovery_hash TEXT NOT NULL UNIQUE
            );
        """)
        if "local_id" not in {row["name"] for row in db.execute("PRAGMA table_info(conversations)")}:
            db.execute("ALTER TABLE conversations ADD COLUMN local_id TEXT")
        db.execute("CREATE UNIQUE INDEX IF NOT EXISTS local_conversation ON conversations(user_id, local_id) WHERE local_id IS NOT NULL")
    app = FastAPI(title="GameCoach API")
    app.add_middleware(BodyLimitMiddleware)
    app.state.generate = generator or generate_reply
    app.state.vault = vault
    if origins:
        app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials=False,
                           allow_methods=["GET", "POST", "PUT", "DELETE"],
                           allow_headers=["Authorization", "Content-Type", "X-GameCoach-Access"], max_age=600)
    recent_calls = deque()
    if production():
        app.add_middleware(TrustedHostMiddleware, allowed_hosts=setting("GAMECOACH_ALLOWED_HOSTS").split(","))

    @app.exception_handler(RequestValidationError)
    async def invalid_request(request, error):
        # FastAPI's default response includes submitted values, potentially including a Key.
        return JSONResponse(status_code=422, content={"detail": {"code": "INVALID_INPUT"}})

    @app.middleware("http")
    async def protect_transport(request: Request, call_next):
        if production() and request.url.scheme != "https":
            return JSONResponse(status_code=400, content={"detail": {"code": "HTTPS_REQUIRED"}})
        length = request.headers.get("content-length", "0")
        if not length.isdigit() or int(length) > 12_000_000:
            return JSONResponse(status_code=413, content={"detail": {"code": "REQUEST_TOO_LARGE"}})
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        if production():
            response.headers["Strict-Transport-Security"] = "max-age=31536000"
        return response

    migrated = set()

    def encrypt_legacy_user(user_id):
        if user_id in migrated:
            return
        with database(path) as db:
            user = db.execute("SELECT name, profile FROM users WHERE id = ?", (user_id,)).fetchone()
            if user:
                db.execute("UPDATE users SET name = ?, profile = ? WHERE id = ?",
                           (vault.seal(vault.open(user["name"])), vault.seal(vault.open(user["profile"])), user_id))
            rows = db.execute("SELECT m.id, m.content, m.context, m.metadata FROM messages m JOIN conversations c "
                              "ON c.id = m.conversation_id WHERE c.user_id = ?", (user_id,)).fetchall()
            for row in rows:
                if any(not row[field].startswith("enc:") for field in ("content", "context", "metadata")):
                    db.execute("UPDATE messages SET content = ?, context = ?, metadata = ? WHERE id = ?",
                               (*[vault.seal(vault.open(row[field])) for field in ("content", "context", "metadata")], row["id"]))
        migrated.add(user_id)

    def current_user(credentials: HTTPAuthorizationCredentials | None = Depends(security)):
        token = credentials.credentials if credentials else ""
        with database(path) as db:
            row = db.execute("SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?",
                             (hashlib.sha256(token.encode()).hexdigest(), int(time.time()))).fetchone()
        if not row:
            raise HTTPException(401, "Session is missing, expired or revoked",
                                headers={"WWW-Authenticate": "Bearer"})
        encrypt_legacy_user(row["user_id"])
        with database(path) as db:
            db.execute("UPDATE sessions SET expires_at = ? WHERE token_hash = ?",
                       (int(time.time()) + SESSION_SECONDS, hashlib.sha256(token.encode()).hexdigest()))
        return row["user_id"]

    def user_key(user_id, provider):
        with database(path) as db:
            row = db.execute("SELECT encrypted_key FROM credentials WHERE user_id = ? AND provider = ?", (user_id, provider)).fetchone()
        return vault.open(row["encrypted_key"]) if row else None

    def owned_conversation(db, conversation_id, user_id):
        row = db.execute("SELECT * FROM conversations WHERE id = ? AND user_id = ?",
                         (str(conversation_id), user_id)).fetchone()
        if not row:
            raise HTTPException(404, "Conversation not found")
        return row

    @app.get("/api/providers")
    def list_providers():
        return {"default_provider": selected_provider(),
                "providers": [provider_info(name) for name in PROVIDERS]}

    @app.get("/api/health")
    def health(provider: ProviderName | None = None):
        name = selected_provider(provider)
        info = provider_info(name)
        return {"status": "ok", "provider": name, "model_configured": info["configured"],
                "models": info["models"]}

    @app.get("/api/connection")
    async def connection(provider: ProviderName | None = None, user_id=Depends(current_user)):
        name = selected_provider(provider)
        key = user_key(user_id, name)
        return await check_connection(name, **({"api_key": key} if key is not None else {}))

    @app.get("/api/credentials")
    def credential_status(user_id=Depends(current_user)):
        with database(path) as db:
            own = {row["provider"] for row in db.execute("SELECT provider FROM credentials WHERE user_id = ?", (user_id,))}
        return {name: {"saved": name in own, "server_default": provider_info(name)["configured"]} for name in PROVIDERS}

    @app.put("/api/credentials/{provider}")
    def save_credential(provider: ProviderName, body: CredentialInput, request: Request, user_id=Depends(current_user)):
        if request.url.scheme != "https" and request.url.hostname not in ("localhost", "127.0.0.1", "::1", "testserver"):
            raise HTTPException(400, {"code": "HTTPS_REQUIRED"})
        encrypted = vault.seal(body.api_key.get_secret_value())
        with database(path) as db:
            db.execute("INSERT INTO credentials VALUES (?, ?, ?) ON CONFLICT(user_id, provider) DO UPDATE SET encrypted_key = excluded.encrypted_key",
                       (user_id, provider, encrypted))
        return {"provider": provider, "saved": True}

    @app.delete("/api/credentials/{provider}", status_code=204)
    def delete_credential(provider: ProviderName, user_id=Depends(current_user)):
        with database(path) as db:
            db.execute("DELETE FROM credentials WHERE user_id = ? AND provider = ?", (user_id, provider))

    @app.post("/api/sessions", status_code=201)
    def start_session(user: UserInfo, request: Request):
        if invite and not secrets.compare_digest(request.headers.get("X-GameCoach-Access", "").encode(), invite.encode()):
            raise HTTPException(403, {"code": "ACCESS_CODE_REQUIRED"})
        token, user_id, recovery = secrets.token_urlsafe(32), str(uuid4()), secrets.token_urlsafe(32)
        created = int(time.time())
        with database(path) as db:
            db.execute("INSERT INTO users VALUES (?, ?, ?, ?)",
                       (user_id, vault.seal(user.name), vault.seal(json.dumps(user.profile, ensure_ascii=False)), created))
            db.execute("INSERT INTO sessions VALUES (?, ?, ?)",
                       (hashlib.sha256(token.encode()).hexdigest(), user_id, created + SESSION_SECONDS))
            db.execute("INSERT INTO user_recovery VALUES (?, ?)", (user_id, hashlib.sha256(recovery.encode()).hexdigest()))
        return {"token": token, "user_id": user_id, "expires_at": created + SESSION_SECONDS, "recovery": recovery}

    @app.post("/api/sessions/restore")
    def restore_session(body: RecoveryInput, request: Request):
        if invite and not secrets.compare_digest(request.headers.get("X-GameCoach-Access", "").encode(), invite.encode()):
            raise HTTPException(403, {"code": "ACCESS_CODE_REQUIRED"})
        token, created = secrets.token_urlsafe(32), int(time.time())
        with database(path) as db:
            row = db.execute("SELECT user_id FROM user_recovery WHERE recovery_hash = ?",
                             (hashlib.sha256(body.recovery.get_secret_value().encode()).hexdigest(),)).fetchone()
            if not row:
                raise HTTPException(401, {"code": "RECOVERY_INVALID"})
            db.execute("INSERT INTO sessions VALUES (?, ?, ?)",
                       (hashlib.sha256(token.encode()).hexdigest(), row["user_id"], created + SESSION_SECONDS))
        return {"token": token, "user_id": row["user_id"], "expires_at": created + SESSION_SECONDS}

    @app.delete("/api/sessions/current", status_code=204)
    def revoke_session(credentials: HTTPAuthorizationCredentials = Depends(security),
                       user_id=Depends(current_user)):
        with database(path) as db:
            db.execute("DELETE FROM sessions WHERE token_hash = ?",
                       (hashlib.sha256(credentials.credentials.encode()).hexdigest(),))

    @app.post("/api/conversations", status_code=201)
    def new_conversation(body: ConversationInput | None = None, user_id=Depends(current_user)):
        conversation_id, created = str(uuid4()), int(time.time())
        with database(path) as db:
            local_id = body.local_id if body else None
            if local_id:
                existing = db.execute("SELECT id FROM conversations WHERE user_id = ? AND local_id = ?", (user_id, local_id)).fetchone()
                if existing:
                    return {"conversation_id": existing["id"]}
            db.execute("INSERT INTO conversations(id, user_id, created_at, local_id) VALUES (?, ?, ?, ?)",
                       (conversation_id, user_id, created, local_id))
        return {"conversation_id": conversation_id}

    @app.get("/api/conversations")
    def list_conversations(user_id=Depends(current_user)):
        with database(path) as db:
            return [dict(row) for row in db.execute(
                "SELECT id, created_at FROM conversations WHERE user_id = ? ORDER BY created_at, id", (user_id,))]

    @app.get("/api/conversations/{conversation_id}/messages")
    def list_messages(conversation_id: UUID, user_id=Depends(current_user),
                      after: int = 0, limit: int = 100):
        if after < 0 or not 1 <= limit <= 100:
            raise HTTPException(422, "Use after >= 0 and limit between 1 and 100")
        with database(path) as db:
            owned_conversation(db, conversation_id, user_id)
            return [{**dict(row), "content": vault.open(row["content"])} for row in db.execute(
                "SELECT id, role, content, created_at FROM messages "
                "WHERE conversation_id = ? AND id > ? ORDER BY id LIMIT ?",
                (str(conversation_id), after, limit))]

    @app.get("/api/user-state")
    def get_user_state(user_id=Depends(current_user)):
        with database(path) as db:
            row = db.execute("SELECT snapshot, version FROM user_state WHERE user_id = ?", (user_id,)).fetchone()
            snapshot = json.loads(vault.open(row["snapshot"])) if row else None
            recovered = False
            if snapshot:
                for local in snapshot.get("sessions", []):
                    conversation = db.execute("SELECT id FROM conversations WHERE user_id = ? AND local_id = ?",
                                              (user_id, local.get("id"))).fetchone()
                    if not conversation:
                        continue
                    replies = db.execute("SELECT metadata FROM messages WHERE conversation_id = ? AND role = 'assistant' ORDER BY id DESC LIMIT 50",
                                         (conversation["id"],)).fetchall()
                    for saved in replies:
                        reply = json.loads(vault.open(saved["metadata"]))
                        reply_id = reply.get("client_reply_id")
                        if not reply_id:
                            continue
                        target = next((message for message in local.get("messages", []) if isinstance(message, dict) and message.get("id") == reply_id), None)
                        if target and target.get("status") in ("pending", "error"):
                            for field in ("content", "model", "provider", "isDemo", "usage", "usedMemories", "finishReason"):
                                if field in reply:
                                    target[field] = reply[field]
                            target["upstreamProvider"] = reply.get("upstream_provider")
                            target["status"] = "complete"
                            recovered = True
        return {"version": row["version"] if row else 0,
                "user": snapshot, "recovered_replies": recovered}

    @app.put("/api/user-state")
    def put_user_state(body: StateInput, user_id=Depends(current_user)):
        snapshot = clean_snapshot(body.user)
        with database(path) as db:
            version = body.version + 1
            changed = db.execute("INSERT INTO user_state SELECT ?, ?, ?, ? WHERE ? = 0 OR EXISTS "
                                 "(SELECT 1 FROM user_state WHERE user_id = ? AND version = ?) "
                                 "ON CONFLICT(user_id) DO UPDATE SET snapshot = excluded.snapshot, version = excluded.version, "
                                 "updated_at = excluded.updated_at WHERE user_state.version = ?",
                                 (user_id, vault.seal(json.dumps(snapshot, ensure_ascii=False)), version, int(time.time()),
                                  body.version, user_id, body.version, body.version))
            if changed.rowcount != 1:
                raise HTTPException(409, {"code": "STATE_CONFLICT"})
            # Import each browser conversation once. Subsequent saves never overwrite server history.
            for local in snapshot.get("sessions", [])[-30:]:
                if not isinstance(local, dict) or not re.fullmatch(r"[A-Za-z0-9-]{1,80}", str(local.get("id", ""))):
                    continue
                if db.execute("SELECT id FROM conversations WHERE user_id = ? AND local_id = ?",
                              (user_id, local["id"])).fetchone():
                    continue
                conversation_id = str(uuid4())
                created = int(time.time())
                db.execute("INSERT INTO conversations(id, user_id, created_at, local_id) VALUES (?, ?, ?, ?)",
                           (conversation_id, user_id, created, local["id"]))
                pending = None
                for message in local.get("messages", [])[-100:]:
                    if not isinstance(message, dict) or message.get("localOnly"):
                        continue
                    if message.get("role") == "user":
                        pending = message
                    elif (message.get("role") == "coach" and pending and message.get("isDemo") is False
                          and message.get("status", "complete") == "complete"):
                        question, answer = pending.get("content"), message.get("content")
                        pending = None
                        if not isinstance(question, str) or not isinstance(answer, str) or not question.strip() or not answer.strip():
                            continue
                        request_id = str(uuid4())
                        for role, content in (("user", question[:6000]), ("assistant", answer[:6000])):
                            db.execute("INSERT INTO messages(conversation_id, request_id, request_hash, role, content, context, metadata, created_at) "
                                       "VALUES (?, ?, 'imported', ?, ?, ?, ?, ?)",
                                       (conversation_id, request_id, role, vault.seal(content), vault.seal(""), vault.seal("{}"), created))
        return {"version": version}

    @app.post("/api/chat")
    async def chat(body: ChatInput, user_id=Depends(current_user)):
        conversation_id, request_id = str(body.conversation_id), str(body.request_id)
        provider = selected_provider(body.provider)
        canonical = body.model_dump(mode="json")
        canonical["provider"] = provider
        fingerprint = hashlib.sha256(json.dumps(canonical, sort_keys=True).encode()).hexdigest()
        with database(path) as db:
            conversation = owned_conversation(db, conversation_id, user_id)
            cached = db.execute("SELECT request_hash, metadata FROM messages "
                                "WHERE conversation_id = ? AND request_id = ? AND role = 'assistant'",
                                (conversation_id, request_id)).fetchone()
            if cached:
                if cached["request_hash"] != fingerprint:
                    raise HTTPException(409, "request_id was already used for different input")
                return json.loads(vault.open(cached["metadata"]))
            rows = db.execute("SELECT role, content, context FROM messages WHERE conversation_id = ? "
                              "ORDER BY id DESC LIMIT ?", (conversation_id, HISTORY_TURNS * 2)).fetchall()
            state = db.execute("SELECT snapshot FROM user_state WHERE user_id = ?", (user_id,)).fetchone()
        history = [{"role": row["role"], "content": "\n\n".join(filter(None, [vault.open(row["context"]), vault.open(row["content"])]))}
                   for row in reversed(rows)]
        memory = json.loads(vault.open(state["snapshot"])).get("memory", {}) if state else {}
        prior_question = next((vault.open(row["content"]) for row in rows if row["role"] == "user"), "")
        memory_text, used_memories = retrieve(memory, body.message + "\n" + prior_question, body.mode)
        history.append({"role": "user", "content": "\n\n".join(filter(None, [body.context, memory_text, body.message]))})
        limit = int(setting("GAMECOACH_MAX_REQUESTS_PER_MINUTE", "30" if production() else "0"))
        if limit > 0:
            now = time.monotonic()
            while recent_calls and recent_calls[0] <= now - 60:
                recent_calls.popleft()
            if len(recent_calls) >= limit:
                raise HTTPException(429, {"code": "RATE_LIMITED"})
            recent_calls.append(now)
        # The model call does not hold a SQLite transaction or write lock.
        key = user_key(user_id, provider)
        result = await app.state.generate(history, body.instructions, body.mode, provider,
                                          **({"api_key": key} if key is not None else {}))
        if not isinstance(result, dict) or not isinstance(result.get("content"), str) or not result["content"].strip():
            raise HTTPException(502, "Model returned an empty answer")
        reply = {**result, "conversation_id": conversation_id, "request_id": request_id,
                 "mode": body.mode, "provider": "backend", "upstream_provider": provider, "isDemo": False,
                 "usedMemories": used_memories, "client_reply_id": body.client_reply_id}
        created = int(time.time())
        with database(path) as db:
            # Optimistic versioning prevents simultaneous turns from saving stale context.
            updated = db.execute("UPDATE conversations SET version = version + 1 "
                                 "WHERE id = ? AND user_id = ? AND version = ?",
                                 (conversation_id, user_id, conversation["version"]))
            if updated.rowcount != 1:
                raise HTTPException(409, "Conversation changed during generation; retry the request")
            db.execute("UPDATE users SET name = ?, profile = ? WHERE id = ?",
                       (vault.seal(body.user.name), vault.seal(json.dumps(body.user.profile, ensure_ascii=False)), user_id))
            for role, content, context, metadata in (
                ("user", body.message, body.context, "{}"),
                ("assistant", result["content"], "", json.dumps(reply, ensure_ascii=False)),
            ):
                db.execute("INSERT INTO messages(conversation_id, request_id, request_hash, role, "
                           "content, context, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                           (conversation_id, request_id, fingerprint, role, vault.seal(content), vault.seal(context), vault.seal(metadata), created))
        return reply

    @app.get("/")
    def index():
        return RedirectResponse("/frontend/index.html")

    # Only public asset directories are served; the database, .env and source stay private.
    for folder in ("frontend", "resources", "ai-core", "skill", "memory"):
        app.mount("/" + folder, StaticFiles(directory=ROOT.parent / folder), name=folder)
    return app


app = create_app()

"""Private runtime configuration and authenticated encryption for user data."""

import json
import os
from functools import lru_cache
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException


@lru_cache(maxsize=4)
def _read_config(path):
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        if not isinstance(data, dict) or any(not isinstance(value, str) for value in data.values()):
            raise ValueError()
        return data
    except (OSError, ValueError):
        raise RuntimeError("Cannot read private server configuration; check its path and JSON format") from None


def setting(name, default=""):
    if name in os.environ:
        return os.environ[name]
    path = os.getenv("GAMECOACH_CONFIG_FILE", "").strip()
    return _read_config(path).get(name, default) if path else default


def production():
    return setting("GAMECOACH_ENV") == "production"


class Vault:
    def __init__(self):
        key = setting("GAMECOACH_ENCRYPTION_KEY").strip()
        if not key:
            if production():
                raise RuntimeError("Production requires GAMECOACH_ENCRYPTION_KEY")
            path = Path(__file__).resolve().parent / ".secrets" / "storage.key"
            path.parent.mkdir(parents=True, exist_ok=True)
            try:
                with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as stream:
                    stream.write(Fernet.generate_key())
            except FileExistsError:
                pass
            key = path.read_text(encoding="ascii").strip()
        try:
            self.cipher = Fernet(key.encode("ascii"))
        except (ValueError, UnicodeError):
            raise RuntimeError("Invalid GAMECOACH_ENCRYPTION_KEY") from None

    def seal(self, value):
        return "enc:" + self.cipher.encrypt(value.encode("utf-8")).decode("ascii")

    def open(self, value):
        if not value.startswith("enc:"):
            return value  # Existing databases are encrypted during startup migration.
        try:
            return self.cipher.decrypt(value[4:].encode("ascii")).decode("utf-8")
        except (InvalidToken, ValueError, UnicodeError):
            raise HTTPException(503, {"code": "STORAGE_KEY_ERROR"}) from None

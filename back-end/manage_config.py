"""Create a private deployment config without putting keys in command arguments."""

import argparse
import getpass
import json
import os
import secrets
import re
from pathlib import Path

from cryptography.fernet import Fernet
from providers import PROVIDERS
from secure_config import parse_frontend_origins


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--provider", choices=PROVIDERS, default="deepseek")
    parser.add_argument("--domain", required=True, help="Your actual HTTPS hostname, without scheme or path")
    parser.add_argument("--frontend-origin", action="append", default=[], help="Allowed HTTPS frontend origin, without a path; repeat for multiple origins")
    parser.add_argument("--output", type=Path, default=Path(__file__).parent / ".secrets" / "server.json")
    args = parser.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?", args.domain):
        parser.error("Use a hostname without a scheme, port or wildcard")
    if args.output.exists():
        parser.error("Config already exists; it was not overwritten")
    try:
        origins = parse_frontend_origins(",".join(args.frontend_origin))
    except ValueError as error:
        parser.error(str(error))
    config = PROVIDERS[args.provider]
    key = os.getenv(config.key_env) or getpass.getpass(config.key_env + " (hidden): ")
    if not key.strip():
        parser.error("An API key is required")
    data = {"GAMECOACH_ENV": "production", "GAMECOACH_PROVIDER": args.provider,
            "GAMECOACH_ALLOWED_HOSTS": args.domain, "GAMECOACH_ACCESS_CODE": secrets.token_urlsafe(24),
            "GAMECOACH_ENCRYPTION_KEY": Fernet.generate_key().decode(), config.key_env: key.strip(),
            "GAMECOACH_MAX_REQUESTS_PER_MINUTE": "30"}
    if origins:
        data["GAMECOACH_CORS_ORIGINS"] = ",".join(origins)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with os.fdopen(os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w", encoding="utf-8") as stream:
        json.dump(data, stream, indent=2)
    print("Private configuration created:", args.output.resolve())
    print("Keys were not printed. Keep this file separate from the public deployment package.")


if __name__ == "__main__":
    main()

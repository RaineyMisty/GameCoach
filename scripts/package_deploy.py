"""Build a source-only deployment archive using an explicit allowlist."""

import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FILES = ["Dockerfile", "compose.yaml", "Caddyfile", ".dockerignore", ".env.example", "DEPLOYMENT.md", "CHANGELOG.md", "LICENSE",
         "deploy/gamecoach.service.example",
         "back-end/main.py", "back-end/providers.py", "back-end/secure_config.py", "back-end/training_memory.py", "back-end/manage_config.py",
         "back-end/requirements.txt", "frontend/vendor/marked-LICENSE.md"]
PUBLIC = ("frontend", "ai-core", "skill", "memory", "resources")


def package(target=None):
    destination = Path(target or ROOT / "dist" / "gamecoach-deploy.zip")
    destination.parent.mkdir(parents=True, exist_ok=True)
    paths = [ROOT / name for name in FILES]
    allowed = {".js", ".css", ".html", ".png", ".jpg", ".jpeg", ".svg", ".webp", ".woff", ".woff2"}
    for folder in PUBLIC:
        paths.extend(path for path in (ROOT / folder).rglob("*") if path.is_file() and not path.is_symlink()
                     and (path.suffix.lower() in allowed or (folder == "resources" and path.name == "sources.json"))
                     and not any(part.startswith(".") for part in path.relative_to(ROOT).parts))
    with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(paths):
            archive.write(path, path.relative_to(ROOT).as_posix())
    return destination


if __name__ == "__main__":
    print(package())

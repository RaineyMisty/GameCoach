import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


class DeploymentTests(unittest.TestCase):
    def test_private_config_never_prints_credentials_or_overwrites_a_master_key(self):
        with tempfile.TemporaryDirectory() as folder:
            destination = Path(folder) / "server.json"
            command = [sys.executable, str(ROOT / "back-end/manage_config.py"), "--provider", "deepseek",
                       "--domain", "coach.example.com", "--output", str(destination)]
            environment = {**os.environ, "DEEPSEEK_API_KEY": "fake-private-deployment-api-key"}
            result = subprocess.run(command, env=environment, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            config = json.loads(destination.read_text(encoding="utf-8"))
            for name in ("DEEPSEEK_API_KEY", "GAMECOACH_ENCRYPTION_KEY", "GAMECOACH_ACCESS_CODE"):
                self.assertNotIn(config[name], result.stdout + result.stderr)
            self.assertEqual(config["GAMECOACH_PROVIDER"], "deepseek")
            self.assertEqual(config["GAMECOACH_ENV"], "production")
            self.assertGreaterEqual(len(config["GAMECOACH_ACCESS_CODE"]), 20)
            again = subprocess.run(command, env=environment, capture_output=True, text=True)
            self.assertNotEqual(again.returncode, 0)
            self.assertEqual(json.loads(destination.read_text(encoding="utf-8")), config)

    def test_deploy_archive_is_allowlisted_without_private_configs_keys_or_user_data(self):
        spec = importlib.util.spec_from_file_location("package_deploy", ROOT / "scripts/package_deploy.py")
        package = importlib.util.module_from_spec(spec); spec.loader.exec_module(package)
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            for name in package.FILES:
                path = root / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_text("public source")
            for name in (".env", "back-end/.secrets/server.json", "back-end/data/gamecoach.sqlite3", "users/private.json",
                         "frontend/private-config.json", "frontend/.secrets/api.js"):
                path = root / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_text("do-not-package-private-key")
            (root / "frontend/public.js").write_text("public JS")
            for name in ("ai-core", "skill", "memory", "resources"):
                (root / name).mkdir(exist_ok=True)
            with patch.object(package, "ROOT", root):
                destination = package.package(root / "out.zip")
            with zipfile.ZipFile(destination) as archive:
                self.assertIn("frontend/public.js", archive.namelist())
                for name in archive.namelist():
                    self.assertNotIn(".secrets", name)
                    self.assertNotIn(".sqlite3", name)
                    self.assertNotEqual(name, ".env")
                    self.assertNotIn("do-not-package-private-key", archive.read(name).decode())

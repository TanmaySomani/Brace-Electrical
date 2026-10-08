import os
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]


class LauncherTests(unittest.TestCase):
    def run_cli(self, *args):
        env = {
            k: v
            for k, v in os.environ.items()
            if k not in {"OPENAI_API_KEY", "OPENAI_MODEL", "BRACE_AI"}
        }
        return subprocess.run(
            [sys.executable, str(ROOT / "run.py"), *args],
            env=env,
            capture_output=True,
            text=True,
            timeout=10,
        )

    def test_help_describes_recruiter_options(self):
        result = self.run_cli("--help")
        self.assertEqual(result.returncode, 0)
        self.assertIn("--fresh-demo", result.stdout)

    def test_ai_requires_explicit_credentials(self):
        result = self.run_cli("--ai")
        self.assertEqual(result.returncode, 2)
        self.assertIn("OPENAI_API_KEY", result.stderr)

    def test_invalid_port_has_clear_error(self):
        result = self.run_cli("--port", "0")
        self.assertEqual(result.returncode, 2)
        self.assertIn("between 1 and 65535", result.stderr)


if __name__ == "__main__":
    unittest.main()

"""HTTP integration and concurrency checks against temporary demo data."""
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app


class QuietHandler(app.Handler):
    def log_message(self, *_):
        pass


class HTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.previous_db = app.DB
        app.DB = Path(cls.temp.name) / "http.sqlite3"
        cls.env = patch.dict(os.environ, {"BRACE_AI": "0"})
        cls.env.start()
        app.prepare()
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"
        cls.thread = threading.Thread(
            target=cls.server.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True
        )
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)
        cls.env.stop()
        app.DB = cls.previous_db
        cls.temp.cleanup()

    def request(self, path, data=None, extra=None):
        headers = {"Content-Type": "application/json", "X-Resolve-Client": "local-ui"}
        headers.update(extra or {})
        req = Request(
            self.base + path,
            data=json.dumps(data).encode() if data is not None else None,
            headers=headers,
        )
        try:
            response = urlopen(req, timeout=5)
        except HTTPError as error:
            response = error
        with response:
            raw = response.read()
            return (
                response.status,
                json.loads(raw)
                if response.headers.get_content_type() == "application/json"
                else raw,
            )

    def intake(self):
        return dict(
            event_id=uuid.uuid4().hex,
            sender="accounts@hawthorne.example",
            subject="INV-1042",
            body="Please provide the purchase order.",
        )

    def test_assistant_endpoint_returns_scoped_briefing(self):
        _, state = self.request("/api/state")
        case = next(c for c in state["cases"] if c["invoice_id"] == "INV-1043")
        code, answer = self.request(
            "/api/cases/" + case["id"] + "/ask",
            {"question": "Explain the discrepancy", "version": case["version"]},
        )
        self.assertEqual(code, 200)
        self.assertEqual(answer["mode"], "offline")
        self.assertEqual(answer["case_id"], case["id"])
        self.assertNotIn("INV-1042", json.dumps(answer))

    def test_workflow_is_served(self):
        code, html = self.request("/workflow")
        self.assertEqual(code, 200)
        self.assertIn(b"Brace Electrical", html)

    def test_state_contains_brand_jobs_and_scoped_evidence(self):
        code, data = self.request("/api/state")
        self.assertEqual(code, 200)
        self.assertEqual(data["business"], "Brace Electrical")
        self.assertEqual(len(data["projects"]), 6)
        self.assertEqual(data["engine"], "Rules-based demo")

    def test_app_and_bundled_fonts_are_served(self):
        for path in [
            "/",
            "/style.css",
            "/app.js",
            "/favicon.svg",
            "/fonts/Manrope-Regular.ttf",
        ]:
            code, body = self.request(path)
            self.assertEqual(code, 200)
            self.assertGreater(len(body), 100)

    def test_unknown_and_private_files_are_not_served(self):
        for path in ["/app.py", "/brace.sqlite3", "/.env", "/../../app.py"]:
            self.assertEqual(self.request(path)[0], 404)

    def test_cross_origin_mutation_rejected(self):
        self.assertEqual(
            self.request("/api/seed", {}, {"Origin": "https://another.example"})[0], 403
        )
        self.assertEqual(
            self.request("/api/seed", {}, {"X-Resolve-Client": ""})[0], 403
        )

    def test_invalid_payload_returns_actionable_error(self):
        code, data = self.request("/api/ingest", {"sender": "not an email"})
        self.assertEqual(code, 400)
        self.assertIn("required", data["error"])

    def test_concurrent_duplicate_intake_creates_one_case(self):
        data = self.intake()
        with ThreadPoolExecutor(max_workers=4) as pool:
            responses = list(
                pool.map(lambda _: self.request("/api/ingest", data), range(4))
            )
        self.assertTrue(all(code == 200 for code, _ in responses))
        _, state = self.request("/api/state")
        cases = [c for c in state["cases"] if c["event_id"] == data["event_id"]]
        self.assertEqual(len(cases), 1)
        self.assertEqual(cases[0]["status"], "review")

    def test_concurrent_approval_creates_one_outbox_message(self):
        data = self.intake()
        _, state = self.request("/api/ingest", data)
        case = next(c for c in state["cases"] if c["event_id"] == data["event_id"])
        action = {"version": case["version"], "draft": "Reviewed synthetic reply."}
        path = f"/api/cases/{case['id']}/approve"
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: self.request(path, action), range(2)))
        self.assertEqual(sorted(code for code, _ in results), [200, 400])
        _, state = self.request("/api/state")
        outbox = [o for o in state["outbox"] if o["case_id"] == case["id"]]
        self.assertEqual(len(outbox), 1)
        self.assertEqual(outbox[0]["body"], action["draft"])

    def test_preconfigured_key_does_not_enable_paid_ai(self):
        with patch.dict(
            os.environ,
            {
                "OPENAI_API_KEY": "sentinel-not-a-key",
                "OPENAI_MODEL": "test-model",
                "BRACE_AI": "0",
            },
        ):
            with patch.object(
                app,
                "urlopen",
                side_effect=AssertionError("Offline demo must not call a provider"),
            ):
                category, engine = app.classify("Please send the purchase order.")
        self.assertEqual((category, engine), ("missing_po", "Rules-based demo"))

    def test_restart_preserves_approved_decisions(self):
        data = self.intake()
        _, state = self.request("/api/ingest", data)
        case = next(c for c in state["cases"] if c["event_id"] == data["event_id"])
        self.request(
            f"/api/cases/{case['id']}/approve",
            {"version": case["version"], "draft": "Persisted test reply."},
        )
        app.prepare()
        _, state = self.request("/api/state")
        saved = next(c for c in state["cases"] if c["id"] == case["id"])
        self.assertEqual(saved["status"], "approved")
        self.assertEqual(saved["draft"], "Persisted test reply.")


if __name__ == "__main__":
    unittest.main()

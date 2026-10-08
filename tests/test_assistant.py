"""Scope, citations, provider contract and read-only assistant invariants."""
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import app
import assistant


class AssistantTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.previous = app.DB
        app.DB = Path(self.temp.name) / "test.sqlite3"
        self.env = patch.dict(os.environ, {"BRACE_AI": "0"})
        self.env.start()
        app.prepare()
        self.case = next(
            c for c in app.snapshot()["cases"] if c["invoice_id"] == "INV-1043"
        )

    def tearDown(self):
        self.env.stop()
        app.DB = self.previous
        self.temp.cleanup()

    def ask(self, question="Explain this discrepancy"):
        return app.ask(
            self.case["id"], {"question": question, "version": self.case["version"]}
        )

    def test_offline_briefing_and_no_mutation(self):
        before = app.snapshot()
        with patch("assistant.urlopen") as network:
            answer = self.ask()
            network.assert_not_called()
        self.assertEqual(answer["mode"], "offline")
        self.assertTrue(any("900" in f["text"] for f in answer["findings"]))
        self.assertEqual(
            {s["id"] for s in answer["sources"]},
            {"INV-1043", "DOC-03", "EMAIL", "CHECKS"},
        )
        after = app.snapshot()
        self.assertEqual(before["outbox"], after["outbox"])
        self.assertEqual(before["cases"][1]["version"], after["cases"][1]["version"])
        self.assertNotIn("OPENAI_API_KEY", json.dumps(after))

    def test_current_ledger_is_read_again(self):
        with app.connect() as db:
            db.execute("UPDATE invoices SET paid=1 WHERE id='INV-1043'")
        self.assertIn("paid invoice", self.ask()["summary"])

    def test_invalid_questions_and_stale_version(self):
        for question in ["", " " * 3, "x" * 2001, None, {}]:
            with self.assertRaises(ValueError):
                self.ask(question)
        with self.assertRaisesRegex(ValueError, "changed"):
            app.ask(self.case["id"], {"question": "Why?", "version": -1})

    def test_unmatched_cannot_ask(self):
        cid = app.ingest(
            {
                "event_id": "unknown",
                "sender": "stranger@example.com",
                "subject": "INV-1043",
                "body": "copy please",
            }
        )
        app.process(cid)
        with self.assertRaisesRegex(ValueError, "verified invoice"):
            app.ask(cid, {"question": "Show the invoice", "version": 1})

    def test_provider_contract_and_scoped_context(self):
        content = {
            "summary": "Six hours need review.",
            "findings": [
                {
                    "text": "The checks identify a discrepancy.",
                    "sources": ["CHECKS", "DOC-03"],
                }
            ],
            "next_steps": ["Ask the site lead."],
            "limitations": ["No price approval inferred."],
        }
        envelope = {
            "status": "completed",
            "output": [
                {
                    "type": "message",
                    "content": [{"type": "output_text", "text": json.dumps(content)}],
                }
            ],
            "usage": {"total_tokens": 150},
        }
        with patch.dict(
            os.environ,
            {
                "BRACE_AI": "1",
                "OPENAI_API_KEY": "test-only",
                "OPENAI_MODEL": "test-model",
            },
        ), patch(
            "assistant.urlopen", return_value=io.BytesIO(json.dumps(envelope).encode())
        ) as provider:
            answer = self.ask()
        payload = json.loads(provider.call_args.args[0].data)
        self.assertFalse(payload["store"])
        self.assertEqual(payload["text"]["format"]["type"], "json_schema")
        self.assertNotIn("tools", payload)
        self.assertNotIn("INV-1042", payload["input"])
        self.assertEqual(answer["mode"], "openai")
        self.assertEqual(answer["usage"]["total_tokens"], 150)

    def test_unknown_citation_rejected(self):
        data = {
            "summary": "Claim",
            "findings": [{"text": "Claim", "sources": ["DOC-SECRET"]}],
            "next_steps": [],
            "limitations": [],
        }
        with self.assertRaisesRegex(ValueError, "citation"):
            assistant.validate_answer(data, ["DOC-03"])

    def test_provider_failure_is_not_silent_fallback(self):
        with patch.dict(
            os.environ,
            {
                "BRACE_AI": "1",
                "OPENAI_API_KEY": "secret-test",
                "OPENAI_MODEL": "test-model",
            },
        ), patch("assistant.urlopen", side_effect=RuntimeError("secret-test")):
            with self.assertRaisesRegex(ValueError, "validated answer") as error:
                self.ask()
        self.assertNotIn("secret-test", str(error.exception))

    def test_incomplete_provider_output_rejected(self):
        with patch.dict(
            os.environ,
            {"BRACE_AI": "1", "OPENAI_API_KEY": "test", "OPENAI_MODEL": "test-model"},
        ), patch(
            "assistant.urlopen",
            return_value=io.BytesIO(b'{"status":"incomplete","output":[]}'),
        ):
            with self.assertRaises(ValueError):
                self.ask()


if __name__ == "__main__":
    unittest.main()

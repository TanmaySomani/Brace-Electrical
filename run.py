#!/usr/bin/env python3
"""Portable launcher. Defaults to offline demo mode; no third-party dependencies."""
import argparse
import os
from pathlib import Path
import sys
import tempfile
import threading
import webbrowser
from http.server import ThreadingHTTPServer


def main():
    if sys.version_info < (3, 10):
        print("Brace Electrical requires Python 3.10 or newer.", file=sys.stderr)
        return 1
    parser = argparse.ArgumentParser(
        description="Run the Brace Electrical recruiter demo locally."
    )
    parser.add_argument(
        "--port", type=int, default=8765, help="Local port (default: 8765)"
    )
    parser.add_argument(
        "--no-browser",
        action="store_true",
        help="Do not open the browser automatically",
    )
    parser.add_argument(
        "--fresh-demo",
        action="store_true",
        help="Use temporary demo data; preserve the saved workspace",
    )
    parser.add_argument(
        "--data-dir",
        type=Path,
        default=Path(__file__).resolve().parent / ".local",
        help="Directory for saved local data",
    )
    parser.add_argument(
        "--ai",
        action="store_true",
        help="Use OpenAI classification (requires OPENAI_API_KEY and OPENAI_MODEL)",
    )
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("--port must be between 1 and 65535")
    if args.ai and not all(
        os.environ.get(k) for k in ["OPENAI_API_KEY", "OPENAI_MODEL"]
    ):
        parser.error(
            "--ai requires OPENAI_API_KEY and OPENAI_MODEL in the environment; omit --ai for the offline demo"
        )
    # A configured API key alone must never make the recruiter demo call a provider.
    os.environ["BRACE_AI"] = "1" if args.ai else "0"
    import app

    temporary = (
        tempfile.TemporaryDirectory(prefix="brace-demo-") if args.fresh_demo else None
    )
    data_dir = Path(temporary.name) if temporary else args.data_dir.resolve()
    data_dir.mkdir(parents=True, exist_ok=True)
    app.DB = data_dir / "brace.sqlite3"
    server = None
    try:
        # Bind before seeding so an occupied port cannot trigger paid model calls.
        server = ThreadingHTTPServer(("127.0.0.1", args.port), app.Handler)
        print("Preparing six synthetic builder queries...", flush=True)
        app.prepare()
        url = f"http://127.0.0.1:{args.port}"
        print(
            f'\nBrace Electrical — claims desk\n  Open: {url}\n  Mode: {"OpenAI classification" if args.ai else "offline demo (no API calls)"}\n  Data: {app.DB}\n\nPress Ctrl+C to stop. No emails are sent.\n',
            flush=True,
        )
        if not args.no_browser:
            threading.Timer(0.3, webbrowser.open, args=(url,)).start()
        server.serve_forever()
    except KeyboardInterrupt:
        print(
            "\nStopped. "
            + ("Temporary demo discarded." if temporary else "Your workspace is saved.")
        )
    except OSError as exc:
        print(
            f"Could not start the local server: {exc}\nTry another port: python run.py --port 8766",
            file=sys.stderr,
        )
        return 1
    finally:
        if server:
            server.server_close()
        if temporary:
            temporary.cleanup()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

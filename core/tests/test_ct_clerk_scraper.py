import csv
import importlib.util
import json
import sys
import threading
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).parents[2]
SPEC = importlib.util.spec_from_file_location("scrape_ct_clerks", ROOT / "scrape_ct_clerks.py")
scraper = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = scraper
SPEC.loader.exec_module(scraper)


class _TownSite(BaseHTTPRequestHandler):
    pdf = b"%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n"

    def do_GET(self):
        if self.path == "/robots.txt":
            self._send(b"User-agent: *\nAllow: /\n", "text/plain")
        elif self.path == "/clerk":
            self._send(b'<html><a href="/docs/budget.pdf">Budget PDF</a></html>', "text/html")
        elif self.path == "/docs/budget.pdf":
            self._send(self.pdf, "application/pdf")
        else:
            self.send_error(404)

    def log_message(self, _format, *_args):
        return

    def _send(self, body, content_type):
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def test_scraper_downloads_manifests_zips_and_resumes(tmp_path):
    server = ThreadingHTTPServer(("127.0.0.1", 0), _TownSite)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base = f"http://127.0.0.1:{server.server_port}"
        towns = tmp_path / "towns.json"
        towns.write_text(json.dumps([{
            "town": "Testville",
            "clerk_url": f"{base}/clerk",
            "site_root": base,
        }]), encoding="utf-8")
        out = tmp_path / "corpus"
        args = [
            "--towns", str(towns), "--out", str(out), "--only", "Testville",
            "--depth", "1", "--rate", "0", "--retries", "0", "--timeout", "5",
            "--js-link-threshold", "0", "--resume",
        ]

        assert scraper.main(args) == 0
        manifest = out / "testville" / "manifest.csv"
        rows = list(csv.DictReader(manifest.open(encoding="utf-8", newline="")))
        assert len(rows) == 1
        assert rows[0]["status"] == "downloaded"
        assert (out / "testville" / "files" / rows[0]["filename"]).read_bytes() == _TownSite.pdf
        archive = out / "zips" / "testville.zip"
        assert archive.exists()
        with zipfile.ZipFile(archive) as zf:
            assert any(name.endswith("/manifest.csv") for name in zf.namelist())
        assert (out / "testville" / ".done").exists()

        before = archive.stat().st_mtime_ns
        assert scraper.main(args) == 0
        assert archive.stat().st_mtime_ns == before
    finally:
        server.shutdown()
        server.server_close()

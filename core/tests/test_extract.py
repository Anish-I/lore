"""M4: PDF/DOCX extraction + distill routing + /ingest-url guards."""
import zipfile

from fastapi.testclient import TestClient

from lore.api import app, get_embedder, get_reranker
from lore.embed import FakeEmbedder
from lore.rerank import FakeReranker
from lore import extract
from lore.distill import distill_md

app.dependency_overrides[get_embedder] = lambda: FakeEmbedder()
app.dependency_overrides[get_reranker] = lambda: FakeReranker()
client = TestClient(app)

_DOCX_XML = (
    '<?xml version="1.0"?>'
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    '<w:body>'
    '<w:p><w:r><w:t>Underwriting rule for hail claims.</w:t></w:r></w:p>'
    '<w:p><w:r><w:t>Second paragraph with the </w:t></w:r><w:r><w:t>split run.</w:t></w:r></w:p>'
    '</w:body></w:document>'
)


def _mk_docx(path):
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("word/document.xml", _DOCX_XML)


def _mk_pdf(path):
    import fitz
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 100), "Policy limit is nine percent per claim.")
    doc.save(str(path))
    doc.close()


def test_docx_extraction(tmp_path):
    p = tmp_path / "Claims Rules.docx"
    _mk_docx(p)
    title, md = extract.extract_text(str(p))
    assert title == "Claims Rules"
    assert md.startswith("# Claims Rules")
    assert "Underwriting rule for hail claims." in md
    assert "split run." in md  # adjacent runs joined


def test_pdf_extraction(tmp_path):
    p = tmp_path / "Policy Doc.pdf"
    _mk_pdf(p)
    title, md = extract.extract_text(str(p))
    assert title == "Policy Doc"
    assert "nine percent" in md


def test_distill_routes_by_extension(tmp_path):
    d = tmp_path / "route.docx"
    _mk_docx(d)
    _, title, md = distill_md(str(d))
    assert title == "route" and "hail claims" in md

    m = tmp_path / "note.md"
    m.write_text("# Real Title\n\nbody\n", encoding="utf-8")
    _, title2, md2 = distill_md(str(m))
    assert title2 == "Real Title" and md2.startswith("# Real Title")


def test_unsupported_extension_returns_none(tmp_path):
    p = tmp_path / "x.xlsx"
    p.write_text("nope")
    assert extract.extract_text(str(p)) is None


def test_docx_with_dtd_entity_bomb_rejected(tmp_path):
    # Billion-laughs style: a DOCTYPE in the document part must be rejected,
    # not expanded.
    bomb = (
        '<?xml version="1.0"?>'
        '<!DOCTYPE lolz [<!ENTITY lol "lol">'
        '<!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">]>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        '<w:body><w:p><w:r><w:t>&lol2;</w:t></w:r></w:p></w:body></w:document>'
    )
    p = tmp_path / "bomb.docx"
    with zipfile.ZipFile(p, "w") as z:
        z.writestr("word/document.xml", bomb)
    got = extract.extract_text(str(p))
    # Either it returns None (parse refused) — never an expanded entity bomb.
    assert got is None or "lollollol" not in (got[1] if got else "")


def test_ingest_url_guards():
    base = {"scope": "s", "owner": "o", "tenant": "url-tenant"}
    r = client.post("/ingest-url", json={"url": "file:///etc/passwd", **base})
    assert r.status_code == 422
    r = client.post("/ingest-url", json={"url": "http://127.0.0.1:8099/stats", **base})
    assert r.status_code == 422
    r = client.post("/ingest-url", json={"url": "http://192.168.1.10/x", **base})
    assert r.status_code == 422
    r = client.post("/ingest-url", json={"url": "http://169.254.169.254/latest/meta-data", **base})
    assert r.status_code == 422

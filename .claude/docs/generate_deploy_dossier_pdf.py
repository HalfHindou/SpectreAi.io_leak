"""Generate a clean, readable PDF of the dossier deployment guide for KD.

Uses Chrome headless --print-to-pdf for full browser rendering with real web
fonts (Inter + JetBrains Mono via Google Fonts) and proper syntax highlighting.
No GTK / no reportlab.
"""
import markdown
import subprocess
import tempfile
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC_MD = ROOT / "docs" / "DEPLOY_DOSSIER.md"
OUT_PDF = ROOT / "docs" / "DEPLOY_DOSSIER.pdf"

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"

md_text = SRC_MD.read_text(encoding="utf-8")
html_body = markdown.markdown(
    md_text,
    extensions=["fenced_code", "tables", "sane_lists"],
)
# Strip the doc's first <h1> - we render our own hero header.
html_body = re.sub(r"<h1>.*?</h1>", "", html_body, count=1, flags=re.DOTALL)

CSS = """
@page {
    size: A4;
    margin: 22mm 20mm 18mm 20mm;
}

* { box-sizing: border-box; }

html {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 10.5pt;
    line-height: 1.6;
    color: #0f172a;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
}

body { margin: 0; padding: 0; }

.eyebrow {
    font-size: 9pt;
    font-weight: 600;
    color: #1d4ed8;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    margin-bottom: 8pt;
}
.doc-title {
    font-size: 28pt;
    font-weight: 800;
    letter-spacing: -0.03em;
    line-height: 1.05;
    margin: 0 0 6pt 0;
    color: #0f172a;
}
.doc-subtitle {
    font-size: 11pt;
    color: #475569;
    margin: 0 0 18pt 0;
    line-height: 1.5;
}
.divider {
    border: none;
    border-top: 1px solid #cbd5e1;
    margin: 8pt 0 18pt 0;
}

h2 {
    font-size: 16pt;
    font-weight: 700;
    letter-spacing: -0.015em;
    color: #0f172a;
    margin: 24pt 0 8pt 0;
    padding-top: 10pt;
    border-top: 1px solid #e2e8f0;
}
h2:first-of-type { border-top: none; padding-top: 0; }

h3 {
    font-size: 12.5pt;
    font-weight: 700;
    color: #1d4ed8;
    margin: 18pt 0 6pt 0;
}

h4 {
    font-size: 11pt;
    font-weight: 700;
    color: #0f172a;
    margin: 14pt 0 4pt 0;
}

p { margin: 6pt 0; }
strong { font-weight: 700; color: #0f172a; }
em { color: #475569; font-style: italic; }
a { color: #1d4ed8; text-decoration: none; }

/* Inline code */
:not(pre) > code {
    font-family: 'JetBrains Mono', 'SF Mono', 'Menlo', Consolas, monospace;
    font-size: 9.5pt;
    background: #f1f5f9;
    color: #0f172a;
    padding: 1.5pt 5pt;
    border-radius: 3pt;
    border: 1px solid #e2e8f0;
    font-weight: 500;
}

/* Code blocks */
pre {
    font-family: 'JetBrains Mono', 'SF Mono', 'Menlo', Consolas, monospace;
    font-size: 9pt;
    line-height: 1.55;
    background: #f8fafc;
    color: #0f172a;
    border: 1px solid #cbd5e1;
    border-left: 3px solid #1d4ed8;
    border-radius: 5pt;
    padding: 12pt 14pt;
    margin: 10pt 0 14pt 0;
    white-space: pre-wrap;
    word-break: break-word;
    page-break-inside: avoid;
}
pre code {
    background: transparent;
    border: none;
    padding: 0;
    font-size: inherit;
    color: inherit;
    font-weight: 500;
}

/* Tables */
table {
    width: 100%;
    border-collapse: collapse;
    margin: 10pt 0 14pt 0;
    font-size: 10pt;
    page-break-inside: avoid;
    border: 1px solid #e2e8f0;
    border-radius: 5pt;
    overflow: hidden;
}

th {
    background: #0f172a;
    color: #ffffff;
    font-weight: 600;
    text-align: left;
    padding: 8pt 12pt;
    font-size: 9.5pt;
    letter-spacing: 0.02em;
}

td {
    padding: 8pt 12pt;
    border-bottom: 1px solid #e2e8f0;
    vertical-align: top;
    color: #0f172a;
}
tr:last-child td { border-bottom: none; }
tr:nth-child(even) td { background: #f8fafc; }

ul, ol {
    margin: 6pt 0 12pt 0;
    padding-left: 20pt;
}
li { margin: 4pt 0; }
li > p { margin: 0; }

hr {
    border: none;
    border-top: 1px solid #cbd5e1;
    margin: 18pt 0;
}
"""

HTML_DOC = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Deploy Dossier Service to OVH</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>{CSS}</style>
</head>
<body>
<div class="eyebrow">Spectre AI &nbsp;&middot;&nbsp; Deployment guide</div>
<h1 class="doc-title">Deploy Dossier Service to OVH</h1>
<p class="doc-subtitle">For KD &nbsp;&middot;&nbsp; Target box: 51.178.209.131 (same machine as stream.spectreai.io)</p>
<hr class="divider">
{html_body}
</body>
</html>
"""

# Write HTML to temp file (Chrome needs a file:// URL or http URL)
with tempfile.NamedTemporaryFile("w", suffix=".html", delete=False, encoding="utf-8") as f:
    f.write(HTML_DOC)
    tmp_html = f.name

try:
    # Chrome headless print-to-pdf. --no-pdf-header-footer keeps it clean.
    # --virtual-time-budget=5000 gives Google Fonts time to load.
    subprocess.run([
        CHROME,
        "--headless=new",
        "--disable-gpu",
        "--no-margins",
        "--no-pdf-header-footer",
        "--virtual-time-budget=5000",
        f"--print-to-pdf={OUT_PDF}",
        f"file:///{tmp_html.replace(os.sep, '/')}",
    ], check=True, timeout=60)
    print(f"Wrote {OUT_PDF}")
finally:
    os.unlink(tmp_html)

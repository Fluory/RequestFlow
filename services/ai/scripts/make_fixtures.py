"""Generate the synthetic PDF test fixture (all content invented).

Run: uv run python scripts/make_fixtures.py
Output: tests/fixtures/anfrage_musterbau.pdf, ohne_textebene.pdf and anfrage_scan.pdf (committed;
re-run only when the content changes). XLSX, DOCX and .msg test documents are built in-test
(tests/builders.py).
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

FIXTURES = Path(__file__).resolve().parent.parent / "tests" / "fixtures"

PAGE_1 = [
    "Musterbau Beispiel GmbH",
    "Beispielstrasse 12, 12345 Musterstadt",
    "Anfrage Nr. 2026-0815",
    "Ansprechpartner: Erika Mustermann",
    "Bitte um Angebot fuer 1.250 Stueck Flansch DN50.",
    "Gewuenschter Liefertermin: 15.11.2026",
]
PAGE_2 = [
    "Technische Anforderungen",
    "Werkstoff: 1.4301, Toleranz nach ISO 2768-m.",
]


def build_pdf(target: Path) -> None:
    pdf = canvas.Canvas(str(target), pagesize=A4, invariant=True)
    pdf.setTitle("Synthetic quote request")
    pdf.setAuthor("RequestFlow test fixture")
    for lines in (PAGE_1, PAGE_2):
        y = 780
        for line in lines:
            pdf.setFont("Helvetica", 12)
            pdf.drawString(72, y, line)
            y -= 28
        pdf.showPage()
    pdf.save()


def build_pdf_without_text(target: Path) -> None:
    """Stands in for a scan: a page with graphics but no text layer."""
    pdf = canvas.Canvas(str(target), pagesize=A4, invariant=True)
    pdf.rect(72, 600, 300, 150, stroke=1, fill=0)
    pdf.showPage()
    pdf.save()


SCAN_LINES = [
    "Musterbau Beispiel GmbH",
    "Anfrage Nr. 2026-0815",
    "Liefertermin: 15.11.2026",
]


def build_scan_pdf(target: Path) -> None:
    """Stands in for a scanned letter: text only as pixels (an embedded image), no text layer."""
    image = Image.new("L", (1240, 600), color=255)
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default(size=44)
    for number, line in enumerate(SCAN_LINES):
        draw.text((80, 80 + number * 120), line, fill=0, font=font)
    pdf = canvas.Canvas(str(target), pagesize=A4, invariant=True)
    pdf.drawImage(ImageReader(image), 36, 500, width=523, height=253)
    pdf.showPage()
    pdf.save()


def main() -> None:
    FIXTURES.mkdir(parents=True, exist_ok=True)
    build_pdf(FIXTURES / "anfrage_musterbau.pdf")
    build_pdf_without_text(FIXTURES / "ohne_textebene.pdf")
    build_scan_pdf(FIXTURES / "anfrage_scan.pdf")


if __name__ == "__main__":
    main()

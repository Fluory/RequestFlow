"""One resource budget per extracted document, shared by all of its (nested) attachments.

The per-file caps (``MAX_ATTACHMENTS`` per message, 64 MiB unzipped per OOXML package,
``AI_MAX_PDF_PAGES`` per PDF, ...) bound one attachment; without a shared budget a ``.msg`` with
dozens of attachments would multiply them. ``parse_document`` creates one ``ParseBudget`` for the
uploaded document and every parser draws from it:

* ``MAX_TOTAL_ATTACHMENTS`` attachments parsed, at any nesting level;
* ``MAX_TOTAL_UNZIPPED_BYTES`` declared uncompressed bytes of all OOXML packages;
* ``MAX_TOTAL_PDF_PAGES`` PDF pages (at least ``AI_MAX_PDF_PAGES``, so one PDF always fits);
* ``pdf.MAX_OCR_PAGES`` pages OCR'd (the rest are skipped with a warning, see ``parsing.pdf``).

An attachment that would overdraw the budget is not parsed and is reported as
``budget_exceeded``; the rest of the message is still returned. Every single-file cap is at most
the budget, so a top-level document alone never exceeds it.
"""

from __future__ import annotations

from dataclasses import dataclass

from requestflow_ai.parsing import pdf
from requestflow_ai.parsing.errors import BudgetExceededError

MAX_TOTAL_ATTACHMENTS = 100
MAX_TOTAL_UNZIPPED_BYTES = 128 * 1024 * 1024
MAX_TOTAL_PDF_PAGES = 100


@dataclass
class ParseBudget:
    attachments: int
    unzipped_bytes: int
    pdf_pages: int
    ocr_pages: int

    @classmethod
    def for_document(cls, max_pdf_pages: int) -> ParseBudget:
        # Module attributes are read at call time (tests patch them).
        return cls(
            attachments=MAX_TOTAL_ATTACHMENTS,
            unzipped_bytes=MAX_TOTAL_UNZIPPED_BYTES,
            pdf_pages=max(MAX_TOTAL_PDF_PAGES, max_pdf_pages),
            ocr_pages=pdf.MAX_OCR_PAGES,
        )

    def take_attachment(self) -> None:
        if self.attachments <= 0:
            raise BudgetExceededError("attachment budget spent")
        self.attachments -= 1

    def take_unzipped_bytes(self, size: int) -> None:
        if size > self.unzipped_bytes:
            raise BudgetExceededError("unzipped bytes budget spent")
        self.unzipped_bytes -= size

    def take_pdf_pages(self, pages: int) -> None:
        if pages > self.pdf_pages:
            raise BudgetExceededError("PDF page budget spent")
        self.pdf_pages -= pages

    def take_ocr_pages(self, pages: int) -> None:
        self.ocr_pages = max(self.ocr_pages - pages, 0)

"""Parser errors. Messages never contain document content (they may reach logs)."""

from __future__ import annotations


class DocumentParseError(Exception):
    """The bytes claim a supported type but cannot be parsed."""


class UnsupportedMediaTypeError(Exception):
    """The bytes are not a supported document type."""


class DocumentTooLongError(Exception):
    """The document exceeds a size cap: PDF pages (``AI_MAX_PDF_PAGES``), pages to OCR, XLSX
    sheets/rows/cells, DOCX blocks, OOXML part size or segments of a whole message."""


class BudgetExceededError(DocumentTooLongError):
    """The extracted document's shared budget (all attachments of a ``.msg`` together) is spent:
    attachments, unzipped OOXML bytes or PDF pages. A top-level document never exceeds it."""


class PdfPipelineInitError(Exception):
    """The configured PDF pipeline cannot be built (e.g. layout model missing). No start."""

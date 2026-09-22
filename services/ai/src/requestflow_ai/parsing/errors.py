"""Parser errors. Messages never contain document content (they may reach logs)."""

from __future__ import annotations


class DocumentParseError(Exception):
    """The bytes claim a supported type but cannot be parsed."""


class UnsupportedMediaTypeError(Exception):
    """The bytes are not a supported document type."""

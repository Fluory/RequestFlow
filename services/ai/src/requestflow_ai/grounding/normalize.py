"""Text normalisation for quote matching. The same function runs on quote and segment."""

from __future__ import annotations

import re
import unicodedata

_SOFT_HYPHEN = "\u00ad"
# Hyphen at a line break (optionally surrounded by spaces), between two word characters.
_HYPHENATION = re.compile(r"(\w)-[^\S\n]*\r?\n\s*(\w)")
_WHITESPACE = re.compile(r"\s+")
_FOLD = str.maketrans(
    {
        "\u2010": "-",  # hyphen
        "\u2011": "-",  # non-breaking hyphen
        "\u2012": "-",  # figure dash
        "\u2013": "-",  # en dash
        "\u2014": "-",  # em dash
        "\u2212": "-",  # minus sign
        "\u201c": '"',
        "\u201d": '"',
        "\u201e": '"',
        "\u00ab": '"',
        "\u00bb": '"',
        "\u2018": "'",
        "\u2019": "'",
        "\u201a": "'",
    }
)


def normalize_text(text: str) -> str:
    """Fold unicode compatibility forms, hyphenation, dashes/quotes, whitespace and case."""
    text = unicodedata.normalize("NFKC", text)
    text = text.replace(_SOFT_HYPHEN, "")
    text = _HYPHENATION.sub(r"\1\2", text)
    text = text.translate(_FOLD)
    text = _WHITESPACE.sub(" ", text).strip()
    return text.casefold()

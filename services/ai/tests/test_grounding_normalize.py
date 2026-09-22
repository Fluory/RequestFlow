from __future__ import annotations

import pytest

from requestflow_ai.grounding.normalize import normalize_text


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("  Musterbau   Beispiel\tGmbH \n", "musterbau beispiel gmbh"),
        ("MUSTERBAU", "musterbau"),
        # NFKC: full-width letters, ligatures and non-breaking spaces fold to plain text.
        ("Ｍｕｓｔｅｒｂａｕ", "musterbau"),
        ("Proﬁl", "profil"),
        ("Erika Mustermann", "erika mustermann"),
        # Hyphenation: soft hyphen and a hyphen at a line break join the word.
        ("Liefer­termin", "liefertermin"),
        ("Liefer-\ntermin", "liefertermin"),
        ("Liefer-  \r\n  termin", "liefertermin"),
        # Typographic dashes and quotes fold to ASCII.
        ("ISO 2768–m", "iso 2768-m"),
        ("„Muster“", '"muster"'),
        # German sharp s: casefold makes "STRASSE" and "straße" equal.
        ("Beispielstraße", "beispielstrasse"),
    ],
)
def test_normalize_text(raw: str, expected: str) -> None:
    assert normalize_text(raw) == expected


def test_normalize_keeps_an_inline_hyphen() -> None:
    # A hyphen inside a word (no line break) is content, not hyphenation.
    assert normalize_text("Musterbau-Beispiel") == "musterbau-beispiel"

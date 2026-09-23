from __future__ import annotations

import pytest

from requestflow_ai.grounding.normalize import normalize_text


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("  Musterbau   Beispiel\tGmbH \n", "musterbau beispiel gmbh"),
        ("MUSTERBAU", "musterbau"),
        # NFKC: full-width letters, ligatures and non-breaking spaces fold to plain text.
        ("\uff2d\uff55\uff53\uff54\uff45\uff52\uff42\uff41\uff55", "musterbau"),
        ("Pro\ufb01l", "profil"),
        ("Erika\u00a0Mustermann", "erika mustermann"),
        # Hyphenation: soft hyphen and a hyphen at a line break join the word.
        ("Liefer\u00adtermin", "liefertermin"),
        ("Liefer-\ntermin", "liefertermin"),
        ("Liefer-  \r\n  termin", "liefertermin"),
        # Typographic dashes and quotes fold to ASCII.
        ("ISO 2768\u2013m", "iso 2768-m"),
        ("\u201eMuster\u201c", '"muster"'),
        # German sharp s (U+00DF): casefold makes it equal to "ss".
        ("Beispielstra\u00dfe", "beispielstrasse"),
    ],
)
def test_normalize_text(raw: str, expected: str) -> None:
    assert normalize_text(raw) == expected


def test_normalize_keeps_an_inline_hyphen() -> None:
    # A hyphen inside a word (no line break) is content, not hyphenation.
    assert normalize_text("Musterbau-Beispiel") == "musterbau-beispiel"


def test_normalize_folds_the_multiplication_sign_for_dimensions() -> None:
    assert normalize_text("200 \u00d7 100 \u00d7 20 mm") == "200 x 100 x 20 mm"

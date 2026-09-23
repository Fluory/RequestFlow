from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from requestflow_ai.grounding.values import (
    check_value,
    extract_dates,
    extract_numbers,
    parse_date,
    parse_number,
    value_consistent,
)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("1.234,5", Decimal("1234.5")),
        ("1.250", Decimal("1250")),
        ("1.234.567", Decimal("1234567")),
        ("1234,5", Decimal("1234.5")),
        ("0,75", Decimal("0.75")),
        ("1234.5", Decimal("1234.5")),
        ("1 234,5", Decimal("1234.5")),
        ("1\u202f234,5", Decimal("1234.5")),
        ("42", Decimal("42")),
        ("-3,5", Decimal("-3.5")),
    ],
)
def test_parse_number_german_and_iso_formats(raw: str, expected: Decimal) -> None:
    assert parse_number(raw) == expected


@pytest.mark.parametrize("raw", ["", "abc", "1,2,3", "12.34.56.x"])
def test_parse_number_rejects_non_numbers(raw: str) -> None:
    assert parse_number(raw) is None


def test_extract_numbers_from_sentence() -> None:
    assert extract_numbers("Bitte 1.250 Stueck, je 12,5 kg") == [Decimal("1250"), Decimal("12.5")]


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("15.11.2026", date(2026, 11, 15)),
        ("5.1.26", date(2026, 1, 5)),
        ("05.01.2026", date(2026, 1, 5)),
        ("2026-11-15", date(2026, 11, 15)),
        (" 2026-11-15 ", date(2026, 11, 15)),
    ],
)
def test_parse_date_formats(raw: str, expected: date) -> None:
    assert parse_date(raw) == expected


@pytest.mark.parametrize(
    "raw", ["31.02.2026", "2026-13-01", "15.11.", "morgen", "15.11.2026 und mehr"]
)
def test_parse_date_rejects_invalid_or_partial(raw: str) -> None:
    assert parse_date(raw) is None


def test_extract_dates_from_sentence() -> None:
    text = "Liefertermin: 15.11.2026, spaetestens 2026-12-01 (Werkstoff 1.4301)"
    assert extract_dates(text) == [date(2026, 11, 15), date(2026, 12, 1)]


@pytest.mark.parametrize(
    ("kind", "value", "quote", "ok"),
    [
        ("text", "Musterbau Beispiel GmbH", "Firma: Musterbau  Beispiel GmbH", True),
        ("text", "musterbau beispiel gmbh", "MUSTERBAU BEISPIEL GMBH", True),
        ("text", "Evil Corp", "Musterbau Beispiel GmbH", False),
        ("date", "2026-11-15", "Liefertermin: 15.11.2026", True),
        ("date", "2026-11-15", "Liefertermin: 15.11.26", True),
        ("date", "2026-11-15", "bis 2026-11-15", True),
        ("date", "15.11.2026", "Liefertermin: 2026-11-15", True),
        ("date", "2026-11-16", "Liefertermin: 15.11.2026", False),
        ("date", "next week", "Liefertermin: 15.11.2026", False),
        ("number", "1234.5", "Menge 1.234,5 kg", True),
        ("number", "1250", "1.250 Stueck", True),
        ("number", "1.25", "1.250 Stueck", False),
        ("number", "not a number", "1.250 Stueck", False),
    ],
)
def test_value_consistent(kind: str, value: str, quote: str, ok: bool) -> None:
    assert value_consistent(kind, value, quote) is ok  # type: ignore[arg-type]


@pytest.mark.parametrize(
    ("value", "quote"),
    [
        ("G", "Musterbau GmbH"),
        ("bau GmbH", "Musterbau GmbH"),
        ("Muster", "Musterbau GmbH"),
        ("Muster", "Max Mustermann"),
        ("mann", "Max Mustermann"),
        ("ax Mustermann", "Max Mustermann"),
    ],
)
def test_text_value_must_match_whole_words(value: str, quote: str) -> None:
    assert value_consistent("text", value, quote) is False


@pytest.mark.parametrize(
    ("value", "quote"),
    [
        ("Musterbau GmbH", "Firma: Musterbau GmbH, Werk 2"),
        ("Musterbau GmbH & Co. KG", "Musterbau GmbH & Co. KG"),
        ("Max Mustermann", "Ansprechpartner: Max Mustermann."),
        ("  Max Mustermann \n", "Max Mustermann"),
    ],
)
def test_text_value_on_word_boundaries_is_consistent(value: str, quote: str) -> None:
    assert value_consistent("text", value, quote) is True


@pytest.mark.parametrize(
    ("kind", "value", "quote", "normalized"),
    [
        ("text", "  Musterbau GmbH \n", "Musterbau GmbH", "Musterbau GmbH"),
        ("date", "15.10.2026", "Liefertermin: 15.10.2026", "2026-10-15"),
        ("date", "15.10.26", "Liefertermin: 15.10.26", "2026-10-15"),
        ("date", " 2026-10-15 ", "bis 15.10.2026", "2026-10-15"),
        ("date", "2026-10-15", "bis 2026-10-15", "2026-10-15"),
    ],
)
def test_check_value_returns_the_normalised_value(
    kind: str, value: str, quote: str, normalized: str
) -> None:
    result = check_value(kind, value, quote)  # type: ignore[arg-type]
    assert result.ok
    assert result.normalized == normalized
    assert result.ambiguous is False


def test_check_value_date_not_in_quote_is_not_ok() -> None:
    result = check_value("date", "15.10.2026", "Liefertermin: 16.10.2026")
    assert not result.ok
    assert result.normalized is None


def test_check_value_quote_with_two_dates_is_ambiguous() -> None:
    result = check_value("date", "2026-11-15", "Liefertermin 15.11.2026, spaetestens 01.12.2026")
    assert result.ok
    assert result.ambiguous is True
    assert result.normalized == "2026-11-15"


def test_check_value_same_date_twice_is_not_ambiguous() -> None:
    result = check_value("date", "2026-11-15", "15.11.2026 (2026-11-15)")
    assert result.ok
    assert result.ambiguous is False

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from requestflow_ai.grounding.values import (
    CalendarWeek,
    canonical_unit,
    check_value,
    extract_calendar_weeks,
    extract_dates,
    extract_numbers,
    parse_calendar_week,
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


# --- schema v2 (#22): quantities, units, e-mail, phone, calendar weeks ----------------------


@pytest.mark.parametrize(
    ("value", "quote", "normalized"),
    [
        ("1.250", "Bitte um Angebot fuer 1.250 Stueck", "1250"),
        ("1250", "1.250 Stk.", "1250"),
        ("2,5", "Menge: 2,5 t", "2.5"),
        ("2,50", "2,50 m", "2.5"),
        ("1.234,50", "Gesamt 1.234,50 kg", "1234.5"),
        ("1 000", "1 000 Stueck", "1000"),
        ("40", "wir brauchen 40 Zahnraeder", "40"),
    ],
)
def test_number_value_is_returned_as_plain_decimal_with_dot(
    value: str, quote: str, normalized: str
) -> None:
    result = check_value("number", value, quote)
    assert result.ok
    assert result.normalized == normalized


@pytest.mark.parametrize(
    ("raw", "canonical"),
    [
        ("mm", "mm"),
        ("MM", "mm"),
        ("Millimeter", "mm"),
        ("cm", "cm"),
        ("m", "m"),
        ("Meter", "m"),
        ("kg", "kg"),
        ("Kilogramm", "kg"),
        ("t", "t"),
        ("Tonnen", "t"),
        ("Stk.", "pcs"),
        ("Stk", "pcs"),
        ("Stck.", "pcs"),
        ("St.", "pcs"),
        ("Stück", "pcs"),
        ("Stueck", "pcs"),
        ("pcs", "pcs"),
        (" Stk. ", "pcs"),
    ],
)
def test_canonical_unit(raw: str, canonical: str) -> None:
    assert canonical_unit(raw) == canonical


@pytest.mark.parametrize("raw", ["Satz", "Paar", "", "DN", "mmm"])
def test_unknown_unit_has_no_canonical_form(raw: str) -> None:
    assert canonical_unit(raw) is None


@pytest.mark.parametrize(
    ("value", "quote", "normalized"),
    [
        ("Stk.", "1.250 Stk. Flansch", "pcs"),
        ("Stück", "1.250 Stück Flansch", "pcs"),
        ("pcs", "1.250 Stück Flansch", "pcs"),
        ("Stueck", "40 Stk", "pcs"),
        ("mm", "Laenge 250mm", "mm"),
        ("mm", "Laenge 250 mm", "mm"),
        ("m", "12,5 m Rohr", "m"),
        ("kg", "je 12,5 kg", "kg"),
        ("t", "Menge: 2,5 t", "t"),
        ("Satz", "3 Satz Dichtungen", "Satz"),
        (" Paar ", "2 Paar Handschuhe", "Paar"),
        # A table cell holding only the unit.
        ("Stk.", "Stk.", "pcs"),
        ("kg", " kg ", "kg"),
    ],
)
def test_unit_value_is_checked_and_canonicalised(value: str, quote: str, normalized: str) -> None:
    result = check_value("unit", value, quote)
    assert result.ok
    assert result.normalized == normalized


@pytest.mark.parametrize(
    ("value", "quote"),
    [
        ("kg", "1.250 Stueck Flansch"),
        ("pcs", "Laenge 250 mm"),
        ("mm", "Laenge 250 m"),
        # "m" inside a tolerance class or a word is not a unit token.
        ("m", "Toleranz nach ISO 2768-m"),
        ("m", "Modul 2"),
        ("t", "Flansch DN50"),
        ("Satz", "3 Paar Dichtungen"),
        # Not after a number: a steel grade, a thickness (#22 review).
        ("pcs", "St 37-2 Blech"),
        ("Stk.", "Werkstoff St 52"),
        ("t", "Blech t=5"),
        ("t", "t 5 mm"),
    ],
)
def test_unit_not_in_quote_is_not_ok(value: str, quote: str) -> None:
    assert check_value("unit", value, quote).ok is False


@pytest.mark.parametrize(
    ("value", "quote"),
    [
        ("erika.mustermann@example.com", "From: Erika <erika.mustermann@example.com>"),
        ("Erika.Mustermann@Example.COM", "E-Mail: erika.mustermann@example.com"),
        (" einkauf@example.org ", "Mail: EINKAUF@EXAMPLE.ORG."),
    ],
)
def test_email_value_is_matched_case_insensitive_and_lowercased(value: str, quote: str) -> None:
    result = check_value("email", value, quote)
    assert result.ok
    assert result.normalized == value.strip().lower()


@pytest.mark.parametrize(
    ("value", "quote"),
    [
        ("erika@example.com", "From: max.beispiel@example.net"),
        ("erika@example.com", "rika@example.com"),
        ("rika@example.com", "erika@example.com"),
        ("erika@example.co", "erika@example.com"),
        ("not an address", "not an address"),
    ],
)
def test_email_not_in_quote_is_not_ok(value: str, quote: str) -> None:
    assert check_value("email", value, quote).ok is False


@pytest.mark.parametrize(
    ("value", "quote", "normalized"),
    [
        ("+49 30 1234567", "Tel.: +49 30 1234567", "+49 30 1234567"),
        ("030 / 123 456-78", "Telefon 030/12345678", "030 / 123 456-78"),
        ("030 12345678", "Tel. 030 123 456 78, Fax 030 123 456 79", "030 12345678"),
        ("  0171 2345678 ", "Mobil: 0171-2345678", "0171 2345678"),
    ],
)
def test_phone_value_matches_digits_and_is_kept_as_written(
    value: str, quote: str, normalized: str
) -> None:
    result = check_value("phone", value, quote)
    assert result.ok
    assert result.normalized == normalized


@pytest.mark.parametrize(
    ("value", "quote"),
    [
        ("030 12345679", "Tel. 030 12345678"),
        # A part of a longer number is not the number.
        ("12345678", "Tel. 030 12345678"),
        ("+49 30 12345678", "Tel. 030 12345678"),
        ("12", "Tel. 12"),
        ("Zentrale", "Tel. Zentrale 030 12345678"),
        # A date or a dotted number is not a phone number (#22 review).
        ("12102026", "Liefertermin 12.10.2026"),
        ("12.10.2026", "Liefertermin 12.10.2026"),
    ],
)
def test_phone_not_in_quote_is_not_ok(value: str, quote: str) -> None:
    assert check_value("phone", value, quote).ok is False


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("KW 42", CalendarWeek(42, None)),
        ("KW42", CalendarWeek(42, None)),
        ("kw 7", CalendarWeek(7, None)),
        ("KW 42/2026", CalendarWeek(42, 2026)),
        ("KW 42/26", CalendarWeek(42, 2026)),
        ("KW 42 2026", CalendarWeek(42, 2026)),
        ("Kalenderwoche 42", CalendarWeek(42, None)),
        ("KW. 1", CalendarWeek(1, None)),
    ],
)
def test_parse_calendar_week(raw: str, expected: CalendarWeek) -> None:
    assert parse_calendar_week(raw) == expected


@pytest.mark.parametrize("raw", ["KW 54", "KW 0", "KW", "42", "2026-10-12", "KWX 42"])
def test_parse_calendar_week_rejects_non_weeks(raw: str) -> None:
    assert parse_calendar_week(raw) is None


def test_extract_calendar_weeks_from_sentence() -> None:
    assert extract_calendar_weeks("Lieferung bis KW 42/2026, spaetestens KW44") == [
        CalendarWeek(42, 2026),
        CalendarWeek(44, None),
    ]


def test_calendar_week_followed_by_a_quantity_takes_no_year() -> None:
    assert extract_calendar_weeks("KW 42 1250 Stueck") == [CalendarWeek(42, None)]


@pytest.mark.parametrize(
    ("value", "quote", "normalized"),
    [
        ("KW 42", "Liefertermin: KW 42", "KW 42"),
        ("kw42", "Liefertermin: KW 42", "KW 42"),
        ("KW 42", "Liefertermin: KW 42/2026", "KW 42"),
        ("KW 42/2026", "Liefertermin: KW 42/2026", "KW 42/2026"),
        ("Kalenderwoche 42", "Lieferung in KW 42", "KW 42"),
    ],
)
def test_calendar_week_date_value_is_flagged_and_kept_as_week(
    value: str, quote: str, normalized: str
) -> None:
    result = check_value("date", value, quote)
    assert result.ok
    assert result.calendar_week is True
    assert result.normalized == normalized


@pytest.mark.parametrize(
    ("value", "quote"),
    [
        # A date the model computed from a calendar week is not in the quote.
        ("2026-10-12", "Liefertermin: KW 42"),
        ("12.10.2026", "Liefertermin: KW 42/2026"),
        ("KW 43", "Liefertermin: KW 42"),
        # The year is not in the quote: the model added it.
        ("KW 42/2026", "Liefertermin: KW 42"),
        ("KW 42/2027", "Liefertermin: KW 42/2026"),
    ],
)
def test_calendar_week_value_not_supported_by_quote_is_not_ok(value: str, quote: str) -> None:
    assert check_value("date", value, quote).ok is False


def test_explicit_date_next_to_a_calendar_week_is_a_normal_date() -> None:
    result = check_value("date", "2026-10-15", "KW 42, spaetestens 15.10.2026")
    assert result.ok
    assert result.calendar_week is False
    assert result.normalized == "2026-10-15"

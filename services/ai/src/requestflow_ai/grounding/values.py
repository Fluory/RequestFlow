"""Value parsing for the consistency check between a field value and its quote.

Numbers: German formats (``1.234,5``, ``1.250``, ``0,75``, ``1 234,5``) and plain decimals
(``1234.5``). A dot followed by exactly three-digit groups is a thousands separator. A verified
number is returned as a plain decimal with a dot and no grouping (``1250``, ``2.5``).
Dates: ``DD.MM.YYYY``, ``D.M.YY`` (two-digit years are 20YY) and ISO ``YYYY-MM-DD``; returned as
``YYYY-MM-DD``. A calendar week (``KW 42``, ``KW 42/2026``, ``Kalenderwoche 42``) is no date: it is
only accepted as a week value (returned as ``KW 42`` / ``KW 42/2026``) and flagged, so the verifier
caps it at ``uncertain``. A date computed from a week is not in the quote and is rejected.
Units: a small canonical set (``mm``, ``cm``, ``m``, ``kg``, ``t``, ``pcs``) with German and
English spellings (``Stk.``, ``Stück``, ``Meter``, ...); a known unit must follow a number or fill a
whole table cell of the quote (cells split on ``|`` and tabs); unknown units are checked as text and
returned trimmed.
E-mail: case-insensitive match on address boundaries; returned lowercased.
Phone: the digits (with a leading ``+``) must equal one phone-like number in the quote; returned
trimmed as written (no country code is added).
Text: the normalised value must occur in the normalised quote on word boundaries.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Literal

from requestflow_ai.grounding.normalize import normalize_text

ValueKind = Literal["text", "number", "date", "email", "phone", "unit"]

_GROUP_SPACES = " \u00a0\u202f"
_NUMBER_BODY = (
    r"\d{1,3}(?:\.\d{3})+(?:,\d+)?"  # 1.234 / 1.234,5
    rf"|\d{{1,3}}(?:[{_GROUP_SPACES}]\d{{3}})+(?:,\d+)?"  # 1 234,5
    r"|\d+,\d+"  # 1234,5
    r"|\d+\.\d+"  # 1234.5
    r"|\d+"
)
_NUMBER_FULL = re.compile(rf"-?(?:{_NUMBER_BODY})")
# In running text: a sign only after whitespace/start/"(", no partial matches inside longer tokens.
_NUMBER_IN_TEXT = re.compile(rf"(?<![\d.,])(?:(?<![^\s(])-)?(?:{_NUMBER_BODY})(?![\d]|[.,]\d)")

_ISO_DATE = r"(?P<iy>\d{4})-(?P<im>\d{2})-(?P<id>\d{2})"
_DE_DATE = r"(?P<dd>\d{1,2})\.(?P<dm>\d{1,2})\.(?P<dy>\d{4}|\d{2})"
_DATE_FULL = re.compile(rf"(?:{_ISO_DATE}|{_DE_DATE})")
_DATE_IN_TEXT = re.compile(rf"(?<![\d.\-])(?:{_ISO_DATE}|{_DE_DATE})(?![\d]|-\d)")

# "KW 42", "KW42", "KW. 42", "Kalenderwoche 42", "CW 42"; optional year "/2026", "/26", " 2026".
_CALENDAR_WEEK = re.compile(
    r"(?<!\w)(?:kw|kalenderwoche|cw)\.?\s*(?P<week>\d{1,2})"
    r"(?:\s*/\s*(?P<slash_year>\d{4}|\d{2})|\s+(?P<space_year>20\d{2}))?(?!\d)",
    re.IGNORECASE,
)

# Canonical unit -> spellings (compared after normalize_text, trailing dot removed).
_UNIT_SPELLINGS: dict[str, tuple[str, ...]] = {
    "mm": ("mm", "millimeter", "millimetre"),
    "cm": ("cm", "zentimeter", "centimeter", "centimetre"),
    "m": ("m", "meter", "metre"),
    "kg": ("kg", "kilogramm", "kilogram"),
    "t": ("t", "tonne", "tonnen", "tonnes"),
    "pcs": ("pcs", "pc", "piece", "pieces", "stk", "stck", "st", "stück", "stueck"),
}
_UNITS: dict[str, str] = {
    spelling: canonical
    for canonical, spellings in _UNIT_SPELLINGS.items()
    for spelling in spellings
}
# A known unit counts only right after a number ("250mm", "1.250 Stk.") or when a whole table cell
# of the quote is the unit ("Stk.", "60    | Stk.", "Stk.\tKugelhahn"; cells split on "|" and tabs,
# #50). A bare "St 37-2" (steel grade) or "t=5" (thickness) is not a unit.
_UNIT_AFTER_NUMBER = re.compile(r"\d[\s\u00a0]*(?P<unit>[^\W\d_]+)\.?(?![^\W_])")
_CELL_BORDER = re.compile(r"[|\t]")

_EMAIL_SHAPE = re.compile(r"[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+")
# A phone-like number: digits with spaces, "/", "-" or parentheses between them. No dots: a date
# "12.10.2026" or an order number is not a phone number (#22 review).
_PHONE_IN_TEXT = re.compile(r"(?<![\w+.])\+?\d[\d \u00a0/()\-]*\d(?![\w.]\d|\w)")
_MIN_PHONE_DIGITS = 6


def _to_decimal(token: str) -> Decimal | None:
    sign = ""
    if token.startswith("-"):
        sign, token = "-", token[1:]
    for space in _GROUP_SPACES:
        token = token.replace(space, "")
    if "," in token:
        # German: dots group thousands, the comma is the decimal separator.
        token = token.replace(".", "").replace(",", ".")
    elif re.fullmatch(r"\d{1,3}(?:\.\d{3})+", token):
        token = token.replace(".", "")
    try:
        return Decimal(sign + token)
    except InvalidOperation:
        return None


def parse_number(text: str) -> Decimal | None:
    """Parse a whole string as one number, or return None."""
    token = text.strip()
    if not _NUMBER_FULL.fullmatch(token):
        return None
    return _to_decimal(token)


def extract_numbers(text: str) -> list[Decimal]:
    numbers: list[Decimal] = []
    for match in _NUMBER_IN_TEXT.finditer(text):
        value = _to_decimal(match.group(0))
        if value is not None:
            numbers.append(value)
    return numbers


def format_number(value: Decimal) -> str:
    """Plain decimal with a dot, no grouping, no exponent, no trailing zeros (``1250``, ``2.5``)."""
    text = format(value.normalize(), "f")
    return "0" if text == "-0" else text


def _match_to_date(match: re.Match[str]) -> date | None:
    if match.group("iy") is not None:
        year, month, day = int(match["iy"]), int(match["im"]), int(match["id"])
    else:
        year_text = match["dy"]
        year = int(year_text) + (2000 if len(year_text) == 2 else 0)
        month, day = int(match["dm"]), int(match["dd"])
    try:
        return date(year, month, day)
    except ValueError:
        return None


def parse_date(text: str) -> date | None:
    """Parse a whole string as one date, or return None."""
    match = _DATE_FULL.fullmatch(text.strip())
    return _match_to_date(match) if match else None


def extract_dates(text: str) -> list[date]:
    dates: list[date] = []
    for match in _DATE_IN_TEXT.finditer(text):
        value = _match_to_date(match)
        if value is not None:
            dates.append(value)
    return dates


@dataclass(frozen=True)
class CalendarWeek:
    week: int
    year: int | None

    def label(self) -> str:
        return f"KW {self.week}" if self.year is None else f"KW {self.week}/{self.year}"


def _match_to_week(match: re.Match[str]) -> CalendarWeek | None:
    week = int(match["week"])
    if not 1 <= week <= 53:
        return None
    year_text = match["slash_year"] or match["space_year"]
    year = None
    if year_text is not None:
        year = int(year_text) + (2000 if len(year_text) == 2 else 0)
    return CalendarWeek(week, year)


def parse_calendar_week(text: str) -> CalendarWeek | None:
    """Parse a whole string as one calendar week, or return None."""
    match = _CALENDAR_WEEK.fullmatch(text.strip())
    return _match_to_week(match) if match else None


def extract_calendar_weeks(text: str) -> list[CalendarWeek]:
    weeks: list[CalendarWeek] = []
    for match in _CALENDAR_WEEK.finditer(text):
        value = _match_to_week(match)
        if value is not None:
            weeks.append(value)
    return weeks


def canonical_unit(text: str) -> str | None:
    """The canonical unit (mm, cm, m, kg, t, pcs) for a known spelling, else None."""
    key = normalize_text(text).removesuffix(".")
    return _UNITS.get(key)


def _phone_digits(text: str) -> str:
    text = text.strip()
    digits = re.sub(r"\D", "", text)
    return f"+{digits}" if text.startswith("+") else digits


@dataclass(frozen=True)
class ValueCheck:
    """Result of checking a value against its quote.

    ``normalized`` is the value to return when ``ok`` (see the module docstring per kind).
    ``ambiguous`` is set when the quote holds more than one distinct date, so the quote alone
    cannot prove which one the value refers to. ``calendar_week`` is set when a date field only
    has a calendar week: consistent with the quote, but no date.
    """

    ok: bool
    normalized: str | None = None
    ambiguous: bool = False
    calendar_week: bool = False


_NOT_OK = ValueCheck(ok=False)


def _contains_words(needle: str, haystack: str) -> bool:
    # Whole tokens only: "G" or "bau GmbH" are not supported by "Musterbau GmbH".
    return re.search(rf"(?<!\w){re.escape(needle)}(?!\w)", haystack) is not None


def _check_text(value: str, quote: str) -> ValueCheck:
    needle = normalize_text(value)
    if not needle or not _contains_words(needle, normalize_text(quote)):
        return _NOT_OK
    return ValueCheck(ok=True, normalized=value.strip())


def _check_date(value: str, quote: str) -> ValueCheck:
    parsed_date = parse_date(value)
    if parsed_date is not None:
        dates = set(extract_dates(quote))
        if parsed_date not in dates:
            return _NOT_OK
        return ValueCheck(ok=True, normalized=parsed_date.isoformat(), ambiguous=len(dates) > 1)
    week = parse_calendar_week(value)
    if week is None:
        return _NOT_OK
    for quoted in extract_calendar_weeks(quote):
        # A year the quote does not state was added by the model.
        if quoted.week == week.week and (week.year is None or week.year == quoted.year):
            return ValueCheck(ok=True, normalized=week.label(), calendar_week=True)
    return _NOT_OK


def _check_number(value: str, quote: str) -> ValueCheck:
    parsed_number = parse_number(value)
    if parsed_number is None or parsed_number not in extract_numbers(quote):
        return _NOT_OK
    return ValueCheck(ok=True, normalized=format_number(parsed_number))


def _check_unit(value: str, quote: str) -> ValueCheck:
    canonical = canonical_unit(value)
    if canonical is None:
        return _check_text(value, quote)
    # Exact match per cell (the whole quote is one cell when it has no border): no fuzziness.
    # A quote whose cells name different units (a whole row like `60 | Stk. | 12 | kg`) is
    # ambiguous: it does not prove which unit belongs to the item, so no cell counts (#50 review).
    cells = (canonical_unit(cell) for cell in _CELL_BORDER.split(quote))
    cell_units = {unit for unit in cells if unit is not None}
    if cell_units == {canonical}:
        return ValueCheck(ok=True, normalized=canonical)
    for match in _UNIT_AFTER_NUMBER.finditer(quote):
        if canonical_unit(match.group("unit")) == canonical:
            return ValueCheck(ok=True, normalized=canonical)
    return _NOT_OK


def _check_email(value: str, quote: str) -> ValueCheck:
    address = value.strip().lower()
    if not _EMAIL_SHAPE.fullmatch(address):
        return _NOT_OK
    pattern = rf"(?<![\w.+\-]){re.escape(address)}(?![\w\-]|\.\w)"
    if re.search(pattern, quote.casefold()) is None:
        return _NOT_OK
    return ValueCheck(ok=True, normalized=address)


def _check_phone(value: str, quote: str) -> ValueCheck:
    digits = _phone_digits(value)
    if len(digits.lstrip("+")) < _MIN_PHONE_DIGITS or not re.fullmatch(
        r"\+?[\d \u00a0/()\-]+", value.strip()
    ):
        return _NOT_OK
    if all(_phone_digits(m.group(0)) != digits for m in _PHONE_IN_TEXT.finditer(quote)):
        return _NOT_OK
    return ValueCheck(ok=True, normalized=value.strip())


def check_value(kind: ValueKind, value: str, quote: str) -> ValueCheck:
    """Check that the value is supported by the quote (the quote itself is checked elsewhere)."""
    if kind == "text":
        return _check_text(value, quote)
    if kind == "date":
        return _check_date(value, quote)
    if kind == "number":
        return _check_number(value, quote)
    if kind == "unit":
        return _check_unit(value, quote)
    if kind == "email":
        return _check_email(value, quote)
    return _check_phone(value, quote)


def value_consistent(kind: ValueKind, value: str, quote: str) -> bool:
    """True when the value is supported by the quote (the quote itself is checked elsewhere)."""
    return check_value(kind, value, quote).ok

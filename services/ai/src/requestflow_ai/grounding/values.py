"""Value parsing for the consistency check between a field value and its quote.

Numbers: German formats (``1.234,5``, ``1.250``, ``0,75``, ``1 234,5``) and plain decimals
(``1234.5``). A dot followed by exactly three-digit groups is a thousands separator.
Dates: ``DD.MM.YYYY``, ``D.M.YY`` (two-digit years are 20YY) and ISO ``YYYY-MM-DD``.
"""

from __future__ import annotations

import re
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Literal

from requestflow_ai.grounding.normalize import normalize_text

ValueKind = Literal["text", "number", "date"]

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


def value_consistent(kind: ValueKind, value: str, quote: str) -> bool:
    """True when the value is supported by the quote (the quote itself is checked elsewhere)."""
    if kind == "text":
        needle = normalize_text(value)
        return bool(needle) and needle in normalize_text(quote)
    if kind == "date":
        parsed_date = parse_date(value)
        return parsed_date is not None and parsed_date in extract_dates(quote)
    parsed_number = parse_number(value)
    return parsed_number is not None and parsed_number in extract_numbers(quote)

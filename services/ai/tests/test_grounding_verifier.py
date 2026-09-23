"""The verifier decides ``found``; the model only proposes (ADR-0001 D8, DR1)."""

from __future__ import annotations

import pytest
from conftest import body_segment, pdf_segment

from requestflow_ai.extraction.schema import ModelEvidence, ModelExtraction, ModelField
from requestflow_ai.grounding.verifier import verify_extraction, verify_field
from requestflow_ai.parsing.segments import Segment

SEGMENTS: dict[str, Segment] = {
    s.id: s
    for s in [
        pdf_segment("p1-l1", "Musterbau Beispiel GmbH"),
        pdf_segment("p1-l4", "Ansprechpartner: Erika Mustermann"),
        pdf_segment("p1-l6", "Gewuenschter Liefer-\ntermin: 15.11.2026"),
        body_segment("eml-l3", "Bitte liefern Sie bis 5.1.27."),
    ]
}


def field(
    value: str | None, status: str, segment_id: str | None = None, quote: str | None = None
) -> ModelField:
    evidence = (
        ModelEvidence(segment_id=segment_id, quote=quote)
        if segment_id is not None and quote is not None
        else None
    )
    return ModelField(value=value, status=status, evidence=evidence)  # type: ignore[arg-type]


def test_found_with_exact_quote_stays_found() -> None:
    result = verify_field(
        field("Musterbau Beispiel GmbH", "found", "p1-l1", "Musterbau Beispiel GmbH"),
        "text",
        SEGMENTS,
    )
    assert result.status == "found"
    assert result.reason is None
    assert result.model_status == "found"
    assert result.evidence is not None
    assert result.evidence.segment_id == "p1-l1"


def test_found_with_quote_matching_only_after_normalisation_stays_found() -> None:
    result = verify_field(
        field("2026-11-15", "found", "p1-l6", "GEWUENSCHTER  liefertermin: 15.11.2026"),
        "date",
        SEGMENTS,
    )
    assert result.status == "found"


def test_quote_not_in_cited_segment_is_unverified() -> None:
    result = verify_field(
        field("Musterbau Beispiel GmbH", "found", "p1-l4", "Musterbau Beispiel GmbH"),
        "text",
        SEGMENTS,
    )
    assert result.status == "unverified"
    assert result.reason == "quote_not_in_segment"
    # The model's proposal stays visible for the human reviewer.
    assert result.value == "Musterbau Beispiel GmbH"
    assert result.model_status == "found"


def test_invented_quote_is_unverified() -> None:
    result = verify_field(field("Beispiel AG", "found", "p1-l1", "Beispiel AG"), "text", SEGMENTS)
    assert result.status == "unverified"
    assert result.reason == "quote_not_in_segment"


def test_unknown_segment_is_unverified() -> None:
    result = verify_field(
        field("Musterbau Beispiel GmbH", "found", "p9-l9", "Musterbau Beispiel GmbH"),
        "text",
        SEGMENTS,
    )
    assert result.status == "unverified"
    assert result.reason == "unknown_segment"


def test_empty_quote_is_unverified() -> None:
    result = verify_field(field("Musterbau", "found", "p1-l1", "   "), "text", SEGMENTS)
    assert result.status == "unverified"
    assert result.reason == "empty_quote"


def test_found_without_evidence_is_unverified() -> None:
    result = verify_field(field("Musterbau Beispiel GmbH", "found"), "text", SEGMENTS)
    assert result.status == "unverified"
    assert result.reason == "no_evidence"


def test_found_without_value_is_unverified() -> None:
    result = verify_field(
        field(None, "found", "p1-l1", "Musterbau Beispiel GmbH"), "text", SEGMENTS
    )
    assert result.status == "unverified"
    assert result.reason == "no_value"


def test_value_not_supported_by_quote_is_unverified() -> None:
    # The quote is real, but the value says something else.
    result = verify_field(
        field("Evil Corp", "found", "p1-l1", "Musterbau Beispiel GmbH"), "text", SEGMENTS
    )
    assert result.status == "unverified"
    assert result.reason == "value_not_in_quote"


def test_date_value_inconsistent_with_quote_is_unverified() -> None:
    result = verify_field(field("2026-11-16", "found", "p1-l6", "15.11.2026"), "date", SEGMENTS)
    assert result.status == "unverified"
    assert result.reason == "value_not_in_quote"


def test_short_german_date_in_quote_is_consistent_with_iso_value() -> None:
    result = verify_field(field("2027-01-05", "found", "eml-l3", "bis 5.1.27"), "date", SEGMENTS)
    assert result.status == "found"


def test_missing_with_null_value_stays_missing() -> None:
    result = verify_field(field(None, "missing"), "text", SEGMENTS)
    assert result.status == "missing"
    assert result.value is None
    assert result.evidence is None


def test_missing_with_value_is_unverified() -> None:
    result = verify_field(field("Musterbau", "missing"), "text", SEGMENTS)
    assert result.status == "unverified"
    assert result.reason == "missing_with_value"


def test_missing_drops_stray_evidence() -> None:
    result = verify_field(
        field(None, "missing", "p1-l1", "Musterbau Beispiel GmbH"), "text", SEGMENTS
    )
    assert result.status == "missing"
    assert result.evidence is None


def test_uncertain_with_verified_quote_stays_uncertain_never_promoted() -> None:
    result = verify_field(
        field("Erika Mustermann", "uncertain", "p1-l4", "Erika Mustermann"), "text", SEGMENTS
    )
    assert result.status == "uncertain"


def test_uncertain_with_bad_quote_is_unverified() -> None:
    result = verify_field(
        field("Erika Mustermann", "uncertain", "p1-l1", "Erika Mustermann"), "text", SEGMENTS
    )
    assert result.status == "unverified"


def test_uncertain_without_evidence_stays_uncertain() -> None:
    result = verify_field(field("Erika Mustermann", "uncertain"), "text", SEGMENTS)
    assert result.status == "uncertain"
    assert result.reason is None


def test_verify_extraction_applies_the_field_kinds() -> None:
    extraction = ModelExtraction(
        company=field("Musterbau Beispiel GmbH", "found", "p1-l1", "Musterbau Beispiel GmbH"),
        contact_person=field("Erika Mustermann", "found", "p1-l4", "Erika Mustermann"),
        # A date field is checked as a date: the text "15.11.2026" is consistent with the ISO value.
        requested_delivery_date=field("2026-11-15", "found", "p1-l6", "15.11.2026"),
    )
    results = verify_extraction(extraction, list(SEGMENTS.values()))
    assert set(results) == {"company", "contact_person", "requested_delivery_date"}
    assert all(r.status == "found" for r in results.values())


DATE_SEGMENTS: dict[str, Segment] = {
    s.id: s
    for s in [
        pdf_segment("p1-l1", "Musterbau GmbH"),
        pdf_segment("p1-l2", "Ansprechpartner: Max Mustermann"),
        pdf_segment("p1-l3", "Liefertermin: 15.10.2026"),
        pdf_segment("p1-l4", "Liefertermin: 15.10.26"),
        pdf_segment("p1-l5", "Liefertermin 15.11.2026, spaetestens 01.12.2026"),
    ]
}


@pytest.mark.parametrize(
    ("value", "segment_id", "quote"),
    [
        ("15.10.2026", "p1-l3", "15.10.2026"),
        ("15.10.26", "p1-l4", "15.10.26"),
        (" 2026-10-15 ", "p1-l3", "Liefertermin: 15.10.2026"),
        ("2026-10-15\n", "p1-l4", "15.10.26"),
    ],
)
def test_found_date_value_is_returned_as_iso_date(value: str, segment_id: str, quote: str) -> None:
    result = verify_field(field(value, "found", segment_id, quote), "date", DATE_SEGMENTS)
    assert result.status == "found"
    assert result.value == "2026-10-15"


def test_uncertain_date_with_verified_quote_is_returned_as_iso_date() -> None:
    result = verify_field(
        field("15.10.2026", "uncertain", "p1-l3", "15.10.2026"), "date", DATE_SEGMENTS
    )
    assert result.status == "uncertain"
    assert result.value == "2026-10-15"


@pytest.mark.parametrize("value", ["Mitte Oktober", "2026-10", "16.11.2026"])
def test_found_date_that_is_not_the_quoted_date_is_unverified(value: str) -> None:
    result = verify_field(
        field(value, "found", "p1-l5", "Liefertermin 15.11.2026"), "date", DATE_SEGMENTS
    )
    assert result.status == "unverified"
    assert result.reason == "value_not_in_quote"
    # The model's proposal stays visible, unchanged.
    assert result.value == value


def test_found_date_from_quote_with_two_dates_is_at_most_uncertain() -> None:
    quote = "Liefertermin 15.11.2026, spaetestens 01.12.2026"
    result = verify_field(field("2026-11-15", "found", "p1-l5", quote), "date", DATE_SEGMENTS)
    assert result.status == "uncertain"
    assert result.model_status == "found"
    assert result.reason == "ambiguous_quote"
    assert result.value == "2026-11-15"


def test_uncertain_date_from_quote_with_two_dates_stays_uncertain() -> None:
    quote = "Liefertermin 15.11.2026, spaetestens 01.12.2026"
    result = verify_field(field("01.12.2026", "uncertain", "p1-l5", quote), "date", DATE_SEGMENTS)
    assert result.status == "uncertain"
    assert result.value == "2026-12-01"


def test_found_text_value_is_trimmed() -> None:
    result = verify_field(
        field("  Musterbau GmbH\n", "found", "p1-l1", "Musterbau GmbH"), "text", DATE_SEGMENTS
    )
    assert result.status == "found"
    assert result.value == "Musterbau GmbH"


@pytest.mark.parametrize(
    ("value", "segment_id", "quote"),
    [
        ("G", "p1-l1", "Musterbau GmbH"),
        ("bau GmbH", "p1-l1", "Musterbau GmbH"),
        ("ax Mustermann", "p1-l2", "Max Mustermann"),
        ("Muster", "p1-l2", "Max Mustermann"),
    ],
)
def test_partial_token_text_value_is_unverified(value: str, segment_id: str, quote: str) -> None:
    result = verify_field(field(value, "found", segment_id, quote), "text", DATE_SEGMENTS)
    assert result.status == "unverified"
    assert result.reason == "value_not_in_quote"

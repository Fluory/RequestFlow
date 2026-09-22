"""PDF parsing with docling.

Two pipelines (``AI_PDF_PIPELINE``):

* ``textlines`` (default): docling's own PDF parser (docling-parse, the backend of
  ``DocumentConverter``) read directly. One segment per text line with page + bounding box.
  Needs **no ML models** and no network; deterministic. No OCR: a scan yields no segments.
* ``layout``: docling's ``DocumentConverter`` standard PDF pipeline with OCR and table structure
  off. It needs the layout model ``docling-project/docling-layout-heron`` from Hugging Face
  (~164 MB, fetched on first use or pre-fetched into the image). One segment per layout block.

docling is imported lazily: importing it pulls in torch and takes seconds, which ``/healthz`` and
the EML path should not pay.
"""

from __future__ import annotations

import functools
from io import BytesIO
from typing import TYPE_CHECKING, Any, Literal

from requestflow_ai.parsing.errors import DocumentParseError
from requestflow_ai.parsing.segments import BoundingBox, PdfLocator, Segment

if TYPE_CHECKING:
    from docling.document_converter import DocumentConverter

PdfPipeline = Literal["textlines", "layout"]


def parse_pdf_textlines(data: bytes) -> list[Segment]:
    from docling.backend.docling_parse_backend import ThreadedDoclingParseDocumentBackend
    from docling.datamodel.backend_options import ThreadedDoclingParseBackendOptions
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.document import InputDocument

    try:
        in_doc = InputDocument(
            path_or_stream=BytesIO(data),
            format=InputFormat.PDF,
            backend=ThreadedDoclingParseDocumentBackend,
            filename="document.pdf",
            backend_options=ThreadedDoclingParseBackendOptions.model_validate(
                {"render_pages": False}
            ),
        )
    except Exception as exc:
        raise DocumentParseError("could not load PDF") from exc
    backend: Any = getattr(in_doc, "_backend", None)
    if not in_doc.valid or backend is None:
        raise DocumentParseError("could not load PDF")

    pages: dict[int, list[Segment]] = {}
    try:
        for page in backend.iter_pages():
            if not page.is_valid():
                raise DocumentParseError("could not parse a PDF page")
            page_no = int(page.page_no)
            lines: list[Segment] = []
            for cell in page.get_text_cells():
                text = " ".join(str(cell.text).split())
                if not text:
                    continue
                box = cell.rect.to_bounding_box()  # top-left origin (converted by the backend)
                lines.append(
                    Segment(
                        id=f"p{page_no}-l{len(lines) + 1}",
                        text=text,
                        locator=PdfLocator(
                            page=page_no,
                            bbox=BoundingBox(
                                l=round(box.l, 2),
                                t=round(box.t, 2),
                                r=round(box.r, 2),
                                b=round(box.b, 2),
                            ),
                        ),
                    )
                )
            pages[page_no] = lines
    except DocumentParseError:
        raise
    except Exception as exc:
        raise DocumentParseError("could not parse PDF") from exc
    finally:
        backend.unload()

    # The threaded parser may yield pages out of order.
    return [segment for page_no in sorted(pages) for segment in pages[page_no]]


@functools.cache
def _layout_converter() -> DocumentConverter:
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import PdfPipelineOptions
    from docling.document_converter import DocumentConverter, PdfFormatOption

    options = PdfPipelineOptions(do_ocr=False, do_table_structure=False)
    return DocumentConverter(
        allowed_formats=[InputFormat.PDF],
        format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=options)},
    )


def parse_pdf_layout(data: bytes) -> list[Segment]:
    from docling.datamodel.base_models import ConversionStatus, DocumentStream

    try:
        result = _layout_converter().convert(
            DocumentStream(name="document.pdf", stream=BytesIO(data)), raises_on_error=False
        )
    except Exception as exc:
        raise DocumentParseError("could not convert PDF") from exc
    if result.status not in (ConversionStatus.SUCCESS, ConversionStatus.PARTIAL_SUCCESS):
        raise DocumentParseError("could not convert PDF")

    document = result.document
    counters: dict[int, int] = {}
    segments: list[Segment] = []
    for item, _level in document.iterate_items():
        text = " ".join(str(getattr(item, "text", "") or "").split())
        provenance = getattr(item, "prov", None) or []
        if not text or not provenance:
            continue
        prov = provenance[0]  # items spanning pages keep their first location
        page_no = int(prov.page_no)
        page_height = document.pages[page_no].size.height
        box = prov.bbox.to_top_left_origin(page_height=page_height)
        counters[page_no] = counters.get(page_no, 0) + 1
        segments.append(
            Segment(
                id=f"p{page_no}-b{counters[page_no]}",
                text=text,
                locator=PdfLocator(
                    page=page_no,
                    bbox=BoundingBox(
                        l=round(box.l, 2), t=round(box.t, 2), r=round(box.r, 2), b=round(box.b, 2)
                    ),
                ),
            )
        )
    return segments


def parse_pdf(data: bytes, pipeline: PdfPipeline) -> list[Segment]:
    if pipeline == "layout":
        return parse_pdf_layout(data)
    return parse_pdf_textlines(data)

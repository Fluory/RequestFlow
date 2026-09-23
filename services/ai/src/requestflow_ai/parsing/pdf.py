"""PDF parsing with docling.

Two pipelines (``AI_PDF_PIPELINE``):

* ``textlines`` (default): docling's own PDF parser (docling-parse, the backend of
  ``DocumentConverter``) read directly. One segment per text line with page + bounding box.
  Needs **no ML models** and no network; deterministic. No OCR: a scan yields no segments.
* ``layout``: docling's ``DocumentConverter`` standard PDF pipeline with OCR and table structure
  off. It needs the layout model ``docling-project/docling-layout-heron`` from Hugging Face
  (~164 MB, fetched on first use or pre-fetched into the image). One segment per layout block.

docling is imported lazily: importing it pulls in torch and takes seconds, which ``/healthz`` and
the EML path should not pay. With ``layout`` the converter and its model are built at startup
(``prepare_pdf_pipeline``), so a missing model stops the service instead of failing each request.

Both pipelines reject a PDF with more than ``max_pages`` pages (``AI_MAX_PDF_PAGES``) before any
page is parsed; the page count comes from docling-parse, without a model.

OCR (``AI_PDF_OCR``): ``off`` (default) leaves a page without a text layer empty (a scan yields
no segments and the warning ``no_text``). ``auto`` runs docling's standard PDF pipeline with OCR
(RapidOCR on the torch backend, German/Latin recogniser, full-page OCR) **only on pages that have
no text** after the chosen pipeline ran; pages with a text layer are never OCR'd. It needs the
layout model plus the RapidOCR models (~31 MB) and is built at startup (fail-closed like
``layout``). OCR segments get ids ``p{page}-o{n}`` and ``locator.ocr = true``; the verifier caps
a field whose evidence is OCR text at ``uncertain`` (reason ``ocr_only``). The flag is per page:
text docling reads from a PDF's own (invisible) text layer, e.g. a scanner's OCR, is not flagged,
because nothing in the PDF says where it came from. At most ``MAX_OCR_PAGES`` pages are OCR'd per
document (CPU time); more -> ``DocumentTooLongError``.
"""

from __future__ import annotations

import functools
from io import BytesIO
from typing import TYPE_CHECKING, Any, Literal

from requestflow_ai.parsing.errors import (
    DocumentParseError,
    DocumentTooLongError,
    PdfPipelineInitError,
)
from requestflow_ai.parsing.segments import BoundingBox, PdfLocator, Segment

if TYPE_CHECKING:
    from docling.document_converter import DocumentConverter

PdfPipeline = Literal["textlines", "layout"]
PdfOcr = Literal["off", "auto"]
DEFAULT_MAX_PAGES = 50
MAX_OCR_PAGES = 10
OCR_LANGUAGE = "iso:de"  # PP-OCRv6 recogniser; covers Latin script incl. umlauts

Pages = dict[int, list[Segment]]


def _page_count(data: bytes, max_pages: int) -> int:
    backend = _load_pdf(data, max_pages)
    try:
        return int(backend.page_count())
    finally:
        backend.unload()


def _load_pdf(data: bytes, max_pages: int) -> Any:
    """Load the PDF with docling-parse (no model), enforce the page cap, return the backend."""
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
    if in_doc.page_count > max_pages:
        backend.unload()
        raise DocumentTooLongError(f"document has more than {max_pages} pages")
    return backend


def parse_pdf_textlines(data: bytes, max_pages: int = DEFAULT_MAX_PAGES) -> list[Segment]:
    return _flatten(_textline_pages(data, max_pages))


def _flatten(pages: Pages) -> list[Segment]:
    # The threaded parser may yield pages out of order.
    return [segment for page_no in sorted(pages) for segment in pages[page_no]]


def _textline_pages(data: bytes, max_pages: int) -> Pages:
    backend = _load_pdf(data, max_pages)
    pages: Pages = {}
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
    return pages


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


@functools.cache
def _ocr_converter() -> DocumentConverter:
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import OcrMode, PdfPipelineOptions, RapidOcrOptions
    from docling.document_converter import DocumentConverter, PdfFormatOption

    options = PdfPipelineOptions(
        do_ocr=True,
        do_table_structure=False,
        # torch is installed for docling anyway; the default onnxruntime backend is not.
        # Full-page OCR: only pages without a text layer ever reach this converter.
        ocr_options=RapidOcrOptions(backend="torch", lang=[OCR_LANGUAGE], mode=OcrMode.FULL_PAGE),
    )
    return DocumentConverter(
        allowed_formats=[InputFormat.PDF],
        format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=options)},
    )


def prepare_pdf_pipeline(pipeline: PdfPipeline, ocr: PdfOcr = "off") -> None:
    """Build what the pipeline needs at startup; raise ``PdfPipelineInitError`` (fail-closed)."""
    if pipeline != "layout" and ocr != "auto":
        return  # textlines without OCR needs no model (and no docling import at startup)
    from docling.datamodel.base_models import InputFormat

    if pipeline == "layout":
        try:
            # Instantiates docling's standard PDF pipeline, which loads the layout model.
            _layout_converter().initialize_pipeline(InputFormat.PDF)
        except Exception as exc:
            raise PdfPipelineInitError(
                f"layout PDF pipeline unavailable ({type(exc).__name__}); refusing to start"
            ) from exc
    if ocr == "auto":
        try:
            # Loads the layout model and the RapidOCR models.
            _ocr_converter().initialize_pipeline(InputFormat.PDF)
        except Exception as exc:
            raise PdfPipelineInitError(
                f"OCR PDF pipeline unavailable ({type(exc).__name__}); refusing to start"
            ) from exc


def _document_pages(document: Any, block: str, ocr: bool) -> Pages:
    """Segments per page from a docling document: one per text item with provenance."""
    pages: Pages = {}
    for item, _level in document.iterate_items():
        text = " ".join(str(getattr(item, "text", "") or "").split())
        provenance = getattr(item, "prov", None) or []
        if not text or not provenance:
            continue
        prov = provenance[0]  # items spanning pages keep their first location
        page_no = int(prov.page_no)
        page_height = document.pages[page_no].size.height
        box = prov.bbox.to_top_left_origin(page_height=page_height)
        segments = pages.setdefault(page_no, [])
        segments.append(
            Segment(
                id=f"p{page_no}-{block}{len(segments) + 1}",
                text=text,
                locator=PdfLocator(
                    page=page_no,
                    bbox=BoundingBox(
                        l=round(box.l, 2), t=round(box.t, 2), r=round(box.r, 2), b=round(box.b, 2)
                    ),
                    ocr=ocr,
                ),
            )
        )
    return pages


def _convert(converter: DocumentConverter, data: bytes, page_range: tuple[int, int] | None) -> Any:
    from docling.datamodel.base_models import ConversionStatus, DocumentStream

    stream = DocumentStream(name="document.pdf", stream=BytesIO(data))
    try:
        if page_range is None:
            result = converter.convert(stream, raises_on_error=False)
        else:
            result = converter.convert(stream, raises_on_error=False, page_range=page_range)
    except Exception as exc:
        raise DocumentParseError("could not convert PDF") from exc
    if result.status not in (ConversionStatus.SUCCESS, ConversionStatus.PARTIAL_SUCCESS):
        raise DocumentParseError("could not convert PDF")
    return result.document


def parse_pdf_layout(data: bytes, max_pages: int = DEFAULT_MAX_PAGES) -> list[Segment]:
    return _flatten(_layout_pages(data, max_pages))


def _layout_pages(data: bytes, max_pages: int) -> Pages:
    # Model-free page count first: a too long PDF never reaches the layout model.
    _page_count(data, max_pages)
    return _document_pages(_convert(_layout_converter(), data, None), "b", ocr=False)


def _ocr_pages(data: bytes, page_numbers: list[int]) -> Pages:
    if len(page_numbers) > MAX_OCR_PAGES:
        raise DocumentTooLongError(f"document has more than {MAX_OCR_PAGES} pages without text")
    pages: Pages = {}
    for page_no in page_numbers:
        document = _convert(_ocr_converter(), data, (page_no, page_no))
        pages[page_no] = _document_pages(document, "o", ocr=True).get(page_no, [])
    return pages


def parse_pdf(
    data: bytes, pipeline: PdfPipeline, max_pages: int = DEFAULT_MAX_PAGES, ocr: PdfOcr = "off"
) -> list[Segment]:
    if pipeline == "layout":
        pages = _layout_pages(data, max_pages)
    else:
        pages = _textline_pages(data, max_pages)
    if ocr == "auto":
        without_text = [
            page_no
            for page_no in range(1, _page_count(data, max_pages) + 1)
            if not pages.get(page_no)
        ]
        if without_text:
            pages.update(_ocr_pages(data, without_text))
    return _flatten(pages)

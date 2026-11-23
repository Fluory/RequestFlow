"""Writes the animated SVGs of the README, light and dark: the title lockup and the pipeline.

    python3 docs/readme/svg.py      (after `pnpm install`: reads the fonts from node_modules/@fontsource)

Text is converted to outlines with fontTools from the app's own typeface (IBM Plex Sans / Mono,
SIL Open Font License), so the files carry no font and no external reference. Colours are the app's
tokens (src/app/globals.css); the dark variant is derived from them for the README only. The motion is
CSS inside the SVG, which GitHub plays in an <img>: the title settles once, the pipeline loops calmly,
and both stand still under prefers-reduced-motion. The stages follow the data flow of
docs/technical/architecture.md.
"""
import os

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "docs", "readme")
FS = os.path.join(ROOT, "node_modules", "@fontsource")


def font(family, weight):
    return TTFont(os.path.join(FS, family, "files", f"{family}-latin-{weight}-normal.woff2"))


FONTS = {
    "s400": font("ibm-plex-sans", 400),
    "s500": font("ibm-plex-sans", 500),
    "s600": font("ibm-plex-sans", 600),
    "s700": font("ibm-plex-sans", 700),
    "m400": font("ibm-plex-mono", 400),
}

THEMES = {
    "light": dict(bg="#f6f5f1", surface="#fffefb", header="#efede7", border="#dcd9d1", text="#1d1c1a",
                  text2="#3d3b37", muted="#6b6860", brand="#1f4fa3", warn="#b58100", warnbg="#fdf0cc",
                  warntext="#5c3c00", ok="#1f4a24", okbg="#e3f0e4"),
    "dark": dict(bg="#181715", surface="#211f1c", header="#2a2824", border="#3b3934", text="#eeebe4",
                 text2="#d3cfc6", muted="#a9a499", brand="#7ea2e8", warn="#d8a52a", warnbg="#3a2f12",
                 warntext="#f3cc72", ok="#a6d8ab", okbg="#1d3322"),
}

STAGES = [
    ("1", "Upload", ".eml .msg PDF XLSX DOCX"),
    ("2", "Parse", "segments with locators"),
    ("3", "Extract", "value + quote per field"),
    ("4", "Verify", "quote in the cited segment?"),
    ("5", "Review", "beside the source"),
    ("6", "Approve", "a person decides"),
    ("7", "Export", "idempotency key, once"),
]


def width(text, face, size):
    f = FONTS[face]
    cmap = f.getBestCmap()
    hmtx = f["hmtx"]
    return sum(hmtx[cmap[ord(c)]][0] for c in text) * size / f["head"].unitsPerEm


def text_path(text, face, size, x, y, anchor="start"):
    """SVG path data of `text` with its baseline at y."""
    f = FONTS[face]
    cmap = f.getBestCmap()
    glyphs = f.getGlyphSet()
    hmtx = f["hmtx"]
    scale = size / f["head"].unitsPerEm
    if anchor == "middle":
        x -= width(text, face, size) / 2
    elif anchor == "end":
        x -= width(text, face, size)
    pen = SVGPathPen(glyphs, ntos=lambda v: f"{v:.1f}".rstrip("0").rstrip("."))
    cursor = x
    for ch in text:
        name = cmap[ord(ch)]
        glyphs[name].draw(TransformPen(pen, (scale, 0, 0, -scale, cursor, y)))
        cursor += hmtx[name][0] * scale
    return pen.getCommands()


def t(text, face, size, x, y, fill, anchor="start", cls=""):
    c = f' class="{cls}"' if cls else ""
    return f'<path{c} fill="{fill}" d="{text_path(text, face, size, x, y, anchor)}"/>'


def title(theme):
    c = THEMES[theme]
    w, h = 1600, 300
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" role="img">',
        "<title>RequestFlow – quote requests, reviewed beside their source, exported exactly once. Portfolio project by Florian Hein.</title>",
        "<style>",
        ".in{opacity:0;animation:in .9s cubic-bezier(.2,.7,.2,1) forwards}",
        ".d1{animation-delay:.15s}.d2{animation-delay:.45s}.d3{animation-delay:.75s}",
        "@keyframes in{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}",
        ".mark{transform-origin:84px 92px;transform-box:view-box;animation:mark 1s cubic-bezier(.2,.7,.2,1) forwards}",
        "@keyframes mark{from{transform:scale(.4) rotate(-90deg);opacity:0}to{transform:none;opacity:1}}",
        ".hl{transform-origin:0 0;transform-box:fill-box;transform:scaleX(0);animation:hl .7s 1.2s cubic-bezier(.2,.7,.2,1) forwards}",
        "@keyframes hl{to{transform:scaleX(1)}}",
        "@media (prefers-reduced-motion:reduce){.in,.mark,.hl{animation:none;opacity:1;transform:none}}",
        "</style>",
        f'<rect width="{w}" height="{h}" fill="{c["bg"]}"/>',
        f'<rect class="mark" x="64" y="72" width="40" height="40" rx="6" fill="{c["brand"]}"/>',
        f'<g class="in">{t("RequestFlow", "s700", 72, 128, 116, c["text"])}</g>',
    ]
    line = "Quote requests, reviewed beside their source – "
    lx = 66
    lw = width(line, "s500", 30)
    hw = width("exported exactly once.", "s600", 30)
    parts.append(f'<rect class="hl" x="{lx + lw - 4:.1f}" y="164" width="{hw + 8:.1f}" height="40" rx="3" fill="{c["warnbg"]}"/>')
    parts.append(f'<g class="in d1">{t(line, "s500", 30, lx, 194, c["text2"])}{t("exported exactly once.", "s600", 30, lx + lw, 194, c["text"])}</g>')
    parts.append(f'<g class="in d2">{t("Portfolio project by Florian Hein  ·  reference project with a fictional customer  ·  all data synthetic", "m400", 17, lx, 250, c["muted"])}</g>')
    parts.append("</svg>")
    return "\n".join(parts)


def pipeline(theme):
    c = THEMES[theme]
    w, h = 1600, 350
    n = len(STAGES)
    margin, gap = 40, 18
    bw = (w - 2 * margin - (n - 1) * gap) / n
    by, bh = 124, 128
    cy = by - 14  # the track runs above the cards
    period = 9.0
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" role="img">',
        "<title>Pipeline: upload, parse, extract with a quote, verify the quote, review beside the source, approve, export exactly once.</title>",
        "<style>",
        f".dot{{animation:run {period}s linear infinite}}",
        f"@keyframes run{{from{{transform:translateX(0)}}to{{transform:translateX({w - 2 * margin - bw:.1f}px)}}}}",
        f".st{{animation:st {period}s linear infinite}}",
        "@keyframes st{0%,100%{opacity:0}2%,9%{opacity:1}14%{opacity:0}}",
        "@media (prefers-reduced-motion:reduce){.dot,.st{animation:none}.st{opacity:0}}",
        "</style>",
        f'<rect width="{w}" height="{h}" fill="{c["bg"]}"/>',
        t("From mail to ERP", "s600", 20, margin, 52, c["text"]),
        t("Every value carries the quote it came from; nothing reaches the ERP without a person's approval, and nothing reaches it twice.",
          "s400", 15, margin, 76, c["muted"]),
        f'<line x1="{margin + bw / 2:.1f}" y1="{cy}" x2="{w - margin - bw / 2:.1f}" y2="{cy}" stroke="{c["border"]}" stroke-width="2"/>',
    ]
    for i, (num, name, sub) in enumerate(STAGES):
        x = margin + i * (bw + gap)
        human = name in ("Review", "Approve")
        gate = name == "Verify"
        stroke = c["brand"] if human else (c["warn"] if gate else c["border"])
        parts.append(f'<rect x="{x:.1f}" y="{by}" width="{bw:.1f}" height="{bh}" rx="3" fill="{c["surface"]}" stroke="{stroke}" stroke-width="{1.5 if (human or gate) else 1}"/>')
        delay = period * (i / (n - 1)) * 0.86
        parts.append(f'<rect class="st" style="animation-delay:{delay - period:.2f}s" x="{x:.1f}" y="{by}" width="{bw:.1f}" height="4" rx="2" fill="{c["brand"]}"/>')
        parts.append(t(num, "m400", 13, x + 16, by + 30, c["brand"]))
        parts.append(t(name, "s600", 19, x + 16, by + 62, c["text"]))
        parts.append(t(sub, "s400", 12.5, x + 16, by + 88, c["muted"]))
        if human:
            parts.append(t("person", "m400", 11.5, x + 16, by + bh - 14, c["brand"]))
        if gate:
            parts.append(t("AI service", "m400", 11.5, x + 16, by + bh - 14, c["muted"]))
        if name in ("Parse", "Extract"):
            parts.append(t("AI service", "m400", 11.5, x + 16, by + bh - 14, c["muted"]))
    # Verify, not confirmed: the value is not "found" (missing/uncertain) and waits for the person.
    vx = margin + 3 * (bw + gap)
    parts.append(f'<path d="M{vx + bw / 2:.1f} {by + bh} V{by + bh + 36} H{vx + bw + gap + bw / 2:.1f} V{by + bh + 2}" fill="none" stroke="{c["warn"]}" stroke-width="1.5" stroke-dasharray="4 4"/>')
    parts.append(t("quote not confirmed: never “found”, flagged for the review", "s500", 13, vx + 10, by + bh + 60, c["warntext"]))
    ex = margin + 6 * (bw + gap)
    parts.append(t("repeated delivery: same ERP reference", "s500", 13, ex + bw, by + bh + 60, c["ok"], anchor="end"))
    parts.append(f'<circle class="dot" cx="{margin + bw / 2:.1f}" cy="{cy}" r="6" fill="{c["brand"]}"/>')
    parts.append("</svg>")
    return "\n".join(parts)


for theme in THEMES:
    for name, build in (("title", title), ("pipeline", pipeline)):
        path = os.path.join(OUT, f"{name}-{theme}.svg")
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(build(theme))
        print(f"-> {path}: {os.path.getsize(path) / 1024:.0f} KB")

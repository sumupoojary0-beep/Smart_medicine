"""
Downloadable PDF reports for a Kendra.

    out_of_stock_pdf(kendra_id, user)  -> bytes   medicines with no sellable stock
    expired_pdf(kendra_id, user)       -> bytes   expired batches still on the shelf

Both use get_inventory_dashboard(), so the PDF always agrees with the
Inventory Dashboard on screen (expired units are never counted as sellable).
"""

import io
from datetime import datetime, timedelta, timezone

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.database.connection import get_database
from app.services.kendra_service import get_inventory_dashboard

IST = timezone(timedelta(hours=5, minutes=30))
GREEN = colors.HexColor("#15803d")
DARK = colors.HexColor("#0f172a")
GREY = colors.HexColor("#64748b")
LINE = colors.HexColor("#e2e8f0")
ZEBRA = colors.HexColor("#f8fafc")


def _fmt_date(value) -> str:
    if not value:
        return "-"
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(IST).strftime("%d %b %Y")


async def _catalogue(codes: list[str]) -> dict:
    db = get_database()
    found = {}
    if codes:
        async for med in db["medicines"].find({"pmbi_code": {"$in": codes}}):
            found[med["pmbi_code"]] = med
    return found


def _build_pdf(title: str, kendra_name: str, summary_line: str, headers: list[str],
               rows: list[list], widths: list[float], empty_text: str) -> bytes:
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=A4, leftMargin=14 * mm, rightMargin=14 * mm,
        topMargin=14 * mm, bottomMargin=16 * mm, title=f"{title} - {kendra_name}",
        author="Smart Medicine System",
    )
    styles = getSampleStyleSheet()
    h1 = ParagraphStyle("h1", parent=styles["Title"], fontSize=18, textColor=DARK, alignment=0, spaceAfter=2)
    sub = ParagraphStyle("sub", parent=styles["Normal"], fontSize=10, textColor=GREY, leading=14)
    cell = ParagraphStyle("cell", parent=styles["Normal"], fontSize=8.5, leading=11, textColor=DARK)
    head = ParagraphStyle("head", parent=cell, textColor=colors.white, fontName="Helvetica-Bold")

    generated = datetime.now(IST).strftime("%d %b %Y, %I:%M %p")
    story = [
        Paragraph(title, h1),
        Paragraph(f"<b>{kendra_name}</b>", sub),
        Paragraph(f"Generated {generated} (IST) &nbsp;|&nbsp; {summary_line}", sub),
        Spacer(1, 6 * mm),
    ]

    if not rows:
        story.append(Paragraph(empty_text, sub))
    else:
        data = [[Paragraph(h, head) for h in headers]]
        for row in rows:
            data.append([Paragraph(str(v), cell) for v in row])
        table = Table(data, colWidths=[w * mm for w in widths], repeatRows=1)
        style = [
            ("BACKGROUND", (0, 0), (-1, 0), GREEN),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LINEBELOW", (0, 0), (-1, -1), 0.4, LINE),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]
        for i in range(2, len(data), 2):
            style.append(("BACKGROUND", (0, i), (-1, i), ZEBRA))
        table.setStyle(TableStyle(style))
        story.append(table)

    def footer(canvas, document):
        canvas.saveState()
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(GREY)
        canvas.drawString(14 * mm, 9 * mm, "Smart Medicine System - Jan Aushadhi inventory report")
        canvas.drawRightString(A4[0] - 14 * mm, 9 * mm, f"Page {document.page}")
        canvas.restoreState()

    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return buffer.getvalue()


async def out_of_stock_pdf(kendra_id: str, current_user) -> tuple[bytes, str]:
    data = await get_inventory_dashboard(kendra_id, current_user)
    items = sorted(data["out_of_stock"], key=lambda r: r["medicine_name"].lower())
    catalogue = await _catalogue([i["pmbi_code"] for i in items])

    rows = []
    for n, item in enumerate(items, 1):
        med = catalogue.get(item["pmbi_code"], {})
        rows.append([
            n, item["pmbi_code"], item["medicine_name"],
            med.get("generic_name") or "-", med.get("pack_size") or "-",
        ])
    pdf = _build_pdf(
        "Out-of-stock medicines", data["kendra"]["name"],
        f"{len(rows)} medicine(s) with no sellable stock",
        ["#", "PMBI code", "Medicine", "Generic name", "Pack"],
        rows, [10, 24, 62, 62, 24],
        "Nothing is out of stock. Every medicine on your shelf has sellable units.",
    )
    return pdf, f"out-of-stock-{datetime.now(IST):%Y-%m-%d}.pdf"


async def expired_pdf(kendra_id: str, current_user) -> tuple[bytes, str]:
    data = await get_inventory_dashboard(kendra_id, current_user)
    items = sorted(data["expired"], key=lambda r: (r["expiry_date"] or datetime.min.replace(tzinfo=timezone.utc)))
    total_units = sum(i["quantity"] for i in items)

    rows = []
    for n, item in enumerate(items, 1):
        ago = -item["days_left"] if item["days_left"] is not None else None
        rows.append([
            n, item["medicine_name"], item["batch_number"] or "-",
            _fmt_date(item["expiry_date"]),
            f"{ago} day(s) ago" if ago is not None else "-",
            item["quantity"],
        ])
    pdf = _build_pdf(
        "Expired medicines", data["kendra"]["name"],
        f"{len(rows)} expired batch(es), {total_units} unit(s) to remove from the shelf",
        ["#", "Medicine", "Batch", "Expired on", "Expired", "Units"],
        rows, [10, 66, 30, 28, 28, 20],
        "No expired batches. Nothing needs to be removed from the shelf.",
    )
    return pdf, f"expired-medicines-{datetime.now(IST):%Y-%m-%d}.pdf"
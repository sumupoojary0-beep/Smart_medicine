"""
Upload safety: never trust the file name or the Content-Type header —
look at the first bytes of the file itself.
"""
from fastapi import HTTPException, status


def _bad(detail: str) -> HTTPException:
    return HTTPException(status.HTTP_400_BAD_REQUEST, detail)


def sniff_kind(data: bytes) -> str | None:
    """Return 'jpeg' | 'png' | 'webp' | 'pdf' | 'zip' | None from the file's magic bytes."""
    if data.startswith(b"\xff\xd8"):
        return "jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    if data.startswith(b"%PDF-"):
        return "pdf"
    if data.startswith(b"PK\x03\x04"):
        return "zip"  # .xlsx is a zip container
    return None


def verify_upload(kind: str, data: bytes) -> None:
    """
    `kind` is what the file claims to be: image | pdf | xlsx | csv.
    Raises HTTP 400 when the real content does not match.
    """
    real = sniff_kind(data[:16])

    if kind == "image":
        if real not in ("jpeg", "png", "webp"):
            raise _bad("This file is not a real JPG, PNG or WEBP image.")
    elif kind == "pdf":
        if real != "pdf":
            raise _bad("This file is not a real PDF.")
    elif kind == "xlsx":
        if real != "zip":
            raise _bad("This file is not a real Excel (.xlsx) file.")
    elif kind == "csv":
        sample = data[:4096]
        if b"\x00" in sample or real is not None:
            raise _bad("This file is not a plain CSV/text file.")
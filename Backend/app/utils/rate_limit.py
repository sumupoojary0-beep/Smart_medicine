"""
Small in-memory rate limiter (sliding window) — no extra libraries needed.

Use it two ways:
  1. As a route dependency, limited per client IP:
         @router.post("/login", dependencies=[Depends(ip_limit("login", 10, 60))])
  2. Inline, limited per key (e.g. per e-mail address):
         check_limit("login-email", email, 10, 900)

Exceeding a limit raises HTTP 429 with a Retry-After header.

NOTE: counters live in this process's memory. That is correct for one
server process (your project / a single container). If you later run several
workers, move the counters to Redis or MongoDB.
"""
import time
from collections import defaultdict, deque
from threading import Lock

from fastapi import HTTPException, Request, status

_hits: dict[str, deque] = defaultdict(deque)
_lock = Lock()
_MAX_KEYS = 20000  # safety valve so memory cannot grow without bound


def _purge(now: float) -> None:
    for key in [k for k, d in _hits.items() if not d or d[-1] < now - 86400]:
        _hits.pop(key, None)


def check_limit(name: str, key: str, limit: int, window_seconds: int) -> None:
    """Record one hit for (name, key); raise 429 when over `limit` per window."""
    now = time.monotonic()
    bucket_key = f"{name}:{(key or 'unknown').lower()}"
    with _lock:
        if len(_hits) > _MAX_KEYS:
            _purge(now)
        bucket = _hits[bucket_key]
        while bucket and bucket[0] <= now - window_seconds:
            bucket.popleft()
        if len(bucket) >= limit:
            retry_after = max(1, int(bucket[0] + window_seconds - now) + 1)
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Too many attempts. Please try again in {retry_after} seconds.",
                headers={"Retry-After": str(retry_after)},
            )
        bucket.append(now)


def client_ip(request: Request) -> str:
    # request.client is the direct peer. Behind a reverse proxy configure
    # uvicorn with --proxy-headers so this becomes the real visitor address.
    return request.client.host if request.client else "unknown"


def ip_limit(name: str, limit: int, window_seconds: int):
    """Dependency factory: limit a route per client IP."""

    async def _dependency(request: Request) -> None:
        check_limit(name, client_ip(request), limit, window_seconds)

    return _dependency


def reset_limits() -> None:
    """Clear all counters (used by tests)."""
    with _lock:
        _hits.clear()
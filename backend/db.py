from __future__ import annotations

import os
from contextlib import contextmanager

import psycopg


def get_database_url() -> str | None:
    url = (os.getenv("DATABASE_URL") or "").strip()
    if not url:
        return None

    # Some providers still hand out postgres:// URLs.
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://") :]

    return url


@contextmanager
def db_conn():
    url = get_database_url()
    if not url:
        raise RuntimeError("DATABASE_URL is not set")

    conn = psycopg.connect(url)
    try:
        yield conn
    finally:
        try:
            conn.close()
        except Exception:
            pass

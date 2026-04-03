from __future__ import annotations

import hashlib
import json
import secrets
from base64 import urlsafe_b64decode
from datetime import datetime, timedelta, timezone

from cryptography.fernet import Fernet

from app.core.config import get_settings


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def ensure_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def hash_secret(value: str) -> str:
    salt = secrets.token_hex(16)
    derived = hashlib.pbkdf2_hmac("sha256", value.encode("utf-8"), salt.encode("utf-8"), 200_000)
    return f"{salt}${derived.hex()}"


def verify_secret(value: str, encoded: str) -> bool:
    try:
        salt, digest = encoded.split("$", 1)
    except ValueError:
        return False
    derived = hashlib.pbkdf2_hmac("sha256", value.encode("utf-8"), salt.encode("utf-8"), 200_000)
    return secrets.compare_digest(derived.hex(), digest)


def issue_plain_secret(bytes_length: int = 32) -> str:
    return secrets.token_urlsafe(bytes_length)


def fernet() -> Fernet:
    settings = get_settings()
    raw = settings.broker_encryption_key.encode("utf-8")
    try:
        urlsafe_b64decode(raw)
    except Exception as exc:  # pragma: no cover - config failure
        raise RuntimeError("BROKER_ENCRYPTION_KEY must be urlsafe-base64 encoded") from exc
    return Fernet(raw)


def encrypt_text(value: str | None) -> str | None:
    if not value:
        return None
    return fernet().encrypt(value.encode("utf-8")).decode("utf-8")


def decrypt_text(value: str | None) -> str | None:
    if not value:
        return None
    return fernet().decrypt(value.encode("utf-8")).decode("utf-8")


def session_expiry(hours: int) -> datetime:
    return utcnow() + timedelta(hours=hours)


def dumps_json(value) -> str:
    return json.dumps(value, sort_keys=True)


def loads_json(value: str | None, fallback):
    if not value:
        return fallback
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return fallback

"""Single-login authentication with signed, expiring bearer tokens (standard library only)."""
import base64
import hashlib
import hmac
import json
import time
from collections import defaultdict

from . import profile
from .config import settings
from .errors import ApiError, unauthorized

_FAILS = defaultdict(list)          # client -> timestamps of failed logins
MAX_FAILS, LOCK_SECONDS = 5, 60


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _sign(payload: bytes) -> str:
    return _b64(hmac.new(settings.secret_key.encode(), payload, hashlib.sha256).digest())


def issue_token(subject: str) -> tuple[str, int]:
    exp = int(time.time() + settings.token_hours * 3600)
    payload = json.dumps({"sub": subject, "exp": exp}, separators=(",", ":")).encode()
    return f"{_b64(payload)}.{_sign(payload)}", exp


def verify_token(token: str) -> dict:
    try:
        body, sig = token.split(".", 1)
        payload = _unb64(body)
    except Exception:
        raise unauthorized("Invalid session token.", "invalid_token")
    if not hmac.compare_digest(sig, _sign(payload)):
        raise unauthorized("Invalid session token.", "invalid_token")
    data = json.loads(payload)
    if data.get("exp", 0) < time.time():
        raise unauthorized("Your session has expired. Please sign in again.", "session_expired")
    return data


def login(username: str, password: str, client: str = "-") -> dict:
    now = time.time()
    _FAILS[client] = [t for t in _FAILS[client] if now - t < LOCK_SECONDS]
    if len(_FAILS[client]) >= MAX_FAILS:
        raise ApiError(429, "too_many_attempts", "Too many failed sign-in attempts. Try again in a minute.")
    ok_user = hmac.compare_digest(username.strip().lower(), settings.username.strip().lower())
    ok_pass = profile.password_ok(password)
    if not (ok_user and ok_pass):
        _FAILS[client].append(now)
        raise unauthorized("Wrong username or password.", "wrong_credentials")
    _FAILS.pop(client, None)
    token, exp = issue_token(settings.username)
    return {"token": token, "name": profile.display_name(), "expires_at": exp}


def check_header(authorization: str | None) -> dict:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise unauthorized("Please sign in.", "not_authenticated")
    return verify_token(authorization.split(" ", 1)[1].strip())

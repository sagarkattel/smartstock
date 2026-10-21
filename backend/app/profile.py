"""Editable profile for the single login: display name, avatar and password.

Stored in data/state/profile.json. The password is kept as a salted PBKDF2 hash; until someone changes it,
the password from .env (SMARTSTOCK_PASSWORD) is the one that works. The username always comes from .env.
"""
import hashlib
import hmac
import json
import re
import secrets
import threading
from datetime import datetime
from pathlib import Path

from .config import settings
from .errors import ApiError, bad_input

AVATAR_RE = re.compile(r"^avatar-[1-8]$")
PBKDF2_ROUNDS = 200_000
MIN_PASSWORD, MAX_PASSWORD = 8, 200
_lock = threading.Lock()


def _path() -> Path:
    return settings.data_dir / "state" / "profile.json"


def _load() -> dict:
    try:
        return json.loads(_path().read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _save(data: dict):
    p = _path()
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2))
    tmp.replace(p)


def display_name() -> str:
    return _load().get("display_name") or settings.display_name


def avatar() -> str | None:
    return _load().get("avatar")


def update(name: str, avatar_id: str | None) -> dict:
    name = (name or "").strip()
    if not name or len(name) > 60:
        raise bad_input("The name must be 1 to 60 characters.", "invalid_name")
    if avatar_id is not None and not AVATAR_RE.match(avatar_id):
        raise bad_input("Choose one of the available avatars.", "invalid_avatar")
    with _lock:
        data = _load()
        data.update({"display_name": name, "avatar": avatar_id, "updated_at": datetime.now().isoformat(timespec="seconds")})
        _save(data)
    return {"name": name, "avatar": avatar_id}


def _hash(password: str, salt: bytes, rounds: int) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode(), salt, rounds).hex()


def password_ok(password: str) -> bool:
    stored = _load().get("password")
    if stored:
        return hmac.compare_digest(_hash(password, bytes.fromhex(stored["salt"]), stored["rounds"]), stored["hash"])
    return hmac.compare_digest(password, settings.password)


def change_password(current: str, new: str):
    if not password_ok(current):
        # 422, not 401: the person is signed in, they just typed the wrong current password.
        raise ApiError(422, "wrong_password", "The current password is not correct.")
    if not (MIN_PASSWORD <= len(new) <= MAX_PASSWORD):
        raise bad_input(f"The new password must be {MIN_PASSWORD} to {MAX_PASSWORD} characters.", "weak_password")
    if new == current:
        raise bad_input("The new password must be different from the current one.", "same_password")
    salt = secrets.token_bytes(16)
    with _lock:
        data = _load()
        data["password"] = {"salt": salt.hex(), "rounds": PBKDF2_ROUNDS, "hash": _hash(new, salt, PBKDF2_ROUNDS)}
        data["password_changed_at"] = datetime.now().isoformat(timespec="seconds")
        _save(data)

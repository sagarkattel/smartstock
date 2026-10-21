"""Dates: the current week (Australia/Sydney), period labels and horizon-confidence bands."""
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from .config import settings


def today() -> date:
    if settings.today_override:
        return date.fromisoformat(settings.today_override)
    return datetime.now(ZoneInfo(settings.timezone)).date()


def monday(d: date) -> date:
    return d - timedelta(days=d.weekday())


def week_label(start: date) -> str:
    end = start + timedelta(days=6)
    if start.year != end.year:
        return f"{start.day} {start:%b %Y} – {end.day} {end:%b %Y}"
    if start.month != end.month:
        return f"{start.day} {start:%b} – {end.day} {end:%b %Y}"
    return f"{start.day} – {end.day} {end:%b %Y}"


def month_label(period) -> str:
    return f"{period.start_time:%b %Y}"


def horizon_confidence(weeks_ahead: int) -> str:
    """weeks_ahead counts from the end of the data (1 = the first forecast week)."""
    if weeks_ahead <= 4:
        return "High"
    if weeks_ahead <= 12:
        return "Medium"
    return "Planning estimate"

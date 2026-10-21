"""Data upload: one-time upload tickets, file checks and the validation report.

Uploaded files are staged in data/uploads/<upload_id>/ and only merged into data/dataset/
when a retraining job that uses them succeeds.
"""
import re
import secrets
import shutil
import threading
import time
import uuid
from datetime import datetime, timedelta
from pathlib import Path

import pandas as pd

from .config import settings
from .errors import ApiError, bad_input, not_found
from .store import read_json, store, write_json

SALES_COLS = ["Asset ID", "Location", "Type", "Coil", "Item", "Sale Date Time", "Cashless Price"]
MACHINE_COLS = ["Asset ID"]
_tickets: dict[str, float] = {}
_lock = threading.Lock()


def upload_dir(upload_id: str) -> Path:
    if not re.fullmatch(r"[a-f0-9]{12}", upload_id or ""):
        raise not_found("Unknown upload.", "unknown_upload")
    return settings.data_dir / "uploads" / upload_id


def new_ticket() -> dict:
    tok = secrets.token_urlsafe(24)
    exp = time.time() + settings.upload_ticket_minutes * 60
    with _lock:
        for t, e in list(_tickets.items()):
            if e < time.time():
                _tickets.pop(t, None)
        _tickets[tok] = exp
    return {"upload_url": f"{settings.public_base_url}{settings.api_prefix}/admin/upload/{tok}",
            "ticket": tok, "expires_at": datetime.fromtimestamp(exp).isoformat(timespec="seconds"),
            "max_file_mb": settings.max_upload_mb,
            "accepted": "CashlessSalesAnalysis-<year>.xlsx (sheet 'Item') and optionally CashlessMachines.xlsx"}


def use_ticket(tok: str):
    with _lock:
        exp = _tickets.pop(tok, None)
    if exp is None or exp < time.time():
        raise ApiError(403, "invalid_upload_ticket", "This upload link has expired or was already used. Request a new one.")


def _year_from_name(name):
    m = re.search(r"(20\d{2})", name)
    return int(m.group(1)) if m else None


def save_files(files: list[tuple[str, bytes]]) -> str:
    """files: (original filename, content). Returns upload_id."""
    if not files:
        raise bad_input("No files were uploaded.", "no_files")
    upload_id = uuid.uuid4().hex[:12]
    d = settings.data_dir / "uploads" / upload_id
    d.mkdir(parents=True)
    for name, content in files:
        base = Path(name or "").name
        if not base.lower().endswith(".xlsx"):
            shutil.rmtree(d, ignore_errors=True)
            raise bad_input(f"'{base}' is not an .xlsx file.", "wrong_file_type")
        if len(content) > settings.max_upload_mb * 1024 * 1024:
            shutil.rmtree(d, ignore_errors=True)
            raise ApiError(413, "file_too_large", f"'{base}' is larger than {settings.max_upload_mb} MB.")
        if not content.startswith(b"PK"):
            shutil.rmtree(d, ignore_errors=True)
            raise bad_input(f"'{base}' is not a valid Excel file.", "wrong_file_type")
        (d / ("_in_" + re.sub(r"[^A-Za-z0-9._ -]", "_", base))).write_bytes(content)
    return upload_id


def validate(upload_id: str) -> dict:
    d = upload_dir(upload_id)
    errors, warnings, files = [], [], []
    staged = {}          # target dataset file name -> staged path
    sales_parts = []
    for p in sorted(d.glob("_in_*.xlsx")):
        orig = p.name[4:]
        if "machine" in orig.lower():
            try:
                m = pd.read_excel(p, dtype={"Asset ID": str})
            except Exception as exc:
                errors.append(f"{orig}: could not be read ({type(exc).__name__}).")
                continue
            miss = [c for c in MACHINE_COLS if c not in m.columns]
            if miss:
                errors.append(f"{orig}: missing column(s) {', '.join(miss)}.")
                continue
            files.append({"name": orig, "kind": "machine list", "rows": int(len(m)), "date_min": None, "date_max": None})
            staged["CashlessMachines.xlsx"] = p
            continue
        try:
            s = pd.read_excel(p, sheet_name="Item", dtype={"Asset ID": str, "Coil": str})
        except ValueError:
            errors.append(f"{orig}: no sheet named 'Item'.")
            continue
        except Exception as exc:
            errors.append(f"{orig}: could not be read ({type(exc).__name__}).")
            continue
        miss = [c for c in SALES_COLS if c not in s.columns]
        if miss:
            errors.append(f"{orig}: missing column(s) {', '.join(miss)}.")
            continue
        s["Sale Date Time"] = pd.to_datetime(s["Sale Date Time"], errors="coerce")
        bad_dates = int(s["Sale Date Time"].isna().sum())
        if bad_dates:
            warnings.append(f"{orig}: {bad_dates:,} rows have no valid sale date and will be ignored.")
        s = s.dropna(subset=["Sale Date Time"])
        if s.empty:
            errors.append(f"{orig}: no rows with a valid sale date.")
            continue
        years = sorted(s["Sale Date Time"].dt.year.unique())
        year = _year_from_name(orig) or (years[0] if len(years) == 1 else None)
        if year is None:
            errors.append(f"{orig}: put the year in the file name (e.g. CashlessSalesAnalysis-2027.xlsx) or upload one year per file.")
            continue
        lo, hi = pd.Timestamp(year=year, month=1, day=1) - pd.Timedelta(days=7), pd.Timestamp(year=year, month=12, day=31) + pd.Timedelta(days=7)
        if s["Sale Date Time"].min() < lo or s["Sale Date Time"].max() > hi:
            warnings.append(f"{orig}: contains dates from {s['Sale Date Time'].min().date()} to {s['Sale Date Time'].max().date()}; "
                            f"check that this is the {year} export (it will be saved as the {year} file).")
        target = f"CashlessSalesAnalysis-{year}.xlsx"
        if target in staged:
            errors.append(f"Two files for {year}: upload one file per year.")
            continue
        file_min = s["Sale Date Time"].min()
        ms_ = store.current
        if (settings.dataset_dir / target).exists() and ms_ is not None:
            data_start = pd.Timestamp(ms_.levels["app2a"].weeks[0])
            year_start = max(pd.Timestamp(year=year, month=1, day=1), data_start)
            if file_min > year_start + pd.Timedelta(days=7):
                errors.append(f"{orig}: starts on {file_min.date()} but would REPLACE the existing {year} file, so "
                              f"sales from {year_start.date()} to {file_min.date()} would be lost. "
                              f"Upload the full-year export for {year}.")
                continue
        staged[target] = p
        files.append({"name": orig, "kind": f"sales {year}", "rows": int(len(s)),
                      "date_min": str(s["Sale Date Time"].min().date()), "date_max": str(s["Sale Date Time"].max().date()),
                      "replaces_existing": (settings.dataset_dir / target).exists(), "dataset_file": target})
        sales_parts.append(s.drop(columns=[c for c in ("Place",) if c in s.columns]))   # placement notes never leave this step

    report = {"upload_id": upload_id, "files": files, "gap_weeks": 0, "overlap_weeks": 0,
              "dropped": {"duplicates": 0, "partial_weeks": 0, "warehouse_test_vends": 0},
              "unnamed_share": None, "machines": {"new": [], "removed": [], "relocated": []},
              "errors": errors, "warnings": warnings, "can_train": False,
              "created_at": datetime.now().isoformat(timespec="seconds")}
    if sales_parts:
        s = pd.concat(sales_parts, ignore_index=True)
        report["dropped"]["duplicates"] = int(s.duplicated().sum())
        s = s.drop_duplicates()
        loc = s["Location"].astype(str).str.lower()
        wh = loc.str.contains("unassigned")
        report["dropped"]["warehouse_test_vends"] = int(wh.sum())
        s = s[~wh]
        item = s["Item"].astype(str).str.strip()
        report["unnamed_share"] = round(float((s["Item"].isna() | item.isin(["", "nan", "Unknown Item"])).mean()), 4)
        day = s["Sale Date Time"].dt.normalize()
        last_day = day.max()
        last_week = last_day - pd.Timedelta(days=last_day.dayofweek)
        if (last_day - last_week).days < 6:
            report["dropped"]["partial_weeks"] = int((day >= last_week).sum())
        if report["unnamed_share"] > 0.5:
            warnings.append(f"{report['unnamed_share']:.0%} of sales have no product name: only App 2a can use them.")
        # compare with the data the active model was trained on
        ms = store.current
        if ms is not None:
            data_end = pd.Timestamp(ms.levels["app2a"].forecast_start) - pd.Timedelta(days=1)
            new_min, new_max = day.min(), day.max()
            if new_min > data_end + pd.Timedelta(days=1):
                report["gap_weeks"] = int((new_min - data_end).days // 7)
                if report["gap_weeks"] > 0:
                    warnings.append(f"There is a gap of about {report['gap_weeks']} week(s) between the current data "
                                    f"(ends {data_end.date()}) and this upload. Forecast quality may drop.")
            elif new_min <= data_end:
                report["overlap_weeks"] = int((min(new_max, data_end) - new_min).days // 7 + 1)
            if new_max <= data_end:
                warnings.append(f"This upload adds no sales after {data_end.date()} (the current data end).")
            a2 = ms.levels["app2a"]
            known = set(a2.keys["Asset ID"].astype(str))
            recent = s[s["Sale Date Time"] > s["Sale Date Time"].max() - pd.Timedelta(weeks=4)]
            seen = set(recent["Asset ID"].astype(str).str.strip())
            report["machines"]["new"] = sorted(seen - known)
            if new_max > data_end:
                report["machines"]["removed"] = sorted(known - seen)
            last_loc = (s.sort_values("Sale Date Time").groupby(s["Asset ID"].astype(str).str.strip())["Location"].last()
                        .astype(str).str.strip().str.lower())
            cur = dict(zip(a2.keys["Asset ID"].astype(str), [str(x).strip().lower() for x in a2.location]))
            report["machines"]["relocated"] = sorted(a for a, l in last_loc.items() if a in cur and cur[a] and l != cur[a])
    if not files and not errors:
        errors.append("No usable files.")
    have_machines = "CashlessMachines.xlsx" in staged or (settings.dataset_dir / "CashlessMachines.xlsx").exists()
    have_sales = any(k.startswith("CashlessSales") for k in staged) or any(settings.dataset_dir.glob("CashlessSalesAnalysis-*.xlsx"))
    if not have_machines:
        errors.append("CashlessMachines.xlsx is needed (not in this upload and not in the dataset folder).")
    if not have_sales:
        errors.append("No sales files in this upload or in the dataset folder.")
    report["can_train"] = not errors
    report["staged"] = {k: v.name for k, v in staged.items()}
    write_json(d / "report.json", report)
    public = {k: v for k, v in report.items() if k != "staged"}
    return public


def get_report(upload_id: str) -> dict:
    r = read_json(upload_dir(upload_id) / "report.json")
    if not r:
        raise not_found("Unknown upload.", "unknown_upload")
    return r


def merge_into_dataset(upload_id: str) -> list[str]:
    """After a successful retrain: copy the staged files into data/dataset (old copies backed up)."""
    r = get_report(upload_id)
    d = upload_dir(upload_id)
    backup = settings.data_dir / "dataset_backups" / datetime.now().strftime("%Y%m%d-%H%M%S")
    done = []
    for target, staged_name in (r.get("staged") or {}).items():
        dst = settings.dataset_dir / target
        if dst.exists():
            backup.mkdir(parents=True, exist_ok=True)
            shutil.copy2(dst, backup / target)
        shutil.copy2(d / staged_name, dst)
        done.append(target)
    r["merged_at"] = datetime.now().isoformat(timespec="seconds")
    write_json(d / "report.json", r)
    return done


def cleanup_old(days=30):
    cut = datetime.now() - timedelta(days=days)
    for p in (settings.data_dir / "uploads").glob("*"):
        if p.is_dir() and datetime.fromtimestamp(p.stat().st_mtime) < cut:
            shutil.rmtree(p, ignore_errors=True)

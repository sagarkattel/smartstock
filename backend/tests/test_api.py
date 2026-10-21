"""End-to-end API tests. Run from the backend folder:  pytest -q

Uses the trained models in models/ and a temporary data folder (rules, uploads, jobs).
Retraining itself is not run here (it takes several minutes); see README "Testing".
"""
import os
import tempfile
import time

import pytest

TMP = tempfile.mkdtemp(prefix="smartstock-test-")
os.environ.update({"SMARTSTOCK_DATA_DIR": TMP, "SMARTSTOCK_USERNAME": "tester", "SMARTSTOCK_PASSWORD": "pw-123",
                   "SMARTSTOCK_SECRET_KEY": "test-secret", "SMARTSTOCK_TODAY": "2026-09-01"})

from fastapi.testclient import TestClient  # noqa: E402

from app.config import settings  # noqa: E402
from app.main import app  # noqa: E402

P = settings.api_prefix


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        for _ in range(240):
            if c.get("/health").json()["status"] != "loading":
                break
            time.sleep(0.5)
        assert c.get("/health").json()["status"] == "ok", c.get("/health").json()
        yield c


@pytest.fixture(scope="module")
def auth(client):
    r = client.post(f"{P}/auth/login", json={"username": "tester", "password": "pw-123"})
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_health_matches_notebook(client):
    m = client.get("/health").json()["models"]
    assert all(m["forecast_matches_notebook"].values())


def test_login_and_protection(client):
    assert client.post(f"{P}/auth/login", json={"username": "tester", "password": "wrong"}).status_code == 401
    r = client.get(f"{P}/meta")
    assert r.status_code == 401 and r.json()["code"] == "not_authenticated"
    assert client.get(f"{P}/meta", headers={"Authorization": "Bearer nope.nope"}).status_code == 401


def test_meta(client, auth):
    m = client.get(f"{P}/meta", headers=auth).json()
    assert m["data_end"] == "2026-08-30" and m["current_week_start"] == "2026-08-31"
    assert m["data_age_weeks"] == 0 and m["max_horizon_weeks"] == 12 and m["max_horizon_months"] == 6


def test_app1(client, auth):
    r = client.get(f"{P}/app1/products", params={"horizon": 4}, headers=auth).json()
    assert len(r["items"]) == 156 and len(r["periods"]) == 4
    item = r["items"][0]["item"]
    f = client.get(f"{P}/app1/forecast", params={"item": item, "granularity": "month", "horizon": 6}, headers=auth).json()
    assert len(f["periods"]) == 6 and f["periods"][0]["p10"] is None and len(f["history"]) > 0
    s0 = client.get(f"{P}/app1/summary", params={"cut_step": 0}, headers=auth).json()
    s3 = client.get(f"{P}/app1/summary", params={"cut_step": 3}, headers=auth).json()
    assert s0["saved_vs_step0"]["units"] == 0 and s3["saved_vs_step0"]["units"] > 0
    assert s3["periods"][0]["by_priority"]["High"]["safe"] == s0["periods"][0]["by_priority"]["High"]["safe"]


def test_service_level_changes_safe_stock(client, auth):
    lo = client.get(f"{P}/app2a/machines", params={"service_level": 0.5}, headers=auth).json()
    hi = client.get(f"{P}/app2a/machines", params={"service_level": 0.95}, headers=auth).json()
    assert sum(m["first"]["safe_qty"] for m in hi["machines"]) > sum(m["first"]["safe_qty"] for m in lo["machines"])


def test_app2a_and_2b(client, auth):
    ms = client.get(f"{P}/app2a/machines", headers=auth).json()["machines"]
    assert len(ms) == 108
    aid = next(m["asset_id"] for m in ms if m["has_product_breakdown"])
    f = client.get(f"{P}/app2a/forecast", params={"asset_id": aid}, headers=auth).json()
    assert f["location"] and f["confidence"] in ("High", "Medium", "Low")
    b = client.get(f"{P}/app2b/machine", params={"asset_id": aid}, headers=auth).json()
    assert b["products"] and b["machine_total"] and b["app2a_total"]
    item = b["products"][0]["item"]
    p = client.get(f"{P}/app2b/product", params={"item": item}, headers=auth).json()
    assert any(m["asset_id"] == aid for m in p["machines"])


def test_app2a_summary(client, auth):
    r = client.get(f"{P}/app2a/summary", params={"horizon": 3}, headers=auth).json()
    ms = client.get(f"{P}/app2a/machines", params={"horizon": 3}, headers=auth).json()["machines"]
    assert r["machines"] == len(ms) == 108 and len(r["periods"]) == 3
    assert abs(r["periods"][0]["expected"] - sum(m["first"]["p50"] for m in ms)) < 1.0
    assert r["periods"][0]["safe"] >= r["periods"][0]["minimum"]
    assert client.get(f"{P}/app2a/summary", params={"granularity": "month", "horizon": 99}, headers=auth).status_code == 422


def test_fleet_history(client, auth):
    r = client.get(f"{P}/history/fleet", params={"app": "app1", "weeks": 8}, headers=auth).json()
    assert len(r["weeks"]) == 8 and r["weeks"][-1]["units"] > 0 and r["weeks"][-1]["revenue"] > 0
    assert client.get(f"{P}/history/fleet", params={"app": "app2b"}, headers=auth).status_code == 422


def test_history_months_and_machine(client, auth):
    w = client.get(f"{P}/history/fleet", params={"app": "app1", "weeks": 120}, headers=auth).json()["weeks"]
    assert len(w) == 120
    m = client.get(f"{P}/history/fleet", params={"app": "app1", "granularity": "month", "months": 36}, headers=auth).json()["months"]
    assert 20 <= len(m) <= 36 and all(x["period_start"].endswith("-01") for x in m)
    assert all(x["units"] > 0 for x in m[-12:])   # the earliest months can be empty: product names were not recorded yet
    assert [x["period_start"] for x in m] == sorted(x["period_start"] for x in m)
    # a complete month's total matches the weeks that make it up (roughly: weeks are split by day at month edges)
    by_week = sum(x["units"] for x in w if x["week_start"].startswith(m[-1]["period_start"][:7]))
    assert by_week > 0 and abs(by_week - m[-1]["units"]) / m[-1]["units"] < 0.35
    ms = client.get(f"{P}/app2a/machines", params={"horizon": 1}, headers=auth).json()["machines"]
    one = client.get(f"{P}/history/fleet", params={"app": "app2a", "asset_id": ms[0]["asset_id"], "weeks": 10}, headers=auth).json()
    assert len(one["weeks"]) == 10 and one["asset_id"] == ms[0]["asset_id"]
    assert client.get(f"{P}/history/fleet", params={"app": "app1", "asset_id": "100900"}, headers=auth).status_code == 422
    assert client.get(f"{P}/history/fleet", params={"app": "app2a", "asset_id": "nope"}, headers=auth).status_code == 404


def test_missed_forecast(client, auth, monkeypatch):
    # With "today" = the first forecast week there is nothing missing.
    assert client.get(f"{P}/forecast/missed", params={"app": "app1"}, headers=auth).json()["weeks"] == []
    # Pretend it is 5 weeks later: five past weeks have an expected value but no real sales yet.
    monkeypatch.setattr(settings, "today_override", "2026-10-07")
    r = client.get(f"{P}/forecast/missed", params={"app": "app1"}, headers=auth).json()
    assert len(r["weeks"]) == 5 and r["weeks"][0]["period_start"] == "2026-08-31"
    assert r["weeks"][0]["expected"] > 0 and r["weeks"][0]["revenue_expected"] > 0
    ms = client.get(f"{P}/app2a/machines", params={"horizon": 1}, headers=auth).json()["machines"]
    one = client.get(f"{P}/forecast/missed", params={"app": "app2a", "asset_id": ms[0]["asset_id"]}, headers=auth).json()
    assert len(one["weeks"]) == 5
    assert client.get(f"{P}/forecast/missed", params={"app": "app1", "asset_id": "100900"}, headers=auth).status_code == 422
    assert client.get(f"{P}/forecast/missed", params={"app": "app2a", "asset_id": "nope"}, headers=auth).status_code == 404


def test_profile_and_password(client, auth):
    me = client.get(f"{P}/auth/me", headers=auth).json()
    assert me["username"] == "tester" and me["avatar"] is None
    r = client.put(f"{P}/auth/profile", json={"display_name": "  Sam  ", "avatar": "avatar-3"}, headers=auth)
    assert r.status_code == 200 and r.json() == {"name": "Sam", "avatar": "avatar-3"}
    assert client.get(f"{P}/auth/me", headers=auth).json()["name"] == "Sam"
    assert client.put(f"{P}/auth/profile", json={"display_name": "Sam", "avatar": "evil"}, headers=auth).status_code == 422
    assert client.put(f"{P}/auth/profile", json={"display_name": "   ", "avatar": None}, headers=auth).status_code == 422
    bad = client.post(f"{P}/auth/password", json={"current_password": "nope", "new_password": "long-enough-1"}, headers=auth)
    assert bad.status_code == 422 and bad.json()["code"] == "wrong_password"
    short = client.post(f"{P}/auth/password", json={"current_password": "pw-123", "new_password": "short"}, headers=auth)
    assert short.status_code == 422 and short.json()["code"] == "weak_password"
    ok = client.post(f"{P}/auth/password", json={"current_password": "pw-123", "new_password": "new-password-9"}, headers=auth)
    assert ok.status_code == 200
    assert client.post(f"{P}/auth/login", json={"username": "tester", "password": "pw-123"}).status_code == 401
    login = client.post(f"{P}/auth/login", json={"username": "tester", "password": "new-password-9"})
    assert login.status_code == 200 and login.json()["name"] == "Sam"
    # put the password back so the other tests in this module can still sign in
    client.post(f"{P}/auth/password", json={"current_password": "new-password-9", "new_password": "pw-123456"}, headers=auth)


def test_errors(client, auth):
    r = client.get(f"{P}/app1/products", params={"granularity": "month", "horizon": 9}, headers=auth)
    assert r.status_code == 422 and set(r.json()) == {"detail", "code"}
    assert client.get(f"{P}/app1/forecast", params={"item": "NOT A PRODUCT"}, headers=auth).status_code == 404
    assert client.get(f"{P}/app1/products", params={"service_level": 0.85}, headers=auth).status_code == 422


def test_app3(client, auth):
    cats = client.get(f"{P}/app3/categories", headers=auth).json()["categories"]
    assert any(c["name"] == "Sports & fitness" and c["training_sites"] > 0 for c in cats)
    c = client.post(f"{P}/app3/categorize", json={"text": "gym staff canteen"}, headers=auth).json()
    assert "Sports & fitness" in c["categories"] and "Staff area" in c["categories"]
    r = client.post(f"{P}/app3/recommend", json={"categories": ["Sports & fitness"], "top": 10}, headers=auth).json()
    assert len(r["best_sellers"]) == 10 and r["distinctive"] and r["meta"]["method"]
    assert client.post(f"{P}/app3/recommend", json={"categories": ["Moon base"]}, headers=auth).status_code == 422
    r20 = client.post(f"{P}/app3/recommend", json={"categories": ["Sports & fitness"], "top": 20}, headers=auth).json()
    assert len(r20["best_sellers"]) == 20 and len(r20["distinctive"]) > 10
    r3 = client.post(f"{P}/app3/recommend", json={"categories": ["Sports & fitness"], "top": 3}, headers=auth).json()
    assert len(r3["best_sellers"]) == 3 and len(r3["distinctive"]) == 3


def test_rules_and_refit(client, auth):
    rows = client.get(f"{P}/admin/site-categories/keywords", headers=auth).json()["rows"]
    rows.append({"category": "Retail", "keyword": "westfield", "applies_to": "location name", "active": True, "note": "test"})
    assert client.put(f"{P}/admin/site-categories/keywords", json={"rows": rows}, headers=auth).status_code == 200
    t = client.post(f"{P}/admin/site-categories/test", json={"text": "Westfield Parramatta"}, headers=auth).json()
    assert t["categories"] == ["Retail"]
    assert client.post(f"{P}/admin/app3/refit", headers=auth).json()["status"] == "ok"
    bad = client.put(f"{P}/admin/site-categories/overrides", json={"rows": [{"location": "X", "categories": ["Nope"]}]}, headers=auth)
    assert bad.status_code == 422


def test_upload_ticket_single_use(client, auth):
    t = client.post(f"{P}/admin/upload-ticket", headers=auth).json()
    path = t["upload_url"].replace(settings.public_base_url, "")
    r = client.post(path, files={"files": ("notes.txt", b"hello", "text/plain")})
    assert r.status_code == 422 and r.json()["code"] == "wrong_file_type"
    assert client.post(path, files={"files": ("x.xlsx", b"PK", "application/octet-stream")}).status_code == 403


def test_models_pages(client, auth):
    m = client.get(f"{P}/models/metrics", headers=auth).json()
    assert m["apps"]["app1"]["wape"] > 0 and m["approach_comparison"]
    assert len(client.get(f"{P}/models/cards", headers=auth).json()["cards"]) == 4
    v = client.get(f"{P}/admin/models", headers=auth).json()
    assert v["active_version"] and any(x["status"] == "active" for x in v["versions"])
    acc = client.get(f"{P}/admin/monitoring/accuracy", params={"app": "app2a"}, headers=auth).json()
    assert "weeks" in acc and acc["backtest_wape"] > 0

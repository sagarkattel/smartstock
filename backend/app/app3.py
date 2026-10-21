"""App 3: new-site product recommendations and the editable site-category rules.

The recommendation logic is a port of notebook Section 11 (popularity, category profile and ML
methods; the method selected by leave-one-site-out evaluation is stored in the bundle).
Site categories are re-derived from the CURRENT rule files in data/config, so edits to the
keyword or override CSVs take effect after "refit" without retraining the forecasting models.
"""
import os
import threading
from datetime import datetime
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor

import smartstock_core as core

from .config import settings
from .errors import bad_input

KW_FILE, OV_FILE = "site_category_keywords.csv", "site_category_overrides.csv"
KW_COLS = ["Category", "Keyword", "Applies_to", "Active", "Note"]
OV_COLS = ["Location", "Categories", "Staff_area", "Note"]
MIN_SITES_RECO = 3
ML_KW = dict(max_iter=200, learning_rate=0.05, max_leaf_nodes=15, min_samples_leaf=20, random_state=42)
_lock = threading.RLock()


# ---------------- rule files
def kw_path() -> Path:
    return settings.config_dir / KW_FILE


def ov_path() -> Path:
    return settings.config_dir / OV_FILE


def ensure_rule_files(bundle):
    """First start: copy the rules the active model was trained with into data/config."""
    if not kw_path().exists():
        kw = bundle.get("site_keywords")
        (kw if kw is not None else core.default_keyword_table()).to_csv(kw_path(), index=False)
    if not ov_path().exists():
        ov = bundle.get("site_overrides")
        (ov if ov is not None and len(ov.columns) else pd.DataFrame(columns=OV_COLS)).to_csv(ov_path(), index=False)


def read_keywords() -> pd.DataFrame:
    t = pd.read_csv(kw_path(), dtype=str).fillna("")
    for c in KW_COLS:
        if c not in t:
            t[c] = ""
    return t[KW_COLS]


def read_overrides() -> pd.DataFrame:
    t = pd.read_csv(ov_path(), dtype=str).fillna("")
    for c in OV_COLS:
        if c not in t:
            t[c] = ""
    return t[OV_COLS]


def _yes(v):
    return str(v).strip().lower() in ("yes", "y", "true", "1")


def keywords_to_rows(t):
    return [{"category": r.Category, "keyword": r.Keyword,
             "applies_to": "placement notes" if "note" in r.Applies_to.lower() else "location name",
             "active": _yes(r.Active), "note": r.Note} for r in t.itertuples()]


def overrides_to_rows(t):
    out = []
    for r in t.itertuples():
        st = r.Staff_area.strip().lower()
        out.append({"location": r.Location, "categories": [c.strip() for c in r.Categories.split("|") if c.strip()],
                    "staff_area": True if st in ("yes", "y", "true", "1") else (False if st in ("no", "n", "false", "0") else None),
                    "note": r.Note})
    return out


def file_info(p: Path):
    try:
        return datetime.fromtimestamp(os.path.getmtime(p)).isoformat(timespec="seconds")
    except OSError:
        return None


def save_keywords(rows: list[dict]):
    errs, out = [], []
    for i, r in enumerate(rows, 1):
        cat, kw = str(r.get("category", "")).strip(), str(r.get("keyword", "")).strip()
        ap = str(r.get("applies_to", "location name")).strip().lower()
        if not cat:
            errs.append(f"Row {i}: category is empty.")
        if not kw or kw == "*":
            errs.append(f"Row {i}: keyword is empty.")
        if ap not in ("location name", "placement notes"):
            errs.append(f"Row {i}: applies_to must be 'location name' or 'placement notes'.")
        if ap == "placement notes" and cat != core.STAFF_CAT:
            errs.append(f"Row {i}: placement-notes keywords can only set the '{core.STAFF_CAT}' category.")
        if cat == core.OTHER_CAT:
            errs.append(f"Row {i}: '{core.OTHER_CAT}' is assigned automatically and cannot have keywords.")
        out.append({"Category": cat, "Keyword": kw, "Applies_to": ap,
                    "Active": "yes" if r.get("active", True) else "no", "Note": str(r.get("note", "") or "")})
    if errs:
        raise bad_input(" ".join(errs[:10]), "invalid_rules")
    t = pd.DataFrame(out, columns=KW_COLS)
    if t.duplicated(["Category", "Keyword", "Applies_to"]).any():
        raise bad_input("Duplicate keyword rows (same category, keyword and applies_to).", "invalid_rules")
    with _lock:
        t.to_csv(kw_path(), index=False)
    return t


def save_overrides(rows: list[dict]):
    cats = set(core.compile_site_rules(read_keywords())["categories"])
    errs, out = [], []
    for i, r in enumerate(rows, 1):
        loc = str(r.get("location", "")).strip()
        cs = [str(c).strip() for c in (r.get("categories") or []) if str(c).strip()]
        if not loc:
            errs.append(f"Row {i}: location is empty.")
        bad = [c for c in cs if c not in cats]
        if bad:
            errs.append(f"Row {i}: unknown categor{'y' if len(bad) == 1 else 'ies'} {', '.join(bad)}.")
        st = r.get("staff_area")
        out.append({"Location": loc, "Categories": "|".join(cs),
                    "Staff_area": "" if st is None else ("yes" if st else "no"), "Note": str(r.get("note", "") or "")})
    if errs:
        raise bad_input(" ".join(errs[:10]), "invalid_rules")
    t = pd.DataFrame(out, columns=OV_COLS)
    if t["Location"].str.lower().duplicated().any():
        raise bad_input("Each location can only have one override row.", "invalid_rules")
    with _lock:
        t.to_csv(ov_path(), index=False)
    return t


# ---------------- recommender
class Recommender:
    def __init__(self, bundle: dict, version: str):
        self.b = bundle
        self.version = version
        ensure_rule_files(bundle)
        self.sites = bundle["sites"]
        self.rates = bundle["rates"]
        self.app3_sites = list(bundle["app3_sites"])
        self.prod = bundle["products"].reset_index(drop=True)
        self.item_code = bundle["item_code"]
        self.k = bundle.get("shrink_k", 3)
        self.method = bundle["method"]
        self.reg, self.clf = bundle.get("regressor"), bundle.get("classifier")
        overlay = self._overlay_path()
        if overlay.exists():
            ov = joblib.load(overlay)
            self._apply_rules(ov["rules"], ov["overrides"], refit_ml=False)
            self.reg, self.clf = ov.get("regressor", self.reg), ov.get("classifier", self.clf)
            self.refit_at = ov.get("refit_at")
        else:
            self._apply_rules(bundle["site_keywords"], bundle["site_overrides"], refit_ml=False)
            self.site_cat = bundle["site_cat"]
            self.refit_at = None
        self._pop = self.popularity(self.rates)

    def _overlay_path(self):
        return settings.data_dir / "state" / f"app3_overlay_{self.version}.joblib"

    # rules -> site categories
    def _apply_rules(self, kw_table, ov_table, refit_ml=True):
        self.rules = core.compile_site_rules(kw_table)
        self.overrides = core.load_overrides(ov_table if ov_table is not None else pd.DataFrame(columns=OV_COLS))
        self.categories = self.rules["categories"]
        info = [core.site_categories(n, sh, self.rules, self.overrides)
                for n, sh in zip(self.sites.index, self.sites["staff_share"])]
        self.site_info = pd.DataFrame({"categories": [i[0] for i in info], "matched": [i[1] for i in info],
                                       "source": [i[2] for i in info]}, index=self.sites.index)
        self.site_cat = pd.DataFrame([{c: (c in cs) for c in self.categories} for cs in self.site_info["categories"]],
                                     index=self.sites.index)
        if refit_ml and self.method.startswith("ML"):
            self.reg, self.clf = self.ml_fit(self.rates)

    def refit(self):
        with _lock:
            kw, ov = read_keywords(), read_overrides()
            self._apply_rules(kw, ov, refit_ml=True)
            self._pop = self.popularity(self.rates)
            self.refit_at = datetime.now().isoformat(timespec="seconds")
            joblib.dump({"rules": kw, "overrides": ov, "regressor": self.reg, "classifier": self.clf,
                         "refit_at": self.refit_at}, self._overlay_path(), compress=3)
        unclassified = int((self.site_info["source"] == "none").sum())
        return {"status": "ok", "training_sites": len(self.app3_sites), "unclassified": unclassified,
                "categories": len(self.categories), "refit_at": self.refit_at,
                "note": "Staff-area (placement-notes) keyword changes take effect at the next retraining, "
                        "because placement notes are not kept after training."}

    # notebook functions (Section 11)
    def popularity(self, tr):
        k = self.k
        g = tr.groupby("Item").agg(n=("site", "nunique"), regular=("regular", "mean"))
        g["rate"] = tr.groupby("Item").apply(lambda d: np.average(d["rate"], weights=d["offered_weeks"]))
        glob_r, glob_g = tr["rate"].median(), tr["regular"].mean()
        g["rate"] = (g["n"] * g["rate"] + k * glob_r) / (g["n"] + k)
        g["regular"] = (g["n"] * g["regular"] + k * glob_g) / (g["n"] + k)
        return g

    def profile_predict(self, tr, cats, items):
        k = self.k
        pop = self._pop.reindex(items) if tr is self.rates else self.popularity(tr).reindex(items)
        rows = tr.merge(self.site_cat, left_on="site", right_index=True)
        num_r = pd.Series(0.0, index=items)
        num_g = pd.Series(0.0, index=items)
        n = pd.Series(0.0, index=items)
        for c in cats:
            if c not in rows:
                continue
            sub = rows[rows[c]]
            if sub.empty:
                continue
            g = sub.groupby("Item").agg(rate=("rate", "mean"), regular=("regular", "mean"), n=("site", "nunique")).reindex(items)
            num_r += (g["rate"] * g["n"]).fillna(0)
            num_g += (g["regular"] * g["n"]).fillna(0)
            n += g["n"].fillna(0)
        pr, pg = pop["rate"].fillna(tr["rate"].median()), pop["regular"].fillna(tr["regular"].mean())
        return pd.DataFrame({"rate": (num_r + k * pr) / (n + k), "regular": (num_g + k * pg) / (n + k),
                             "n_sites": n.astype(int), "pop_rate": pr}, index=items)

    def ml_frame(self, rows, pop, loo=False):
        X = rows[["site", "Item"]].merge(self.site_cat, left_on="site", right_index=True, how="left").fillna(False)
        X = X[self.categories].astype(int)
        X["item"] = rows["Item"].map(self.item_code).to_numpy()
        pinfo = self.prod.set_index("Item").loc[rows["Item"]]
        X["is_drink"] = (pinfo["ptype"].to_numpy() == "Drink").astype(int)
        X["price"] = pinfo["price"].to_numpy()
        p = pop.reindex(rows["Item"])
        if loo:
            tot = rows.groupby("Item")["rate"].transform("sum")
            cnt = rows.groupby("Item")["rate"].transform("count")
            X["pop_rate"] = np.where(cnt > 1, (tot - rows["rate"]) / (cnt - 1).clip(lower=1), np.nan)
            totg = rows.groupby("Item")["regular"].transform("sum")
            X["pop_regular"] = np.where(cnt > 1, (totg - rows["regular"]) / (cnt - 1).clip(lower=1), np.nan)
        else:
            X["pop_rate"] = p["rate"].to_numpy()
            X["pop_regular"] = p["regular"].to_numpy()
        return X

    def ml_fit(self, tr):
        X = self.ml_frame(tr, self.popularity(tr), loo=True)
        mask = [c == "item" for c in X.columns]
        reg = HistGradientBoostingRegressor(loss="poisson", categorical_features=mask, **ML_KW).fit(
            X, tr["rate"], sample_weight=tr["offered_weeks"])
        clf = HistGradientBoostingClassifier(categorical_features=mask, **ML_KW).fit(
            X, tr["regular"], sample_weight=tr["offered_weeks"])
        return reg, clf

    # public API
    def category_list(self):
        counts = self.site_cat.loc[self.app3_sites].sum()
        return [{"name": c, "training_sites": int(counts.get(c, 0))} for c in self.categories]

    def categorize(self, text: str):
        text = (text or "").strip()
        if not text:
            raise bad_input("text is empty.")
        staff = 1.0 if core.staff_area_match(text, self.rules) else 0.0
        cats, matched, source = core.site_categories(text, staff, self.rules, self.overrides)
        if staff:
            matched = matched + [f"{core.STAFF_CAT}: {kw}" for c, kw, rx in self.rules["notes"] if rx.search(text.lower())]
        return {"categories": cats, "matched_keywords": matched, "source": source}

    def recommend(self, categories, staff_area=False, text=None, top=10):
        cats = [c for c in (categories or []) if c in self.categories]
        unknown = [c for c in (categories or []) if c not in self.categories]
        if unknown:
            raise bad_input(f"Unknown categor{'y' if len(unknown) == 1 else 'ies'}: {', '.join(unknown)}.", "unknown_category")
        if not cats and text:
            cats = [c for c in self.categorize(text)["categories"]]
        if staff_area and core.STAFF_CAT not in cats:
            cats.append(core.STAFF_CAT)
        cats = cats or [core.OTHER_CAT]
        if top is not None and not (1 <= int(top) <= 500):
            raise bad_input("top must be between 1 and 500 (or empty for all).")
        items = self.prod["Item"].to_numpy()
        prof = self.profile_predict(self.rates, cats, items)
        if self.method.startswith("ML"):
            rows = pd.DataFrame({"site": "__new__", "Item": items})
            X = self.ml_frame(rows, self._pop)
            X[self.categories] = 0
            for c in cats:
                X[c] = 1
            rate, like = self.reg.predict(X), self.clf.predict_proba(X)[:, 1]
        elif self.method == "Category profile":
            rate, like = prof["rate"].to_numpy(), prof["regular"].to_numpy()
        else:
            rate, like = prof["pop_rate"].to_numpy(), self._pop["regular"].reindex(items).fillna(0).to_numpy()
        similar = int(self.site_cat.loc[self.app3_sites, [c for c in cats if c in self.site_cat]].any(axis=1).sum())
        out = self.prod.copy()
        out["sites_fleet"] = self._pop["n"].reindex(items).fillna(0).astype(int).to_numpy()
        out["like"] = like
        out["rate"] = rate
        out["lift"] = rate / np.maximum(prof["pop_rate"].to_numpy(), 1e-6)
        out["n_sim"] = prof["n_sites"].to_numpy()
        out["conf"] = np.select([out["n_sim"] >= 5, out["n_sim"] >= 2], ["High", "Medium"], "Low")
        out = out[out["sites_fleet"] >= MIN_SITES_RECO].sort_values("rate", ascending=False).reset_index(drop=True)
        drink_share = float(out.loc[out["ptype"] == "Drink", "rate"].sum() / max(out["rate"].sum(), 1e-9))
        fleet = self._pop.reindex(out["Item"]).assign(ptype=out["ptype"].to_numpy())
        fleet_share = float(fleet.loc[fleet["ptype"] == "Drink", "rate"].sum() / max(fleet["rate"].sum(), 1e-9))
        diff = drink_share - fleet_share
        hint = (f"More drink-heavy than the fleet ({drink_share:.0%} drinks vs {fleet_share:.0%}): favour a drink machine or a drink-heavy combo"
                if diff > 0.05 else
                f"More snack-heavy than the fleet ({drink_share:.0%} drinks vs {fleet_share:.0%}): favour a snack machine or a snack-heavy combo"
                if diff < -0.05 else f"Similar mix to the fleet ({drink_share:.0%} drinks): a combo machine suits")
        distinctive = out[(out["conf"] != "Low") & (out["rate"] >= 0.5)].sort_values("lift", ascending=False)
        distinctive = distinctive.head(top) if top else distinctive

        def rows_of(d):
            return [{"rank": i + 1, "item": r.Item, "ptype": r.ptype, "price": round(float(r.price), 2),
                     "likelihood_regular_seller": round(float(r.like), 3),
                     "expected_units_per_machine_week": round(float(r.rate), 2),
                     "expected_revenue_per_machine_week": round(float(r.rate * r.price), 2),
                     "lift_vs_fleet": round(float(r.lift), 2), "similar_sites_with_product": int(r.n_sim),
                     "confidence": r.conf} for i, r in enumerate(d.itertuples())]
        overall = "High" if similar >= 5 else ("Medium" if similar >= 2 else "Low")
        return {"meta": {"categories": cats, "similar_training_sites": similar, "overall_confidence": overall,
                         "machine_hint": hint, "drink_share": round(drink_share, 3),
                         "fleet_drink_share": round(fleet_share, 3), "method": self.method,
                         "warning": None if overall != "Low" else
                         "Few or no similar sites: these are general fleet suggestions."},
                "best_sellers": rows_of(out.head(top) if top else out), "distinctive": rows_of(distinctive)}

    def review_rows(self):
        s = self.sites.drop(columns=[c for c in ("categories", "matched_keywords", "source") if c in self.sites]).join(self.site_info)
        s = s.assign(_o=s["source"].map({"none": 0, "keyword": 1, "override": 2})).sort_values(["_o", "named"], ascending=[True, False])
        staff = self.site_cat[core.STAFF_CAT] if core.STAFF_CAT in self.site_cat else pd.Series(False, index=self.site_cat.index)
        return [{"location": r.Location, "categories": list(r.categories), "matched_keywords": list(r.matched),
                 "source": r.source, "staff_area": bool(staff.get(idx, False)), "machines": int(r.machines),
                 "named_sales": int(r.named), "used_in_training": idx in set(self.app3_sites)}
                for idx, r in zip(s.index, s.itertuples())]

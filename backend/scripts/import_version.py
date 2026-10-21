"""Add a model version trained elsewhere (e.g. in Colab) to the backend.

    python scripts/import_version.py "/path/to/smartstock_v2" [--name 20261020-colab] [--activate]

The folder is the notebook's output folder (it contains models/, evaluation/, docs/, forecasts/).
Without --activate it is added as a candidate; make it active from Administration > Model versions,
or run again with --activate (restart the server afterwards if it is running).
"""
import argparse
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.config import settings  # noqa: E402
from app.store import import_version, write_json  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("folder")
ap.add_argument("--name", default=datetime.now().strftime("%Y%m%d-%H%M") + "-imported")
ap.add_argument("--activate", action="store_true")
a = ap.parse_args()
src = Path(a.folder).expanduser().resolve()
for need in ("models/app1_bundle.joblib", "models/app2a_bundle.joblib", "models/app2b_bundle.joblib",
             "models/app3_bundle.joblib", "models/calibration.json", "evaluation/metrics.json"):
    if not (src / need).exists():
        sys.exit(f"Missing {need} in {src}")
dst = import_version(src, a.name, "imported", status="active" if a.activate else "candidate")
if a.activate:
    write_json(settings.models_dir / "active.json", {"active": a.name})
print(f"Imported {src} -> {dst}" + (" (active)" if a.activate else " (candidate)"))

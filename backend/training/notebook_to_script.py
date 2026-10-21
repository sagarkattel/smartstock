"""Turn the training notebook into the script the backend runs for retraining jobs.

Run this after editing SmartStock_v2_Training.ipynb:
    python training/notebook_to_script.py
It writes training/smartstock_training.py. '%%writefile' cells become file writes and plots are
saved without opening windows.
"""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
nb = json.loads((HERE / "SmartStock_v2_Training.ipynb").read_text())
src = ["import matplotlib; matplotlib.use('Agg')"]
for c in nb["cells"]:
    if c["cell_type"] != "code":
        continue
    s = "".join(c["source"]) if isinstance(c["source"], list) else c["source"]
    if s.startswith("%%writefile"):
        first, body = s.split("\n", 1)
        src.append(f"open({first.split()[1]!r},'w').write({body!r})")
    else:
        src.append(s)
(HERE / "smartstock_training.py").write_text("\n\n".join(src))
print("wrote", HERE / "smartstock_training.py")

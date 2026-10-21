"""SmartStock backend settings, read from environment variables (or a .env file)."""
import os
import secrets
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

try:  # optional: load .env if python-dotenv is installed
    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env")
except ImportError:
    pass


def _list(name, default):
    return [x.strip() for x in os.environ.get(name, default).split(",") if x.strip()]


@dataclass
class Settings:
    username: str = os.environ.get("SMARTSTOCK_USERNAME", "admin")
    password: str = os.environ.get("SMARTSTOCK_PASSWORD", "")
    display_name: str = os.environ.get("SMARTSTOCK_DISPLAY_NAME", "A to Z Vending")
    secret_key: str = os.environ.get("SMARTSTOCK_SECRET_KEY", "")
    token_hours: float = float(os.environ.get("SMARTSTOCK_TOKEN_HOURS", "12"))
    cors_origins: list = field(default_factory=lambda: _list("SMARTSTOCK_CORS_ORIGINS", "http://localhost:3000"))
    public_base_url: str = os.environ.get("SMARTSTOCK_PUBLIC_BASE_URL", "http://localhost:8000").rstrip("/")
    api_prefix: str = os.environ.get("SMARTSTOCK_API_PREFIX", "/api/v1").rstrip("/")
    data_dir: Path = Path(os.environ.get("SMARTSTOCK_DATA_DIR", ROOT / "data"))
    models_dir: Path = Path(os.environ.get("SMARTSTOCK_MODELS_DIR", ROOT / "models"))
    training_script: Path = Path(os.environ.get("SMARTSTOCK_TRAINING_SCRIPT", ROOT / "training" / "smartstock_training.py"))
    timezone: str = os.environ.get("SMARTSTOCK_TIMEZONE", "Australia/Sydney")
    today_override: str = os.environ.get("SMARTSTOCK_TODAY", "")       # e.g. 2026-09-02 for a demo
    max_upload_mb: int = int(os.environ.get("SMARTSTOCK_MAX_UPLOAD_MB", "50"))
    upload_ticket_minutes: int = int(os.environ.get("SMARTSTOCK_UPLOAD_TICKET_MINUTES", "10"))
    drift_margin: float = float(os.environ.get("SMARTSTOCK_DRIFT_MARGIN", "0.10"))
    python_executable: str = os.environ.get("SMARTSTOCK_PYTHON", "")
    max_forecast_weeks: int = 26   # evidence-backed limit (26-week stability check in the notebook)
    ui_max_weeks: int = 12
    ui_max_months: int = 6

    def __post_init__(self):
        self.warnings = []
        if not self.password:
            self.password = "smartstock"
            self.warnings.append("SMARTSTOCK_PASSWORD is not set: using the demo password 'smartstock'.")
        if not self.secret_key:
            self.secret_key = secrets.token_hex(32)
            self.warnings.append("SMARTSTOCK_SECRET_KEY is not set: sessions end when the server restarts.")
        for sub in ("dataset", "config", "uploads", "jobs", "state", "dataset_backups"):
            (self.data_dir / sub).mkdir(parents=True, exist_ok=True)
        (self.models_dir / "versions").mkdir(parents=True, exist_ok=True)

    @property
    def dataset_dir(self):
        return self.data_dir / "dataset"

    @property
    def config_dir(self):
        return self.data_dir / "config"


settings = Settings()

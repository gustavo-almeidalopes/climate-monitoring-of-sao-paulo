from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

_TMP = Path(tempfile.mkdtemp(prefix="climasp-tests-"))
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_TMP / 'test.db'}"
os.environ["ML_MODEL_PATH"] = str(_TMP / "model.joblib")
os.environ["ML_AUTO_BOOTSTRAP"] = "false"

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

"""
PythonAnywhere WSGI entry point — ClimaSP
=========================================
Cole o conteúdo deste arquivo no seu WSGI file do PythonAnywhere.
O caminho do arquivo na plataforma é:
  /var/www/<seu-usuario>_pythonanywhere_com_wsgi.py

Substitua SEU_USUARIO pelo seu nome de usuário do PythonAnywhere.
"""

import sys
import os

# ── 1. Caminho do projeto ─────────────────────────────────────────────────────
SEU_USUARIO = "SEU_USUARIO"  # ← ALTERE AQUI
PROJECT_HOME = f"/home/{SEU_USUARIO}/climate-monitoring-of-sao-paulo-main"

if PROJECT_HOME not in sys.path:
    sys.path.insert(0, PROJECT_HOME)

# ── 2. Ativar o virtualenv ────────────────────────────────────────────────────
VENV_PATH = f"/home/{SEU_USUARIO}/.virtualenvs/climasp"
activate_this = os.path.join(VENV_PATH, "bin", "activate_this.py")
if os.path.exists(activate_this):
    with open(activate_this) as f:
        exec(f.read(), {"__file__": activate_this})

# ── 3. Variáveis de ambiente (.env) ──────────────────────────────────────────
os.chdir(PROJECT_HOME)  # garante que caminhos relativos funcionem
from dotenv import load_dotenv
load_dotenv(os.path.join(PROJECT_HOME, ".env"))

# ── 4. Aplicação FastAPI → adaptador ASGI→WSGI ────────────────────────────────
from a2wsgi import ASGIMiddleware
from app.main import app

application = ASGIMiddleware(app)

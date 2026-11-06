"""Gera o par de chaves VAPID do Web Push (uma vez por implantação).

    python scripts/generate_vapid_keys.py

Copie as três linhas para o .env do servidor (ou secrets.env do Kubernetes). A chave privada
nunca vai para o git nem para o front-end; o painel recebe só a pública em /api/v1/alerts/channels.
"""
from __future__ import annotations

import base64

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def main() -> None:
    key = ec.generate_private_key(ec.SECP256R1())
    private = key.private_numbers().private_value.to_bytes(32, "big")
    public = key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    print(f"VAPID_PUBLIC_KEY={_b64(public)}")
    print(f"VAPID_PRIVATE_KEY={_b64(private)}")
    print("VAPID_SUBJECT=mailto:contato@seu-orgao.gov.br")


if __name__ == "__main__":
    main()

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from app.core.config import get_settings
from app.models.region import Region
from app.services.exceptions import ProviderUnavailableError
from app.services.http_client import ResilientHTTPClient
from app.services.providers.base import WeatherProvider
from app.services.types import NormalizedCurrentWeather, NormalizedForecastReading

# Mapeamento de regiões para estações INMET mais próximas (norte de São Paulo)
# Estação A701 — São Paulo / Mirante d'Oeste: -23.50, -46.62
# Estação A711 — São Paulo / Congonhas:       -23.61, -46.66
_REGION_TO_STATION: dict[str, str] = {
    "CV": "A701",
    "ST": "A701",
    "JT": "A701",
    "MG": "A701",
}
_DEFAULT_STATION = "A701"


def _safe_float(value: object, default: float = 0.0) -> float:
    try:
        return float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return default


def _safe_int(value: object, default: int = 0) -> int:
    try:
        return int(round(float(value)))  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return default


class INMETProvider(WeatherProvider):
    """Provider de dados meteorológicos do INMET (Instituto Nacional de Meteorologia).

    Usa a API pública em https://apitempo.inmet.gov.br/estacao/{datain}/{datafin}/{codEst}.
    Retorna os dados horários das últimas 24 h e extrai a leitura mais recente com
    valores não-nulos. Não fornece previsão — apenas dados atuais.
    """

    name = "inmet"

    def __init__(self, http_client: ResilientHTTPClient) -> None:
        self.http_client = http_client
        self.settings = get_settings()

    async def get_current(self, region: Region) -> NormalizedCurrentWeather:
        station = _REGION_TO_STATION.get(region.code, _DEFAULT_STATION)
        today = date.today()
        yesterday = today - timedelta(days=1)

        url = f"{self.settings.inmet_url}/{yesterday}/{today}/{station}"

        try:
            records: list[dict] = await self.http_client.get_json(
                source="inmet",
                url=url,
                params={},
            )
        except Exception as exc:
            raise ProviderUnavailableError(f"INMET indisponível: {exc}") from exc

        if not records:
            raise ProviderUnavailableError("INMET retornou resposta vazia.")

        # Pega o registro mais recente com temperatura e umidade válidas
        reading = self._pick_latest(records)
        if reading is None:
            raise ProviderUnavailableError("INMET: nenhum registro válido nas últimas 24 h.")

        return NormalizedCurrentWeather(
            region_code=region.code,
            temperature_c=_safe_float(reading.get("TEM_INS")),
            humidity_percent=_safe_int(reading.get("UMD_INS")),
            rain_mm=_safe_float(reading.get("CHUVA")),
            wind_kmh=_safe_float(reading.get("VEN_VEL")),
            aqi=None,
            pm25=None,
            pm10=None,
            observed_at=self._parse_dt(reading),
            source=self.name,
        )

    async def get_forecast(self, region: Region, horizon_hours: int = 48) -> list[NormalizedForecastReading]:
        # INMET não oferece endpoint de previsão na API pública — retorna vazia
        # para que o WeatherService use outro provider para forecast.
        raise ProviderUnavailableError("INMET não fornece previsão. Use outro provider.")

    @staticmethod
    def _pick_latest(records: list[dict]) -> dict | None:
        valid = [
            r for r in records
            if r.get("TEM_INS") not in (None, "", "null")
            and r.get("UMD_INS") not in (None, "", "null")
        ]
        return valid[-1] if valid else None

    @staticmethod
    def _parse_dt(record: dict) -> datetime:
        try:
            dt_str = f"{record['DT_MEDICAO']} {record['HR_MEDICAO'][:2]}:00"
            return datetime.strptime(dt_str, "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)
        except Exception:
            return datetime.now(tz=timezone.utc)

from __future__ import annotations

import asyncio
import random
import time
from dataclasses import dataclass

import httpx

from app.core.config import get_settings
from app.services.exceptions import ProviderUnavailableError


class TokenBucket:
    def __init__(self, capacity: int, refill_per_second: float) -> None:
        self.capacity = max(1, capacity)
        self.refill_per_second = max(0.1, refill_per_second)
        self.tokens = float(self.capacity)
        self.last_refill = time.monotonic()
        self._lock = asyncio.Lock()

    async def acquire(self) -> None:
        while True:
            async with self._lock:
                now = time.monotonic()
                elapsed = now - self.last_refill
                self.tokens = min(self.capacity, self.tokens + elapsed * self.refill_per_second)
                self.last_refill = now

                if self.tokens >= 1:
                    self.tokens -= 1
                    return

                missing = 1 - self.tokens
                wait_seconds = missing / self.refill_per_second

            await asyncio.sleep(wait_seconds)


@dataclass(slots=True)
class CircuitSnapshot:
    state: str
    failures: int


class CircuitBreaker:
    def __init__(self, failure_threshold: int, recovery_seconds: int) -> None:
        self.failure_threshold = max(1, failure_threshold)
        self.recovery_seconds = max(1, recovery_seconds)
        self._state = "closed"
        self._failures = 0
        self._opened_at: float | None = None
        self._lock = asyncio.Lock()

    async def can_execute(self) -> bool:
        async with self._lock:
            if self._state == "open":
                if self._opened_at is None:
                    return False
                if (time.monotonic() - self._opened_at) >= self.recovery_seconds:
                    self._state = "half_open"
                    return True
                return False
            return True

    async def record_success(self) -> None:
        async with self._lock:
            self._failures = 0
            self._state = "closed"
            self._opened_at = None

    async def record_failure(self) -> None:
        async with self._lock:
            self._failures += 1
            if self._failures >= self.failure_threshold:
                self._state = "open"
                self._opened_at = time.monotonic()

    async def snapshot(self) -> CircuitSnapshot:
        async with self._lock:
            return CircuitSnapshot(state=self._state, failures=self._failures)


class ResilientHTTPClient:
    def __init__(self) -> None:
        settings = get_settings()
        self.timeout_seconds = settings.request_timeout_seconds
        self.max_retries = max(0, settings.max_retries)
        self.backoff_seconds = max(0.1, settings.retry_backoff_seconds)
        self.bucket_capacity = settings.token_bucket_capacity
        self.bucket_refill = settings.token_bucket_refill_per_second
        self.cb_failures = settings.circuit_breaker_failure_threshold
        self.cb_recovery_seconds = settings.circuit_breaker_recovery_seconds

        self._client = httpx.AsyncClient(timeout=self.timeout_seconds)
        self._buckets: dict[str, TokenBucket] = {}
        self._circuits: dict[str, CircuitBreaker] = {}

    async def close(self) -> None:
        await self._client.aclose()

    def _bucket_for(self, source: str) -> TokenBucket:
        if source not in self._buckets:
            self._buckets[source] = TokenBucket(
                capacity=self.bucket_capacity,
                refill_per_second=self.bucket_refill,
            )
        return self._buckets[source]

    def _circuit_for(self, source: str) -> CircuitBreaker:
        if source not in self._circuits:
            self._circuits[source] = CircuitBreaker(
                failure_threshold=self.cb_failures,
                recovery_seconds=self.cb_recovery_seconds,
            )
        return self._circuits[source]

    @staticmethod
    def _is_retryable_status(status_code: int) -> bool:
        return status_code == 429 or status_code >= 500

    async def get_json(
        self,
        *,
        source: str,
        url: str,
        params: dict[str, str | int | float] | None = None,
        headers: dict[str, str] | None = None,
    ) -> dict:
        bucket = self._bucket_for(source)
        circuit = self._circuit_for(source)

        await bucket.acquire()
        if not await circuit.can_execute():
            raise ProviderUnavailableError(f"Circuit breaker aberto para {source}")

        last_error: Exception | None = None
        for attempt in range(self.max_retries + 1):
            try:
                response = await self._client.get(url, params=params, headers=headers)

                if self._is_retryable_status(response.status_code):
                    raise httpx.HTTPStatusError(
                        message=f"Status retryavel: {response.status_code}",
                        request=response.request,
                        response=response,
                    )

                response.raise_for_status()
                payload = response.json()
                if not isinstance(payload, dict):
                    raise ValueError("Resposta invalida da API externa.")

                await circuit.record_success()
                return payload

            except httpx.HTTPStatusError as exc:
                last_error = exc
                status = exc.response.status_code
                can_retry = self._is_retryable_status(status) and attempt < self.max_retries
                if can_retry:
                    await asyncio.sleep(self._backoff_delay(attempt))
                    continue
                await circuit.record_failure()
                raise ProviderUnavailableError(
                    f"Fonte {source} indisponivel (HTTP {status})."
                ) from exc

            except (httpx.TimeoutException, httpx.TransportError, ValueError) as exc:
                last_error = exc
                if attempt < self.max_retries:
                    await asyncio.sleep(self._backoff_delay(attempt))
                    continue
                await circuit.record_failure()
                raise ProviderUnavailableError(
                    f"Fonte {source} indisponivel ({exc.__class__.__name__})."
                ) from exc

        await circuit.record_failure()
        raise ProviderUnavailableError(f"Falha desconhecida em {source}: {last_error}")

    def _backoff_delay(self, attempt: int) -> float:
        base = self.backoff_seconds * (2**attempt)
        jitter = random.uniform(0, 0.25)
        return base + jitter

    async def source_status(self, source: str) -> dict[str, str | int]:
        circuit = self._circuit_for(source)
        snap = await circuit.snapshot()
        return {
            "state": snap.state,
            "failures": snap.failures,
        }

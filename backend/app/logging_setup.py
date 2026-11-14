"""Logging with secret redaction.

Every handler of the root and uvicorn loggers gets a filter that replaces known
secret values (the Earthdata token) with ``[REDACTED]`` before a record is emitted.
"""

from __future__ import annotations

import logging
import sys

REDACTED = "[REDACTED]"


class RedactSecretsFilter(logging.Filter):
    def __init__(self, secrets: tuple[str, ...]) -> None:
        super().__init__()
        self._secrets = tuple(s for s in secrets if s)

    def filter(self, record: logging.LogRecord) -> bool:
        if not self._secrets:
            return True
        try:
            message = record.getMessage()
        except Exception:  # malformed record: leave it to the handler
            return True
        redacted = message
        for secret in self._secrets:
            redacted = redacted.replace(secret, REDACTED)
        if redacted != message:
            record.msg = redacted
            record.args = ()
        return True


def setup_logging(level: str, secrets: tuple[str, ...]) -> None:
    root = logging.getLogger()
    if not root.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
        root.addHandler(handler)
    root.setLevel(level)
    redactor = RedactSecretsFilter(secrets)
    for name in ("", "uvicorn", "uvicorn.error", "uvicorn.access"):
        for handler in logging.getLogger(name).handlers:
            if not any(isinstance(f, RedactSecretsFilter) for f in handler.filters):
                handler.addFilter(redactor)
    # Request URLs of HTTP clients are not secret, but keep client logs quiet.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)

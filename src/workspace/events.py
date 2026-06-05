"""
Events utility — append structured events to events.jsonl.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone


def new_event(event_type: str, data: dict | None = None) -> dict:
    return {
        "ts": datetime.now(timezone.utc).isoformat(),
        "type": event_type,
        "data": data or {},
    }


def event_to_jsonl(event: dict) -> str:
    return json.dumps(event, ensure_ascii=False) + "\n"


def append_event(events_path: str, event_type: str, data: dict | None = None) -> dict:
    """Build and return the event dict — caller is responsible for appending to file."""
    return new_event(event_type, data)

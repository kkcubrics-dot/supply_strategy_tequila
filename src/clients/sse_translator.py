"""
BA SSE → ai-sdk wire format translator.
Parses BA platform raw SSE events and translates to frontend-consumable events.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field


_STRATEGY_RE = re.compile(
    r'\[\[STRATEGY\s+id="([^"]+)"\s+name="([^"]*)"\s+action="([^"]*)"'
    r'(?:\s+logic="([^"]*)")?'
    r'(?:\s+target="([^"]*)")?'
    r'(?:\s+expected_effect="([^"]*)")?'
    r'(?:\s+priority="([^"]*)")?'
    r'(?:\s+affect_items="([^"]*)")?'
    r'\]\]',
)


@dataclass
class TranslatorState:
    """Mutable state shared across events in a single stream."""
    session_id: str | None = None
    pending_strategy_cards: list[dict] = field(default_factory=list)
    current_text_id: str | None = None
    current_reasoning_id: str | None = None
    accumulated_text: list[str] = field(default_factory=list)


def translate_event(ba_event: dict, state: TranslatorState) -> list[dict]:
    """
    Translate a single BA SSE event into zero or more ai-sdk wire format events.
    Returns a list of event dicts.
    """
    results: list[dict] = []
    event_type = ba_event.get("event", "")
    data = ba_event.get("data", {})

    if event_type == "init":
        state.session_id = data.get("session_id", "")
        results.append({"type": "start"})
        results.append({"type": "data-session", "data": {"session_id": state.session_id}})

    elif event_type == "ping":
        pass  # discard

    elif event_type == "section":
        usage = data.get("usage", "")
        content = data.get("content", "")

        if usage == "thinking":
            rid = state.current_reasoning_id or "reasoning"
            state.current_reasoning_id = rid
            results.append({"type": "reasoning-start", "id": rid})
            results.append({"type": "reasoning-delta", "id": rid, "delta": content})
            results.append({"type": "reasoning-end", "id": rid})

        elif usage == "conclusion":
            mid = state.current_text_id or "msg"
            state.current_text_id = mid
            results.append({"type": "text-start", "id": mid})

            # Extract strategy markers
            clean = content
            for m in _STRATEGY_RE.finditer(content):
                card = {
                    "id": m.group(1),
                    "name": m.group(2),
                    "action": m.group(3),
                    "logic": m.group(4) or "",
                    "target": m.group(5) or "",
                    "expected_effect": m.group(6) or "",
                    "priority": m.group(7) or "medium",
                    "affect_items": (m.group(8) or "").split(",") if m.group(8) else [],
                    "state": "pending",
                }
                state.pending_strategy_cards.append(card)
                clean = clean.replace(m.group(0), "")

            # Chunk text-delta (4 chars each)
            for i in range(0, len(clean), 4):
                results.append({"type": "text-delta", "id": mid, "delta": clean[i:i + 4]})

            results.append({"type": "text-end", "id": mid})

        elif usage == "process":
            kind = data.get("kind", "")
            if kind == "tool_use":
                results.append({"type": "tool-input-start"})
                results.append({"type": "tool-input-available", "data": data})
            elif kind == "tool_result":
                results.append({"type": "tool-output-available", "data": data})

    elif event_type == "resource_synced":
        resources = data.get("resources", [])
        for res in resources:
            path = res.get("path", "")
            if path.startswith("artifacts/"):
                results.append({
                    "type": "data-artifact-ref",
                    "data": {
                        "artifact_id": _extract_artifact_id(path),
                        "kind": "live",
                        "path": path,
                    },
                })
            elif path.startswith("state/run_"):
                results.append({
                    "type": "data.updated",
                    "data": {"path": path, "run_id": _extract_run_id(path)},
                })

    elif event_type == "error":
        results.append({"type": "error", "errorText": str(data)})

    elif event_type == "done":
        # Emit pending strategy cards
        for card in state.pending_strategy_cards:
            results.append({"type": "strategy-card", "data": card})
        state.pending_strategy_cards.clear()

        results.append({
            "type": "finish",
            "messageMetadata": {
                "session_id": state.session_id,
                "cost_usd": data.get("cost_usd", 0),
                "input_tokens": data.get("input_tokens", 0),
                "output_tokens": data.get("output_tokens", 0),
            },
        })

    return results


def _extract_run_id(path: str) -> str:
    if "run_" not in path:
        return ""
    start = path.index("run_") + 4
    end = path.index("__", start) if "__" in path[start:] else len(path)
    return path[start:end]


def _extract_artifact_id(path: str) -> str:
    parts = path.replace("artifacts/", "").split("__")
    if len(parts) >= 3:
        return parts[2]
    return "unknown"

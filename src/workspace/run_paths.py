"""
Logical path ↔ physical path encoding/decoding.
The BA platform only allows single-level path writes under state/ and artifacts/.
All paths go through this module — frontend NEVER constructs physical paths directly.

Rules:
  runs/<run_id>/<section>/<file>       → state/run_<run_id>__<section>_<file>
  runs/<run_id>/artifact/live/<id>/<f>  → artifacts/run_<run_id>__live_<id>__<f>
  runs/<run_id>/artifact/static/<f>     → artifacts/run_<run_id>__static_<f>
  system/<file>                         → state/system_<file>
"""

from __future__ import annotations

import re
from dataclasses import dataclass

_RUN_ID_RE = re.compile(r"^[a-z0-9_-]+$")


@dataclass(frozen=True)
class ParsedLogicalPath:
    run_id: str
    section: str
    filename: str
    is_artifact: bool = False
    artifact_kind: str = ""  # "live" | "static"
    artifact_id: str = ""


def _validate_run_id(run_id: str) -> None:
    if not _RUN_ID_RE.match(run_id):
        raise ValueError(f"Invalid run_id: {run_id!r} (allowed: [a-z0-9_-])")


def physical_path_for_logical_path(logical_path: str) -> str:
    """
    Convert a logical path to physical storage path.

    >>> physical_path_for_logical_path("runs/run_001/run.json")
    'state/run_run_001__run.json'
    >>> physical_path_for_logical_path("runs/run_001/data/analysis.json")
    'state/run_run_001__data_analysis.json'
    >>> physical_path_for_logical_path("runs/run_001/artifact/live/current_view/sources.json")
    'artifacts/run_run_001__live_current_view__sources.json'
    >>> physical_path_for_logical_path("runs/run_001/artifact/static/report.md")
    'artifacts/run_run_001__static_report.md'
    """
    parts = logical_path.lstrip("/").split("/")
    if parts[0] == "system":
        return f"state/{'_'.join(parts)}"

    if parts[0] == "runs":
        run_id = parts[1]
        _validate_run_id(run_id)
        tail = "/".join(parts[2:])

        if tail.startswith("artifact/live/"):
            sub = tail.removeprefix("artifact/live/")
            id_parts = sub.split("/")
            artifact_id = id_parts[0]
            filename = id_parts[1] if len(id_parts) > 1 else ""
            suffix = f"__{filename}" if filename else ""
            return f"artifacts/run_{run_id}__live_{artifact_id}{suffix}"

        if tail.startswith("artifact/static/"):
            filename = tail.removeprefix("artifact/static/")
            return f"artifacts/run_{run_id}__static_{filename}"

        section_file = tail.replace("/", "_")
        return f"state/run_{run_id}__{section_file}"

    return logical_path


def parse_logical_path(logical_path: str) -> ParsedLogicalPath:
    """Decompose a logical path into its components."""
    parts = logical_path.strip("/").split("/")

    if parts[0] != "runs":
        return ParsedLogicalPath(
            run_id="", section=parts[0], filename=parts[-1]
        )

    run_id = parts[1]
    tail = parts[2:]

    if tail and tail[0] == "artifact":
        if len(tail) >= 3 and tail[1] == "live":
            return ParsedLogicalPath(
                run_id=run_id,
                section="artifact",
                filename=tail[-1],
                is_artifact=True,
                artifact_kind="live",
                artifact_id=tail[2],
            )
        if len(tail) >= 3 and tail[1] == "static":
            return ParsedLogicalPath(
                run_id=run_id,
                section="artifact",
                filename=tail[-1],
                is_artifact=True,
                artifact_kind="static",
                artifact_id="",
            )

    section = tail[0] if tail else ""
    filename = tail[-1] if tail else ""
    return ParsedLogicalPath(run_id=run_id, section=section, filename=filename)


# ─── Convenience builders ───────────────────────────────────────


def physical_run_manifest(run_id: str) -> str:
    return physical_path_for_logical_path(f"runs/{run_id}/run.json")


def physical_input_manifest(run_id: str) -> str:
    return physical_path_for_logical_path(f"runs/{run_id}/input_manifest.json")


def physical_skill_manifest(run_id: str) -> str:
    return physical_path_for_logical_path(f"runs/{run_id}/skill_manifest.json")


def physical_data_file(run_id: str, name: str) -> str:
    return physical_path_for_logical_path(f"runs/{run_id}/data/{name}")


def physical_card_file(run_id: str) -> str:
    return physical_path_for_logical_path(f"runs/{run_id}/data/cards.json")


def physical_strategy_log(run_id: str) -> str:
    return physical_path_for_logical_path(f"runs/{run_id}/data/strategy_log.jsonl")


def physical_operation_log(run_id: str) -> str:
    return physical_path_for_logical_path(f"runs/{run_id}/logs/operation_log.jsonl")


def physical_messages(run_id: str) -> str:
    return physical_path_for_logical_path(f"runs/{run_id}/logs/messages.jsonl")


def physical_events(run_id: str) -> str:
    return physical_path_for_logical_path(f"runs/{run_id}/logs/events.jsonl")


def physical_live_artifact(run_id: str, artifact_id: str, suffix: str) -> str:
    return physical_path_for_logical_path(
        f"runs/{run_id}/artifact/live/{artifact_id}/{suffix}"
    )


def physical_static_artifact(run_id: str, filename: str) -> str:
    return physical_path_for_logical_path(f"runs/{run_id}/artifact/static/{filename}")


def physical_static_manifest(run_id: str) -> str:
    return physical_path_for_logical_path(
        f"runs/{run_id}/artifact/static/_manifest.json"
    )


def physical_conversation_binding(conversation_id: str) -> str:
    return f"state/system_conversations_{conversation_id}.json"


def physical_runs_index() -> str:
    return "state/runs_index.json"

"""
Pydantic data contracts for supply_strategy_tequila.
All core object models defined here — single source of truth for data shapes.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel


# ─── Run ────────────────────────────────────────────────────────


class RunManifest(BaseModel):
    run_id: str
    title: str
    stage: str = "select_merchant"
    status: Literal["active", "completed", "failed", "archived"] = "active"
    skill_id: str = "analysis"
    conversation_ids: list[str] = []
    agent_session_id: str | None = None
    created_at: str = ""
    updated_at: str = ""


class RunSummary(BaseModel):
    run_id: str
    title: str
    stage: str
    status: str
    updated_at: str


class RunsIndex(BaseModel):
    runs: list[RunSummary] = []
    active_run_id: str | None = None


# ─── Input Manifest ─────────────────────────────────────────────


class InputFileEntry(BaseModel):
    file_id: str
    filename: str
    kind: str = "xlsx"
    logical_path: str = ""
    physical_path: str = ""
    rows: int = 0
    columns: list[str] = []
    size_bytes: int = 0
    uploaded_at: str = ""


class InputManifest(BaseModel):
    run_id: str
    files: list[InputFileEntry] = []


# ─── Data Files ─────────────────────────────────────────────────


class AnalysisSchema(BaseModel):
    source: str = ""
    items: list[dict] = []
    summary: dict = {}
    updated_at: str = ""


class CardEntry(BaseModel):
    id: str
    name: str
    description: str
    sku_count: int = 0
    state: Literal["pending", "accepted", "rejected", "modified"] = "pending"
    priority: Literal["high", "medium", "low"] = "medium"
    action: str = ""
    logic: str = ""
    target: str = ""
    expected_effect: str = ""
    affect_items: list[str] = []
    created_at: str = ""


class CardsManifest(BaseModel):
    run_id: str
    cards: list[CardEntry] = []


class StrategyLogEntry(BaseModel):
    timestamp: str
    card_id: str
    action: str
    reason: str = ""


# ─── Artifact ───────────────────────────────────────────────────


class ResourceSource(BaseModel):
    type: str = "run_file"
    path: str = ""
    selector: str = "$"


class LiveArtifactManifest(BaseModel):
    artifact_id: str
    kind: Literal["live"] = "live"
    title: str
    renderer: str = "table"
    version: int = 1
    updated_at: str = ""


class LiveArtifactSources(BaseModel):
    sources: dict[str, ResourceSource] = {}
    refresh: dict = {}


class LiveArtifactView(BaseModel):
    layout: dict = {}


class LiveArtifactActions(BaseModel):
    actions: dict = {}


class LiveArtifactResponse(BaseModel):
    artifact_id: str
    kind: Literal["live"] = "live"
    manifest: LiveArtifactManifest
    sources: LiveArtifactSources
    view: LiveArtifactView
    actions: LiveArtifactActions


class StaticArtifactEntry(BaseModel):
    artifact_id: str
    kind: Literal["static"] = "static"
    name: str
    title: str
    path: str = ""
    media_type: str = "text/markdown"
    downloadable: bool = True
    updated_at: str = ""


class StaticArtifactsManifest(BaseModel):
    run_id: str
    artifacts: list[StaticArtifactEntry] = []


# ─── File Tree ──────────────────────────────────────────────────


class FileTreeNode(BaseModel):
    name: str
    section: str = ""
    kind: str = ""
    logical_path: str = ""
    physical_path: str = ""
    run_id: str = ""
    synced: bool = True
    open_behavior: str = "preview"
    children: list[FileTreeNode] = []


class FileTreeResponse(BaseModel):
    run_id: str
    sections: list[dict] = []


# ─── Skill ──────────────────────────────────────────────────────


class SkillEntry(BaseModel):
    skill_id: str
    name: str = ""
    description: str = ""
    version: str = "1.0.0"
    enabled: bool = False
    enabled_by_default: bool = False
    path: str = ""
    sync_status: Literal["synced", "failed", "missing", "unknown", "local_only"] = "unknown"
    sku_count: int = 0


class SkillManifest(BaseModel):
    run_id: str
    default_skill: str = "analysis"
    allowed_skills: list[SkillEntry] = []


# ─── Card Action Transaction ────────────────────────────────────


class CardActionTransaction(BaseModel):
    transaction_id: str
    card_id: str
    action: Literal["accept", "reject", "modify"]
    read_paths: list[str] = []
    written_paths: list[str] = []
    events: list[str] = []
    render_views_changed: list[str] = []
    created_at: str = ""


# ─── Conversation ───────────────────────────────────────────────


class ConversationBinding(BaseModel):
    conversation_id: str
    run_id: str
    agent_session_id: str | None = None
    created_at: str = ""


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str
    ts: str = ""
    conversation_id: str = ""
    session_id: str | None = None
    card_ids: list[str] = []
    cost_usd: float = 0.0


class ChatRequest(BaseModel):
    prompt: str
    conversation_id: str = ""
    skill_name: str | None = None


class ChatResponse(BaseModel):
    session_id: str = ""
    message_id: str = ""

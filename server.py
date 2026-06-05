#!/usr/bin/env python3
"""
Main FastAPI server — supply_strategy_tequila
Serves static frontend + /api/* routes + agent proxy to agent/server.py on :8001
"""

from __future__ import annotations

import json
import os
import time
import uuid
from datetime import datetime, timezone

from fastapi import FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from src.workspace.run_paths import (
    physical_input_manifest,
    physical_run_manifest,
    physical_runs_index,
)

app = FastAPI(title="Supply Strategy Tequila", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── In-memory state (placeholder until S3/BA workspace integration) ───

_runs_index: dict = {"runs": [], "active_run_id": None}
_run_data: dict = {}           # run_id → { run.json, input_manifest, data/*, cards, messages, skills }
_artifact_data: dict = {}      # run_id → { artifact_id → live artifact response }

_messages: dict[str, list] = {}
_cards: dict[str, list] = {}


# ─── Static files ────────────────────────────────────────────────

@app.get("/")
async def root():
    return FileResponse("web/index.html")


# ─── Run APIs ─────────────────────────────────────────────────────

@app.get("/api/runs")
async def list_runs():
    return _runs_index


@app.post("/api/runs")
async def create_run(request: Request):
    body = await request.json()
    run_id = "run_" + uuid.uuid4().hex[:8]
    now = datetime.now(timezone.utc).isoformat()
    title = body.get("title", "新建任务")
    run = {
        "run_id": run_id,
        "title": title,
        "stage": "select_merchant",
        "status": "active",
        "created_at": now,
        "updated_at": now,
        "skill_id": "analysis",
        "conversation_ids": [],
        "agent_session_id": None,
    }
    _run_data[run_id] = {"run": run, "input_manifest": {"run_id": run_id, "files": []}}
    _runs_index["runs"].insert(0, {
        "run_id": run_id,
        "title": title,
        "stage": "select_merchant",
        "status": "active",
        "updated_at": now,
    })
    _runs_index["active_run_id"] = run_id
    _messages[run_id] = []
    _cards[run_id] = []
    _artifact_data[run_id] = {}
    return run


@app.get("/api/runs/{run_id}")
async def get_run(run_id: str):
    data = _run_data.get(run_id)
    if not data or "run" not in data:
        raise HTTPException(404, "Run not found")
    return data["run"]


@app.patch("/api/runs/{run_id}")
async def patch_run(run_id: str, request: Request):
    body = await request.json()
    data = _run_data.get(run_id)
    if not data or "run" not in data:
        raise HTTPException(404, "Run not found")
    run = data["run"]
    if "title" in body:
        run["title"] = body["title"]
    if "stage" in body:
        run["stage"] = body["stage"]
    run["updated_at"] = datetime.now(timezone.utc).isoformat()
    # Sync runs_index summary
    for r in _runs_index.get("runs", []):
        if r["run_id"] == run_id:
            r["stage"] = run["stage"]
            r["updated_at"] = run["updated_at"]
            if "title" in body:
                r["title"] = body["title"]
    return run


@app.post("/api/runs/{run_id}/activate")
async def activate_run(run_id: str):
    if run_id not in _run_data:
        raise HTTPException(404, "Run not found")
    _runs_index["active_run_id"] = run_id
    return {"active_run_id": run_id}


# ─── Input APIs ───────────────────────────────────────────────────

@app.post("/api/runs/{run_id}/inputs/upload")
async def upload_input(run_id: str, file: UploadFile = File(...)):
    if run_id not in _run_data:
        raise HTTPException(404, "Run not found")

    content = await file.read()
    size = len(content)
    file_id = "file_" + uuid.uuid4().hex[:8]
    ext = file.filename.rsplit(".", 1)[-1].lower() if file.filename and "." in file.filename else "csv"
    now = datetime.now(timezone.utc).isoformat()

    entry = {
        "file_id": file_id,
        "filename": file.filename,
        "kind": ext,
        "logical_path": f"runs/{run_id}/input/{file.filename}",
        "physical_path": f"uploads/{file.filename}",
        "rows": 0,
        "columns": [],
        "size_bytes": size,
        "uploaded_at": now,
    }
    data = _run_data[run_id]
    data.setdefault("input_manifest", {"run_id": run_id, "files": []})
    data["input_manifest"]["files"].append(entry)

    # Auto-advance stage
    run = data.get("run", {})
    if run.get("stage") == "select_merchant":
        run["stage"] = "execute_selection"
        run["updated_at"] = now

    return entry


@app.get("/api/runs/{run_id}/inputs")
async def list_inputs(run_id: str):
    data = _run_data.get(run_id)
    if not data:
        raise HTTPException(404, "Run not found")
    return data.get("input_manifest", {"run_id": run_id, "files": []})


# ─── File Tree ────────────────────────────────────────────────────

@app.get("/api/runs/{run_id}/tree")
async def get_file_tree(run_id: str):
    data = _run_data.get(run_id)
    if not data:
        raise HTTPException(404, "Run not found")

    manifest = data.get("input_manifest", {})
    files = manifest.get("files", [])

    sections = []
    if files:
        sections.append({
            "section": "input",
            "label": "输入文件",
            "children": files,
        })

    # Data section
    data_files = data.get("data_files", {})
    if data_files:
        sections.append({
            "section": "data",
            "label": "工作数据",
            "children": [{"name": k, "kind": "json"} for k in data_files],
        })

    # Artifacts section
    artifacts = _artifact_data.get(run_id, {})
    if artifacts:
        sections.append({
            "section": "artifact",
            "label": "工作产物",
            "children": [
                {"name": aid, "kind": "html", "live": True}
                for aid in artifacts
            ],
        })

    return {"run_id": run_id, "sections": sections}


# ─── Data APIs ────────────────────────────────────────────────────

@app.get("/api/runs/{run_id}/data/{name}")
async def get_data(run_id: str, name: str):
    data = _run_data.get(run_id)
    if not data:
        raise HTTPException(404, "Run not found")
    df = data.get("data_files", {})
    if name not in df:
        raise HTTPException(404, f"Data file {name} not found")
    return df[name]


@app.patch("/api/runs/{run_id}/data/{name}")
async def patch_data(run_id: str, name: str, request: Request):
    body = await request.json()
    data = _run_data.get(run_id)
    if not data:
        raise HTTPException(404, "Run not found")
    data.setdefault("data_files", {})
    existing = data["data_files"].get(name, {})
    existing.update(body)
    data["data_files"][name] = existing
    return existing


@app.get("/api/runs/{run_id}/data/content")
async def get_data_content(
    run_id: str,
    physical_path: str = Query(...),
):
    data = _run_data.get(run_id)
    if not data:
        raise HTTPException(404, "Run not found")
    df = data.get("data_files", {})
    for k, v in df.items():
        if physical_path.endswith(k):
            return v
    raise HTTPException(404, f"File not found: {physical_path}")


# ─── Messages ─────────────────────────────────────────────────────

@app.get("/api/runs/{run_id}/messages")
async def get_messages(run_id: str):
    return {"messages": _messages.get(run_id, [])}


# ─── Cards ────────────────────────────────────────────────────────

@app.get("/api/runs/{run_id}/cards")
async def get_cards(run_id: str):
    return {"cards": _cards.get(run_id, [])}


@app.post("/api/runs/{run_id}/cards/{card_id}/apply")
async def apply_card(run_id: str, card_id: str, request: Request):
    body = await request.json()
    action = body.get("action", "accept")

    cards = _cards.get(run_id, [])
    for c in cards:
        if c["id"] == card_id:
            c["state"] = action + ("ed" if action == "accept" else "ed")
            break

    now = datetime.now(timezone.utc).isoformat()
    return {
        "transaction_id": "txn_" + uuid.uuid4().hex[:8],
        "card_id": card_id,
        "action": action,
        "written_paths": [
            f"runs/{run_id}/data/cards.json",
            f"runs/{run_id}/data/strategy_log.jsonl",
        ],
        "events": ["data.updated", "artifact.updated"],
        "render_views_changed": ["current_view"],
        "created_at": now,
    }


# ─── Artifacts ────────────────────────────────────────────────────

@app.get("/api/runs/{run_id}/artifacts")
async def list_artifacts(run_id: str):
    artifacts = _artifact_data.get(run_id, {})
    return {"artifacts": list(artifacts.values())}


@app.get("/api/runs/{run_id}/artifacts/{artifact_id}")
async def get_artifact(run_id: str, artifact_id: str):
    artifacts = _artifact_data.get(run_id, {})
    if artifact_id in artifacts:
        return artifacts[artifact_id]
    # Return a default live artifact response
    return {
        "artifact_id": artifact_id,
        "kind": "live",
        "manifest": {"title": "当前分析", "renderer": "table", "version": 1},
        "sources": {},
        "view": {},
        "actions": {},
    }


# ─── Skills ───────────────────────────────────────────────────────

@app.get("/api/runs/{run_id}/skills")
async def get_skills(run_id: str):
    data = _run_data.get(run_id)
    if not data:
        raise HTTPException(404, "Run not found")
    skills = data.get("skills", [
        {"skill_id": "analysis", "name": "Skill: 高复购外卖截流", "description": "拦截商圈高检索但本地供给缺口的餐饮品类", "enabled": True, "sync_status": "synced", "sku_count": 22},
        {"skill_id": "diagnose", "name": "Skill: 门店自动化诊断", "description": "自动分析门店经营数据，提供SKU汰换与补充建议", "enabled": False, "sync_status": "local_only", "sku_count": -13},
        {"skill_id": "defense", "name": "Skill: 商圈竞对防御", "description": "分析5公里内竞对上新趋势，生成防御性跟进策略", "enabled": False, "sync_status": "unknown", "sku_count": 8},
        {"skill_id": "pricing", "name": "Skill: 动态定价引擎", "description": "根据商圈供需实时调整价格带", "enabled": True, "sync_status": "synced", "sku_count": 0},
    ])
    return {"run_id": run_id, "default_skill": "analysis", "allowed_skills": skills}


@app.patch("/api/runs/{run_id}/skills/{skill_id}")
async def patch_skill(run_id: str, skill_id: str, request: Request):
    body = await request.json()
    data = _run_data.get(run_id)
    if not data:
        raise HTTPException(404, "Run not found")
    if "skills" not in data:
        data["skills"] = [
            {"skill_id": "analysis", "name": "Skill: 高复购外卖截流", "description": "拦截商圈高检索但本地供给缺口的餐饮品类", "enabled": True, "sync_status": "synced", "sku_count": 22},
            {"skill_id": "diagnose", "name": "Skill: 门店自动化诊断", "description": "自动分析门店经营数据，提供SKU汰换与补充建议", "enabled": False, "sync_status": "local_only", "sku_count": -13},
            {"skill_id": "defense", "name": "Skill: 商圈竞对防御", "description": "分析5公里内竞对上新趋势，生成防御性跟进策略", "enabled": False, "sync_status": "unknown", "sku_count": 8},
            {"skill_id": "pricing", "name": "Skill: 动态定价引擎", "description": "根据商圈供需实时调整价格带", "enabled": True, "sync_status": "synced", "sku_count": 0},
        ]
    for s in data["skills"]:
        if s["skill_id"] == skill_id:
            s["enabled"] = body.get("enabled", s["enabled"])
            return s
    raise HTTPException(404, f"Skill {skill_id} not found")


@app.post("/api/agent/skills/sync-to-workspace")
async def sync_skills():
    return {"synced": ["analysis", "diagnose", "defense", "pricing"], "failed": []}


# ─── Agent Chat (SSE stream placeholder) ──────────────────────────

@app.post("/api/runs/{run_id}/chat")
async def chat(run_id: str, request: Request):
    """
    Placeholder SSE chat endpoint.
    Returns a mock streaming response until BA chat-gateway is integrated.
    """
    body = await request.json()
    prompt = body.get("prompt", "")

    async def event_stream():
        msg_id = "msg_" + uuid.uuid4().hex[:6]
        session_id = "sess_" + uuid.uuid4().hex[:8]
        yield f"data: {json.dumps({'type': 'start'})}\n\n"
        yield f"data: {json.dumps({'type': 'data-session', 'data': {'session_id': session_id}})}\n\n"

        # Mock thinking
        yield f"data: {json.dumps({'type': 'reasoning-start', 'id': msg_id})}\n\n"
        yield f"data: {json.dumps({'type': 'reasoning-delta', 'id': msg_id, 'delta': '正在分析输入数据，寻找关键模式...'})}\n\n"
        yield f"data: {json.dumps({'type': 'reasoning-end', 'id': msg_id})}\n\n"

        # Mock text
        yield f"data: {json.dumps({'type': 'text-start', 'id': msg_id})}\n\n"

        mock_response = (
            f"针对「{prompt}」的分析已就绪。系统已完成多维度数据测算，"
            "覆盖品类结构、转化漏斗与竞品动态。请查看右侧画布的详细数据看板，"
            "并根据下方策略卡片进行操作。"
        )
        chunk_size = 4
        for i in range(0, len(mock_response), chunk_size):
            yield f"data: {json.dumps({'type': 'text-delta', 'id': msg_id, 'delta': mock_response[i:i+chunk_size]})}\n\n"
            await asyncio_sleep(0.03)

        yield f"data: {json.dumps({'type': 'text-end', 'id': msg_id})}\n\n"

        # Strategy cards
        card1 = json.dumps({
            'type': 'strategy-card',
            'data': {
                'id': 's001',
                'name': 'Skill: 应季品扩充',
                'action': 'add',
                'priority': 'high',
                'sku_count': 22,
                'description': '- 引入当季热门冷饮和夏季特色小食。\n- 预计拉升下午茶时段订单量约 12%。',
                'state': 'pending',
            },
        })
        yield f"data: {card1}\n\n"

        card2 = json.dumps({
            'type': 'strategy-card',
            'data': {
                'id': 's002',
                'name': 'Skill: 低转化品汰换',
                'action': 'remove',
                'priority': 'medium',
                'sku_count': -13,
                'description': '- 移除连续 14 天转化率低于 5% 的长尾菜品。\n- 减少库存损耗压力，聚焦主推爆款。',
                'state': 'pending',
            },
        })
        yield f"data: {card2}\n\n"

        # Save to state
        _messages.setdefault(run_id, []).append({
            "role": "user",
            "content": prompt,
            "ts": datetime.now(timezone.utc).isoformat(),
            "conversation_id": body.get("conversation_id", ""),
        })
        _messages[run_id].append({
            "role": "assistant",
            "content": mock_response,
            "ts": datetime.now(timezone.utc).isoformat(),
            "session_id": session_id,
            "card_ids": ["s001", "s002"],
        })
        _cards.setdefault(run_id, []).extend([
            {"id": "s001", "name": "Skill: 应季品扩充", "action": "add", "priority": "high", "sku_count": 22, "description": "- 引入当季热门冷饮和夏季特色小食。\n- 预计拉升下午茶时段订单量约 12%。", "state": "pending"},
            {"id": "s002", "name": "Skill: 低转化品汰换", "action": "remove", "priority": "medium", "sku_count": -13, "description": "- 移除连续 14 天转化率低于 5% 的长尾菜品。\n- 减少库存损耗压力，聚焦主推爆款。", "state": "pending"},
        ])

        yield f"data: {json.dumps({'type': 'finish', 'messageMetadata': {'session_id': session_id, 'cost_usd': 0.05, 'input_tokens': 1200, 'output_tokens': 800}})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


# ─── Helpers ──────────────────────────────────────────────────────

import asyncio

async def asyncio_sleep(seconds: float):
    """Wrapper for asyncio.sleep that works in both sync and async contexts."""
    import asyncio as aio
    await aio.sleep(seconds)


# ─── Mount static files last ──────────────────────────────────────

app.mount("/web", StaticFiles(directory="web"), name="web")


# ─── Entrypoint ───────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("MAIN_SERVER_PORT", 8080))
    uvicorn.run("server:app", host="0.0.0.0", port=port, reload=True)

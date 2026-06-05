"""
BA chat-gateway HTTP client.
Handles SSE streaming chat + session management + artifact access.
All calls require X-SSO-Token header.
"""

from __future__ import annotations

import asyncio
import json
from typing import AsyncIterator

import httpx

BA_GATEWAY_URL = "https://ba-ai.sankuai.com"


async def stream_chat(
    prompt: str,
    project_id: str,
    sso_token: str,
    session_id: str | None = None,
    skill_name: str = "analysis",
    command: str = "",
    enable_thinking: bool = True,
) -> AsyncIterator[dict]:
    """
    Call BA chat-gateway SSE endpoint and yield parsed events.
    Returns an async iterator of event dicts.
    """
    body = {
        "prompt": prompt,
        "project_id": project_id,
        "session_id": session_id,
        "provider": "claude-service",
        "skill_name": skill_name,
        "command": command,
        "enable_thinking": enable_thinking,
        "current_scope": "project",
        "current_scope_key": project_id,
    }

    async with httpx.AsyncClient(timeout=300) as client:
        async with client.stream(
            "POST",
            f"{BA_GATEWAY_URL}/fde/api/gateway/chat",
            json=body,
            headers={"X-SSO-Token": sso_token, "Content-Type": "application/json"},
        ) as response:
            response.raise_for_status()
            buffer = ""
            async for chunk in response.aiter_text():
                buffer += chunk
                while "\n\n" in buffer:
                    line, buffer = buffer.split("\n\n", 1)
                    if line.startswith("event: "):
                        event_type = line[7:].strip()
                        data = ""
                        # Read next data line
                        if "\n\n" in buffer:
                            data_line, _, buffer = buffer.partition("\n\n")
                        else:
                            data_line = buffer
                            buffer = ""
                        if data_line.startswith("data: "):
                            try:
                                data = json.loads(data_line[6:])
                            except json.JSONDecodeError:
                                data = data_line[6:]
                        yield {"event": event_type, "data": data}


async def get_artifact_content(
    path: str,
    session_id: str,
    sso_token: str,
) -> dict:
    """
    Read artifact content from BA workspace.
    Path format: artifacts/run_<id>__...
    """
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"{BA_GATEWAY_URL}/fde/api/gateway/artifacts/content",
            params={"path": path, "session_id": session_id},
            headers={"X-SSO-Token": sso_token},
        )
        resp.raise_for_status()
        return resp.json()

"""
Proxy from main server (port 8080) to agent server (port 8001).
Transparently forwards requests, preserving SSO headers.
"""

from __future__ import annotations

import httpx

AGENT_SERVER_URL = "http://127.0.0.1:8001"


async def proxy_chat_request(
    prompt: str,
    session_id: str | None = None,
    project_id: str = "",
    skill_name: str = "analysis",
    sso_token: str = "",
) -> httpx.Response:
    """Forward chat request to agent server, returning SSE stream."""
    async with httpx.AsyncClient(timeout=300) as client:
        return await client.post(
            f"{AGENT_SERVER_URL}/api/agent/chat",
            json={
                "prompt": prompt,
                "session_id": session_id,
                "project_id": project_id,
                "skill_name": skill_name,
            },
            headers={"X-SSO-Token": sso_token} if sso_token else {},
        )


async def proxy_skills_request() -> dict:
    """Forward skills request to agent server."""
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{AGENT_SERVER_URL}/api/agent/skills")
        return resp.json()

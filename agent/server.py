"""
Agent server — standalone FastAPI on port 8001.
Handles chat SSE streaming, skill management, and BA platform integration.
"""

from __future__ import annotations

from fastapi import FastAPI

app = FastAPI(title="Agent Server — Supply Strategy Tequila", version="1.0.0")


@app.get("/api/agent/skills")
async def get_skills():
    from agent.tools.sync_skills import load_registry
    return {"skills": load_registry()}


@app.post("/api/agent/chat")
async def agent_chat():
    """
    Placeholder — proxies to BA chat-gateway.
    Returns SSE stream of ai-sdk wire format events.
    """
    # TODO: Implement with src/clients/chat_gateway.py + src/clients/sse_translator.py
    return {"status": "not implemented — use main server chat endpoint"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("agent.server:app", host="0.0.0.0", port=8001, reload=True)

/**
 * API Client — supply_strategy_tequila
 * Wraps all backend endpoints. Functions return { ok, data, error }.
 * SSE streaming handled via runChatStream() with callbacks.
 */

const API_BASE = "/api";

// ─── Generic fetcher ────────────────────────────────────────

async function apiGet(path, params) {
    const url = new URL(API_BASE + path, window.location.origin);
    if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const res = await fetch(url, { credentials: "same-origin" });
    return res.ok ? { ok: true, data: await res.json() } : { ok: false, error: await res.json().catch(() => ({ error: res.statusText })) };
}

async function apiPost(path, body) {
    const res = await fetch(API_BASE + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(body),
    });
    return res.ok ? { ok: true, data: await res.json().catch(() => ({})) } : { ok: false, error: await res.json().catch(() => ({ error: res.statusText })) };
}

async function apiPatch(path, body) {
    const res = await fetch(API_BASE + path, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(body),
    });
    return res.ok ? { ok: true, data: await res.json().catch(() => ({})) } : { ok: false, error: await res.json().catch(() => ({ error: res.statusText })) };
}

async function apiUpload(path, file) {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(API_BASE + path, {
        method: "POST",
        credentials: "same-origin",
        body: fd,
    });
    return res.ok ? { ok: true, data: await res.json() } : { ok: false, error: await res.json().catch(() => ({ error: res.statusText })) };
}

// ─── Runs ───────────────────────────────────────────────────

async function apiListRuns() {
    return apiGet("/runs");
}

async function apiCreateRun(title) {
    return apiPost("/runs", { title });
}

async function apiGetRun(runId) {
    return apiGet(`/runs/${runId}`);
}

async function apiPatchRun(runId, updates) {
    return apiPatch(`/runs/${runId}`, updates);
}

async function apiActivateRun(runId) {
    return apiPost(`/runs/${runId}/activate`);
}

// ─── Inputs / Upload ────────────────────────────────────────

async function apiUploadInput(runId, file) {
    return apiUpload(`/runs/${runId}/inputs/upload`, file);
}

async function apiGetInputs(runId) {
    return apiGet(`/runs/${runId}/inputs`);
}

async function apiPreviewInput(runId, fileId, rows) {
    return apiGet(`/runs/${runId}/inputs/${fileId}/preview`, { rows: rows || 50 });
}

// ─── File Tree ──────────────────────────────────────────────

async function apiGetFileTree(runId) {
    return apiGet(`/runs/${runId}/tree`);
}

// ─── Data ───────────────────────────────────────────────────

async function apiGetData(runId, name) {
    return apiGet(`/runs/${runId}/data/${name}`);
}

async function apiGetDataContent(runId, physicalPath) {
    return apiGet(`/runs/${runId}/data/content`, { physical_path: physicalPath });
}

// ─── Messages ───────────────────────────────────────────────

async function apiGetMessages(runId) {
    return apiGet(`/runs/${runId}/messages`);
}

async function apiGetCards(runId) {
    return apiGet(`/runs/${runId}/cards`);
}

// ─── Artifacts ──────────────────────────────────────────────

async function apiListArtifacts(runId) {
    return apiGet(`/runs/${runId}/artifacts`);
}

async function apiGetArtifact(runId, artifactId) {
    return apiGet(`/runs/${runId}/artifacts/${artifactId}`);
}

async function apiDownloadStatic(runId, name) {
    const url = `${API_BASE}/runs/${runId}/artifacts/static/${name}/download`;
    window.open(url, "_blank");
}

// ─── Skills ─────────────────────────────────────────────────

async function apiGetSkills(runId) {
    return apiGet(`/runs/${runId}/skills`);
}

async function apiPatchSkill(runId, skillId, enabled) {
    return apiPatch(`/runs/${runId}/skills/${skillId}`, { enabled });
}

async function apiSyncSkills() {
    return apiPost("/agent/skills/sync-to-workspace");
}

// ─── Agent Chat (SSE) ───────────────────────────────────────

/**
 * Post a chat message and consume SSE stream via callbacks.
 * Returns an { abort } controller.
 *
 * @param {string} runId
 * @param {{ prompt, conversation_id?, skill_name? }} body
 * @param {object} callbacks
 * @param {function} callbacks.onStart
 * @param {function} callbacks.onSession — (sessionId)
 * @param {function} callbacks.onReasoningDelta — (id, delta)
 * @param {function} callbacks.onTextDelta — (id, delta)
 * @param {function} callbacks.onTextStart — (id)
 * @param {function} callbacks.onTextEnd — (id)
 * @param {function} callbacks.onStrategyCard — (cardData)
 * @param {function} callbacks.onArtifactRef — (data)
 * @param {function} callbacks.onDataUpdated — (data)
 * @param {function} callbacks.onArtifactUpdated — (data)
 * @param {function} callbacks.onFinish — (metadata)
 * @param {function} callbacks.onError — (errorText)
 */
function runChatStream(runId, body, callbacks) {
    const cbs = callbacks || {};
    const controller = new AbortController();

    fetch(`${API_BASE}/runs/${runId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(body),
        signal: controller.signal,
    }).then(async (res) => {
        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: res.statusText }));
            if (cbs.onError) cbs.onError(err.error || "Chat request failed");
            return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
                if (!line.startsWith("data: ")) continue;
                const payload = line.slice(6);
                if (payload === "[DONE]") continue;
                try {
                    const event = JSON.parse(payload);
                    dispatchSSE(event, cbs);
                } catch (_) { /* skip malformed */ }
            }
        }
    }).catch((err) => {
        if (err.name !== "AbortError" && cbs.onError) {
            cbs.onError(err.message || "Stream connection failed");
        }
    });

    return controller;
}

function dispatchSSE(event, cbs) {
    switch (event.type) {
        case "start":
            if (cbs.onStart) cbs.onStart();
            break;
        case "data-session":
            if (cbs.onSession) cbs.onSession(event.data.session_id);
            break;
        case "reasoning-start":
            if (cbs.onReasoningStart) cbs.onReasoningStart(event.id);
            break;
        case "reasoning-delta":
            if (cbs.onReasoningDelta) cbs.onReasoningDelta(event.id, event.delta);
            break;
        case "reasoning-end":
            if (cbs.onReasoningEnd) cbs.onReasoningEnd(event.id);
            break;
        case "text-start":
            if (cbs.onTextStart) cbs.onTextStart(event.id);
            break;
        case "text-delta":
            if (cbs.onTextDelta) cbs.onTextDelta(event.id, event.delta);
            break;
        case "text-end":
            if (cbs.onTextEnd) cbs.onTextEnd(event.id);
            break;
        case "strategy-card":
            if (cbs.onStrategyCard) cbs.onStrategyCard(event.data);
            break;
        case "data-artifact-ref":
            if (cbs.onArtifactRef) cbs.onArtifactRef(event.data);
            break;
        case "data.updated":
            if (cbs.onDataUpdated) cbs.onDataUpdated(event.data);
            break;
        case "artifact.updated":
            if (cbs.onArtifactUpdated) cbs.onArtifactUpdated(event.data);
            break;
        case "tool-input-start":
            if (cbs.onToolStart) cbs.onToolStart(event.id);
            break;
        case "tool-input-available":
            if (cbs.onToolInput) cbs.onToolInput(event.data);
            break;
        case "tool-output-available":
            if (cbs.onToolOutput) cbs.onToolOutput(event.data);
            break;
        case "data-artifact-create":
            if (cbs.onArtifactCreate) cbs.onArtifactCreate(event.data);
            break;
        case "data-ask-question":
            if (cbs.onAskQuestion) cbs.onAskQuestion(event.data);
            break;
        case "finish":
            if (cbs.onFinish) cbs.onFinish(event.messageMetadata);
            break;
        case "error":
            if (cbs.onError) cbs.onError(event.errorText || "Unknown error");
            break;
        case "run.stage_changed":
            if (cbs.onStageChanged) cbs.onStageChanged(event.data);
            break;
    }
}

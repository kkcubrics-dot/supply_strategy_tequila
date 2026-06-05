/**
 * App — supply_strategy_tequila
 * Three-panel layout: A (tasks) | B (flow/chat/files/skill) | C (canvas)
 */

// ═══════════════════ Global State ═══════════════════

const STAGE_LABELS = {
    select_merchant: "选择商家",
    execute_selection: "执行选品",
    confirm_pool: "确认品池",
    export_pool: "导出品池",
    complete: "选品完成",
};

const STAGE_ORDER = ["select_merchant", "execute_selection", "confirm_pool", "export_pool", "complete"];

const STATUS_LABELS = {
    active: "进行中",
    completed: "已完成",
    failed: "失败",
    archived: "已归档",
};

const STATUS_CLASS = {
    active: "status-badge--active",
    completed: "status-badge--done",
    failed: "status-badge--active",
    archived: "status-badge--archived",
};

const state = {
    runs: [],
    activeRunId: null,
    currentRun: null,
    currentSubTab: "flow",
    messages: [],
    fileTree: null,
    skills: [],
    canvasTabs: [],        // [{ id, title, icon, kind, content?, inline? }]
    activeCanvasTabId: null,
    abortController: null,
    streaming: false,
    agentSessionId: null,
    conversationId: null,
    darkMode: false,
    currentStreamMessageId: null,
    canvasCollapsed: false,
};

// ═══════════════════ Init ═══════════════════════════

async function init() {
    renderStepper();  // static first
    initResizers();
    loadDarkMode();
    await loadRuns();
}

function loadDarkMode() {
    const saved = localStorage.getItem("tequila-dark-mode");
    if (saved === "true") {
        state.darkMode = true;
        document.documentElement.classList.add("dark");
    }
}

// ═══════════════════ A Panel: Task List ═══════════════════════

async function loadRuns() {
    const { ok, data } = await apiListRuns();
    if (ok && data && data.runs) {
        state.runs = data.runs;
        state.activeRunId = state.activeRunId || data.active_run_id;
    } else {
        // Seed demo tasks if no API
        seedDemoTasks();
    }
    renderTaskList();
    if (state.activeRunId) {
        await selectRun(state.activeRunId);
    }
}

function seedDemoTasks() {
    const now = new Date();
    state.runs = [
        { run_id: "task-001", title: "韩国城店菜单重塑", stage: "execute_selection", status: "active", updated_at: timeStr(now) },
        { run_id: "task-002", title: "五一节大促防守选品", stage: "confirm_pool", status: "active", updated_at: timeStr(now) },
        { run_id: "task-003", title: "高新区外卖截流测试", stage: "select_merchant", status: "active", updated_at: timeStr(now) },
        { run_id: "task-004", title: "夏季时令美味上新计划", stage: "export_pool", status: "active", updated_at: timeStr(now) },
        { run_id: "task-007", title: "商圈竞品价格波动应对", stage: "execute_selection", status: "active", updated_at: timeStr(now) },
        { run_id: "task-005", title: "日常上新选品任务", stage: "complete", status: "completed", updated_at: timeStr(now, -2) },
        { run_id: "task-008", title: "门店 SKU 汰换二期", stage: "complete", status: "completed", updated_at: timeStr(now, -3) },
        { run_id: "task-009", title: "深夜场景供给缺口诊断", stage: "complete", status: "completed", updated_at: timeStr(now, -4) },
        { run_id: "task-010", title: "Q2 季度品类规划", stage: "complete", status: "completed", updated_at: timeStr(now, -8) },
        { run_id: "task-006", title: "节假日活动爆款分析", stage: "complete", status: "archived", updated_at: timeStr(now, -20) },
        { run_id: "task-011", title: "春节档期复盘分析", stage: "complete", status: "archived", updated_at: timeStr(now, -120) },
        { run_id: "task-012", title: "冬至暖心特辑选品", stage: "complete", status: "archived", updated_at: timeStr(now, -150) },
    ];
}

function timeStr(date, dayOffset) {
    const d = dayOffset ? new Date(date.getTime() + dayOffset * 86400000) : date;
    return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

function groupRunsByDate(runs) {
    const today = new Date();
    const todayStr = today.toDateString();
    const weekAgo = new Date(today.getTime() - 7 * 86400000);
    const monthAgo = new Date(today.getTime() - 30 * 86400000);

    const groups = {
        today: { label: "今天", items: [] },
        thisWeek: { label: "本周", items: [] },
        lastWeek: { label: "上周", items: [] },
        earlier: { label: "更早", items: [] },
        lastMonth: { label: "上月", items: [] },
        archived: { label: "已归档", items: [] },
    };

    for (const r of runs) {
        if (r.status === "archived") {
            groups.archived.items.push(r);
            continue;
        }
        const d = new Date(r.updated_at);
        if (d.toDateString() === todayStr) {
            groups.today.items.push(r);
        } else if (d >= weekAgo) {
            groups.thisWeek.items.push(r);
        } else if (d >= monthAgo) {
            groups.lastWeek.items.push(r);
        } else {
            groups.lastMonth.items.push(r);
        }
    }

    return Object.values(groups).filter(g => g.items.length > 0);
}

function renderTaskList() {
    const container = document.getElementById("task-list-scroll");
    if (!container) return;

    const groups = groupRunsByDate(state.runs);
    let html = "";

    for (const group of groups) {
        html += `<div class="task-date-group"><p class="group-label">${group.label}</p><div class="space-y-1">`;
        for (const r of group.items) {
            const isActive = r.run_id === state.activeRunId;
            const statusLabel = STATUS_LABELS[r.status] || r.status;
            const desc = STAGE_LABELS[r.stage] || r.stage;
            const selected = isActive ? " selected" : "";
            html += `
                <div class="task-item${selected}" data-task-status="${r.status}" onclick="selectRun('${r.run_id}')" data-run-id="${r.run_id}">
                    <div class="flex items-start justify-between gap-2">
                        <div class="flex-1 min-w-0">
                            <span class="truncate font-semibold text-slate-800 text-[11px]">${escHtml(r.title)}</span>
                            <span class="text-[9px] text-slate-300 font-normal ml-1">· ${r.updated_at || ""}</span>
                            <p class="text-[10px] text-slate-400 mt-0.5 truncate">${escHtml(desc)}</p>
                        </div>
                        ${isActive ? '<span class="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-indigo-500 mt-1 animate-pulse"></span>' : ""}
                    </div>
                    <div class="flex items-center justify-between mt-1 text-[9px]">
                        <span class="text-slate-400 font-mono cursor-pointer hover:text-slate-600" onclick="event.stopPropagation();copySID(this)" title="点击复制">${escHtml(r.run_id.substring(0, 5))}</span>
                        <span class="status-badge ${STATUS_CLASS[r.status] || "status-badge--active"}">${statusLabel}</span>
                        <button onclick="event.stopPropagation();deleteTask(this)" class="absolute top-1 right-1 hidden group-hover:block text-slate-300 hover:text-rose-500 text-xs leading-none task-delete-btn">&times;</button>
                    </div>
                </div>`;
        }
        html += "</div></div>";
    }

    container.innerHTML = html;

    // Show delete on hover
    container.querySelectorAll(".task-item").forEach(el => {
        el.addEventListener("mouseenter", () => {
            el.querySelector(".task-delete-btn")?.classList.remove("hidden");
        });
        el.addEventListener("mouseleave", () => {
            el.querySelector(".task-delete-btn")?.classList.add("hidden");
        });
    });

    document.getElementById("task-count").textContent = state.runs.length;
}

function createNewTask() {
    const title = prompt("输入任务标题:", "新建选品任务");
    if (!title) return;
    const now = new Date();
    const sid = "run_" + Math.random().toString(36).substring(2, 7);
    const newRun = {
        run_id: sid,
        title: title,
        stage: "select_merchant",
        status: "active",
        updated_at: timeStr(now),
    };
    state.runs.unshift(newRun);
    state.activeRunId = sid;
    state.currentRun = null;
    state.messages = [];
    state.fileTree = null;
    state.skills = [];
    state.canvasTabs = [];
    state.activeCanvasTabId = null;

    renderTaskList();
    updateActiveRunUI();
    switchSubTab("flow", document.querySelector(".subtab-btn"));

    // Try API
    apiCreateRun(title).then(({ ok, data }) => {
        if (ok && data) {
            newRun.run_id = data.run_id;
            state.activeRunId = data.run_id;
            renderTaskList();
            updateActiveRunUI();
        }
    });
}

async function selectRun(runId) {
    state.activeRunId = runId;
    state.currentRun = null;
    state.messages = [];
    state.fileTree = null;
    state.skills = [];
    state.canvasTabs = [];
    state.activeCanvasTabId = null;
    state.agentSessionId = null;

    renderTaskList();
    updateActiveRunUI();

    // Load run detail from API
    const { ok, data } = await apiGetRun(runId);
    if (ok && data) {
        state.currentRun = data;
        updateActiveRunUI();
    } else {
        // Fake current run from runs list
        const found = state.runs.find(r => r.run_id === runId);
        if (found) state.currentRun = found;
        updateActiveRunUI();
    }
}

function deleteTask(btn) {
    const el = btn.closest(".task-item");
    if (!el) return;
    const runId = el.getAttribute("data-run-id");
    state.runs = state.runs.filter(r => r.run_id !== runId);
    if (state.activeRunId === runId) {
        state.activeRunId = state.runs.length > 0 ? state.runs[0].run_id : null;
        selectRun(state.activeRunId);
    }
    renderTaskList();
}

function updateActiveRunUI() {
    const sidEl = document.getElementById("current-run-id");
    if (sidEl && state.activeRunId) {
        sidEl.textContent = "SID: " + state.activeRunId.substring(0, 8);
    } else if (sidEl) {
        sidEl.textContent = "SID: —";
    }
    updateStepperStage();
}

function copySID(el) {
    const sid = el.textContent.trim();
    navigator.clipboard.writeText(sid).then(() => {
        const orig = el.textContent;
        el.textContent = "已复制";
        setTimeout(() => { el.textContent = orig; }, 1000);
    });
}

// ═══════════════════ B Panel: Sub-tabs ═══════════════════════

function switchSubTab(tab, btn) {
    if (btn) {
        document.querySelectorAll(".subtab-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
    }
    state.currentSubTab = tab;

    document.getElementById("flow-view").style.display = tab === "flow" ? "" : "none";
    document.getElementById("chat-view").style.display = tab === "chat" ? "" : "none";
    document.getElementById("files-view").style.display = tab === "files" ? "" : "none";
    document.getElementById("skill-view").style.display = tab === "skill" ? "" : "none";
    document.getElementById("chat-input-area").style.display = tab === "chat" ? "" : "none";

    if (tab === "chat") document.getElementById("chat-view").classList.remove("hidden");
    if (tab === "files") document.getElementById("files-view").classList.remove("hidden");
    if (tab === "skill") document.getElementById("skill-view").classList.remove("hidden");
    if (tab === "flow") document.getElementById("flow-view").classList.remove("hidden");

    if (tab === "files") loadFileTree();
    if (tab === "skill") loadSkills();
    if (tab === "chat") loadMessages();
}

// ─── Flow / Stepper ─────────────────────────────────────────

function renderStepper() {
    const container = document.getElementById("stepper-container");
    if (!container) return;
    let html = "";
    STAGE_ORDER.forEach((stage, i) => {
        const num = i + 1;
        const label = STAGE_LABELS[stage];
        html += `
            <div class="relative stepper-step" style="margin-bottom: ${i < STAGE_ORDER.length - 1 ? "24px" : "0"};">
                <div class="stepper-step__bullet stepper-step__bullet--inactive" id="stepper-bullet-${i}">${num}</div>
                <div class="bg-white/60 border border-slate-200/40 rounded-xl p-3 text-xs">
                    <span class="font-semibold text-slate-600">${label}</span>
                    <p id="stepper-desc-${i}" class="text-slate-400 text-[11px] mt-1">—</p>
                    <div class="flex items-center gap-2 mt-2" id="stepper-status-${i}">
                        <span class="text-[9px] text-slate-400 font-medium bg-slate-100 px-1.5 py-0.5 rounded">待执行</span>
                    </div>
                </div>
            </div>`;
    });
    container.innerHTML = html;
}

function updateStepperStage() {
    if (!state.currentRun) return;
    const currentStage = state.currentRun.stage || "select_merchant";
    const descs = {
        select_merchant: "在商家列表中勾选本次选品的目标门店，支持多选批量操作。",
        execute_selection: "基于策略模型自动匹配应季品、高复购品和汰换品，生成候选品池。",
        confirm_pool: "审核候选品池，调整 SPU 数量与策略分组，确认后进入导出阶段。",
        export_pool: "将确认后的品池导出为 Excel 或直接同步至门店管理系统。",
        complete: "品池已导出并同步，任务归档后可随时查看历史选品记录。",
    };

    const currentIndex = STAGE_ORDER.indexOf(currentStage);
    if (currentIndex < 0) return;

    for (let i = 0; i < STAGE_ORDER.length; i++) {
        const bullet = document.getElementById("stepper-bullet-" + i);
        const desc = document.getElementById("stepper-desc-" + i);
        const status = document.getElementById("stepper-status-" + i);
        if (!bullet || !descs || !status) continue;

        if (i < currentIndex) {
            bullet.className = "stepper-step__bullet stepper-step__bullet--inactive";
            desc.textContent = descs[STAGE_ORDER[i]] || "";
            status.innerHTML = '<span class="text-[9px] text-emerald-500 font-medium bg-emerald-50 px-1.5 py-0.5 rounded">已完成</span>';
        } else if (i === currentIndex) {
            bullet.className = "stepper-step__bullet stepper-step__bullet--active";
            desc.textContent = descs[STAGE_ORDER[i]] || "";
            const label = state.currentRun.status === "active" ? "进行中" : STATUS_LABELS[state.currentRun.status];
            status.innerHTML = `<span class="text-[9px] text-indigo-500 font-medium bg-indigo-50 px-1.5 py-0.5 rounded">${label}</span>`;
        } else {
            bullet.className = "stepper-step__bullet stepper-step__bullet--inactive";
            desc.textContent = descs[STAGE_ORDER[i]] || "";
            status.innerHTML = '<span class="text-[9px] text-slate-400 font-medium bg-slate-100 px-1.5 py-0.5 rounded">待执行</span>';
        }
    }
}

// ─── Chat ────────────────────────────────────────────────────

function loadMessages() {
    const container = document.getElementById("chat-messages");
    if (!container) return;
    if (state.messages.length === 0) {
        container.innerHTML = "";
        return;
    }
    // Re-render from state.messages
    let html = "";
    for (let i = 0; i < state.messages.length; i++) {
        const msg = state.messages[i];
        if (msg.role === "user") {
            html += renderUserMessage(msg);
        } else {
            html += renderAgentMessage(msg);
        }
        // After each agent message, render its cards if any
        if (msg.role === "assistant" && msg.cards && msg.cards.length > 0) {
            for (const card of msg.cards) {
                html += renderStrategyCard(card);
            }
        }
    }
    container.innerHTML = html;
}

function startNewMessageDivider(sid) {
    const container = document.getElementById("chat-messages");
    if (!container) return;
    const divider = document.createElement("div");
    divider.className = "chat-divider";
    divider.innerHTML = `<span class="chat-divider__label">新对话 <span class="font-mono text-slate-300">SID: ${sid}</span></span>`;
    container.appendChild(divider);
}

function renderUserMessage(msg) {
    return `<div class="msg-user"><div class="msg-user__bubble">${escHtml(msg.content)}</div></div>`;
}

function renderAgentMessage(msg) {
    let html = "";

    // Thinking block
    if (msg.thinking && msg.thinking.length > 0) {
        const collapsed = msg.thinkingCollapsed !== false;
        html += `<div class="py-1 space-y-2 w-full">
            <button onclick="this.nextElementSibling.classList.toggle('expanded');this.querySelector('span:last-child').textContent = this.nextElementSibling.classList.contains('expanded') ? '▼' : '▶'" class="flex items-center space-x-1.5 text-xs text-slate-400 hover:text-slate-600 font-medium transition-colors">
                <span>思考中...已深度推演（点击折叠）</span>
                <span class="text-[9px] text-slate-300">${collapsed ? '▶' : '▼'}</span>
            </button>
            <div class="thought-container${collapsed ? '' : ' expanded'} text-[11px] text-slate-500 leading-relaxed space-y-1">`;
        for (const t of msg.thinking) {
            html += `<p>${escHtml(t)}</p>`;
        }
        html += `</div></div>`;
    }

    // Message text
    if (msg.content) {
        html += `<div class="msg-agent"><div class="msg-agent__text">${msg.content}</div></div>`;
    }

    if (msg.streaming) {
        html += '<span class="inline-block w-2 h-3 bg-slate-400 ml-1 animate-pulse align-middle" style="animation-duration: 0.8s;">&nbsp;</span>';
    }

    return html;
}

function appendTextDelta(delta) {
    const container = document.getElementById("chat-messages");
    if (!container) return;

    // Find or create the last agent message element
    let agentEl = container.querySelector(".msg-agent:last-child");
    if (!agentEl) {
        const wrapper = document.createElement("div");
        wrapper.className = "msg-agent";
        const textEl = document.createElement("div");
        textEl.className = "msg-agent__text";
        wrapper.appendChild(textEl);
        container.appendChild(wrapper);
        agentEl = wrapper;
    }

    let textEl = agentEl.querySelector(".msg-agent__text");
    if (!textEl) {
        textEl = document.createElement("div");
        textEl.className = "msg-agent__text";
        agentEl.appendChild(textEl);
    }

    // Remove old cursor
    const oldCursor = agentEl.querySelector(".animate-pulse");
    if (oldCursor) oldCursor.remove();

    textEl.innerHTML += escHtml(delta);

    // Add cursor
    const cursor = document.createElement("span");
    cursor.className = "inline-block w-2 h-3 bg-slate-400 ml-0.5 align-middle";
    cursor.style.cssText = "animation: pulse 0.8s infinite;";
    agentEl.appendChild(cursor);

    // Auto-scroll
    const chatView = document.getElementById("chat-view");
    if (chatView) chatView.scrollTop = chatView.scrollHeight;
}

function finalizeStreamMessage(metadata) {
    // Remove cursor
    const cursor = document.querySelector(".msg-agent .animate-pulse");
    if (cursor) cursor.remove();

    // Save to state
    const lastAgent = state.messages.find(m => m.role === "assistant" && m.streaming);
    if (lastAgent) {
        lastAgent.streaming = false;
        lastAgent.session_id = metadata?.session_id;
        if (metadata?.card_ids) lastAgent.card_ids = metadata.card_ids;
    }

    state.streaming = false;
    document.getElementById("btn-abort").style.display = "none";

    // Render any pending cards
    // (Cards come through strategy-card SSE events)
}

function sendMessage() {
    const input = document.getElementById("chat-input");
    const prompt = input.value.trim();
    if (!prompt || !state.activeRunId || state.streaming) return;

    input.value = "";
    state.streaming = true;
    document.getElementById("btn-abort").style.display = "";

    // Add user message
    const userMsg = {
        role: "user",
        content: prompt,
        ts: new Date().toISOString(),
        conversation_id: state.conversationId || "",
    };
    state.messages.push(userMsg);
    loadMessages();

    // Start divider
    if (state.conversationId) {
        startNewMessageDivider(state.activeRunId.substring(0, 5));
    }

    // Start agent streaming message
    const agentMsg = {
        role: "assistant",
        content: "",
        ts: new Date().toISOString(),
        streaming: true,
        thinking: [],
        thinkingCollapsed: false,
        cards: [],
        session_id: null,
        card_ids: [],
    };
    state.messages.push(agentMsg);

    // Call SSE
    const body = { prompt, conversation_id: state.conversationId || "" };
    if (state.currentRun?.skill_id) body.skill_name = state.currentRun.skill_id;

    state.abortController = runChatStream(state.activeRunId, body, {
        onStart: () => {
            // Re-render to clear stale state
            loadMessages();
        },
        onSession: (sessionId) => {
            state.agentSessionId = sessionId;
            if (!state.conversationId) {
                state.conversationId = "conv_" + Math.random().toString(36).substring(2, 7);
            }
        },
        onReasoningDelta: (id, delta) => {
            if (state.messages.length > 0) {
                const last = state.messages[state.messages.length - 1];
                if (last.role === "assistant" && last.thinking) {
                    last.thinking.push(delta);
                    loadMessages();
                }
            }
        },
        onTextDelta: (id, delta) => {
            appendTextDelta(delta);
            // Update state
            if (state.messages.length > 0) {
                const last = state.messages[state.messages.length - 1];
                if (last.role === "assistant") last.content += delta;
            }
        },
        onStrategyCard: (cardData) => {
            if (state.messages.length > 0) {
                const last = state.messages[state.messages.length - 1];
                if (last.role === "assistant" && last.cards) {
                    last.cards.push(cardData);
                }
            }
            appendStrategyCard(cardData);
        },
        onArtifactRef: (data) => {
            openArtifactFromRef(data);
        },
        onArtifactUpdated: (data) => {
            refreshArtifactTab(data.artifact_id);
        },
        onFinish: (metadata) => {
            finalizeStreamMessage(metadata);
            // Load new file tree + skills
            loadFileTree();
            loadSkills();
        },
        onError: (err) => {
            state.streaming = false;
            document.getElementById("btn-abort").style.display = "none";
            showToast(err, "error");
            if (state.messages.length > 0) {
                const last = state.messages[state.messages.length - 1];
                if (last.role === "assistant") last.streaming = false;
            }
        },
    });
}

function abortChat() {
    if (state.abortController) {
        state.abortController.abort();
        state.abortController = null;
    }
    state.streaming = false;
    document.getElementById("btn-abort").style.display = "none";
    if (state.messages.length > 0) {
        const last = state.messages[state.messages.length - 1];
        if (last.role === "assistant") last.streaming = false;
    }
    loadMessages();
}

function handleChatKeydown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
}

function createNewChat() {
    state.conversationId = "conv_" + Math.random().toString(36).substring(2, 7);
    state.agentSessionId = null;
    const container = document.getElementById("chat-messages");
    if (container) {
        const divider = document.createElement("div");
        divider.className = "chat-divider";
        divider.innerHTML = `<span class="chat-divider__label">新对话 <span class="font-mono text-slate-300">SID: ${state.activeRunId ? state.activeRunId.substring(0, 5) : "—"}</span></span>`;
        container.appendChild(divider);
        container.scrollTop = container.scrollHeight;
    }
}

// ─── Strategy Cards ──────────────────────────────────────────

function renderStrategyCard(card) {
    const priorityClass = card.priority === "high" ? "strategy-card__indicator--high" : "strategy-card__indicator--default";
    const badgeText = (card.sku_count ? `${card.sku_count > 0 ? "+" : ""}${card.sku_count} SKU` : card.action || "");
    const badgeClass = card.sku_count && card.sku_count > 0 ? "bg-slate-50 text-slate-700 border border-slate-100" : "bg-indigo-50 text-indigo-700 border border-indigo-100";
    const disabled = card.state && card.state !== "pending";

    return `
        <div id="card-${escAttr(card.id)}" class="strategy-card${disabled ? " strategy-card--disabled" : ""}">
            <div class="strategy-card__header">
                <div class="flex items-center gap-2">
                    <span class="strategy-card__indicator ${priorityClass}"></span>
                    <span class="strategy-card__title">${escHtml(card.name || "策略建议")}</span>
                </div>
                ${badgeText ? `<span class="strategy-card__badge ${badgeClass}">${escHtml(badgeText)}</span>` : ""}
            </div>
            <div class="strategy-card__body">${escHtml(card.description || card.logic || "")}</div>
            ${!disabled ? `
            <div class="strategy-card__actions">
                <button onclick="applyCard('${escAttr(card.id)}', 'accept')" class="btn btn--primary">采纳</button>
                <button onclick="applyCard('${escAttr(card.id)}', 'modify')" class="btn btn--secondary">修改</button>
                <button onclick="applyCard('${escAttr(card.id)}', 'reject')" class="btn btn--danger-ghost">拒绝</button>
            </div>` : `<div class="text-right text-[11px] font-bold text-slate-400 py-1 pr-2">${card.state === "accepted" ? "策略已采纳" : card.state === "rejected" ? "提案已拒绝" : ""}</div>`}
        </div>`;
}

function appendStrategyCard(card) {
    const container = document.getElementById("chat-messages");
    if (!container) return;
    const div = document.createElement("div");
    div.innerHTML = renderStrategyCard(card);
    container.appendChild(div.firstElementChild);
    container.scrollTop = container.scrollHeight;
}

async function applyCard(cardId, action) {
    if (!state.activeRunId) return;

    const { ok, data } = await apiPost(`/runs/${state.activeRunId}/cards/${cardId}/apply`, {
        action,
        reason: action === "accept" ? "符合策略方向" : action === "reject" ? "目前不需要" : "",
    });

    const cardEl = document.getElementById("card-" + cardId);
    if (cardEl) {
        if (action === "accept") {
            cardEl.className = "strategy-card strategy-card--disabled";
            const actions = cardEl.querySelector(".strategy-card__actions");
            if (actions) actions.innerHTML = '<div class="text-right text-[11px] font-bold text-slate-400 py-1 pr-2">策略已采纳</div>';
        } else if (action === "reject") {
            cardEl.className = "strategy-card strategy-card--disabled";
            const actions = cardEl.querySelector(".strategy-card__actions");
            if (actions) actions.innerHTML = '<div class="text-right text-[11px] font-bold text-slate-400 py-1 pr-2">提案已拒绝</div>';
        }
    }

    // Refresh affected canvas tabs
    if (ok && data && data.render_views_changed) {
        for (const id of data.render_views_changed) {
            refreshArtifactTab(id);
        }
    }

    showToast(action === "accept" ? "策略已采纳" : action === "reject" ? "提案已拒绝" : "策略已修改", "success");
}

// ─── File Upload ─────────────────────────────────────────────

function triggerFileUpload() {
    document.getElementById("file-upload-input").click();
}

async function handleFileUpload(event) {
    const files = event.target.files;
    if (!files.length || !state.activeRunId) return;

    for (const file of files) {
        const { ok, data } = await apiUploadInput(state.activeRunId, file);
        if (ok) {
            showToast(`已上传: ${file.name} (${data.rows || 0} 行)`, "success");
        } else {
            showToast(`上传失败: ${file.name}`, "error");
        }
    }
    event.target.value = "";
    loadFileTree();

    // Auto-advance stepper if we're on select_merchant
    if (state.currentRun && state.currentRun.stage === "select_merchant" && files.length > 0) {
        state.currentRun.stage = "execute_selection";
        updateStepperStage();
    }
}

// ─── File Tree ───────────────────────────────────────────────

async function loadFileTree() {
    if (!state.activeRunId) {
        document.getElementById("file-tree-container").innerHTML = "";
        return;
    }
    const { ok, data } = await apiGetFileTree(state.activeRunId);
    if (ok && data && data.sections) {
        state.fileTree = data;
        renderFileTree(data.sections);
    } else {
        renderFileTree(defaultFileTree());
    }
}

function defaultFileTree() {
    return [
        {
            section: "input",
            label: "输入文件",
            children: [
                { name: "原始流单明细", kind: "csv", nodes: [] },
                { name: "时令选品池", kind: "xlsx", nodes: [] },
                { name: "竞品价格监控表", kind: "xlsx", nodes: [] },
            ],
        },
        {
            section: "data",
            label: "工作数据",
            children: [
                { name: "清洗后销量表", kind: "csv", nodes: [] },
            ],
        },
        {
            section: "artifact",
            label: "工作产物",
            children: [
                { name: "策略画布", kind: "html", live: true },
                { name: "对话生成画布", kind: "html", live: true },
            ],
        },
    ];
}

function renderFileTree(sections) {
    const container = document.getElementById("file-tree-container");
    if (!container) return;

    let html = "";
    for (const sec of sections) {
        html += `<div class="file-tree-section-header" onclick="this.nextElementSibling.classList.toggle('hidden');this.querySelector('svg').style.transform=this.nextElementSibling.classList.contains('hidden')?'':'rotate(90deg)'">
            <span data-icon="chevronDown" style="width:12px;height:12px;display:inline-flex;transition: transform 0.15s;transform:rotate(90deg);"></span>
            <span>${escHtml(sec.label || sec.section)}</span>
        </div>`;
        html += '<div class="file-tree-children">';
        const children = sec.nodes || sec.children || [];
        for (const node of children) {
            const name = node.name || node;
            const kind = node.kind || "file";
            const dotClass = `file-tree-node__dot--${kind}`;
            const ext = (kind !== "file" && kind !== "skill") ? `.${kind}` : "";
            html += `<div class="file-tree-node" onclick="openFileInCanvas('${escAttr(kind)}', '${escAttr(name)}', ${node.live || false})">
                <span class="file-tree-node__dot ${dotClass}"></span>
                <span>${escHtml(name)}</span>
                <span class="text-[9px] text-slate-300">${escHtml(ext)}</span>
                ${node.live ? '<span class="live-badge">LIVE</span>' : ""}
            </div>`;
        }
        html += "</div>";
    }
    container.innerHTML = html;

    // Render icons after insertion
    document.querySelectorAll("[data-icon]").forEach(el => {
        if (window.svgIcons[el.getAttribute("data-icon")]) {
            el.innerHTML = window.svgIcons[el.getAttribute("data-icon")];
        }
    });
}

// ─── Skills ──────────────────────────────────────────────────

async function loadSkills() {
    if (!state.activeRunId) {
        document.getElementById("skill-list-container").innerHTML = "";
        return;
    }
    const { ok, data } = await apiGetSkills(state.activeRunId);
    if (ok && data && data.allowed_skills) {
        state.skills = data.allowed_skills;
    } else {
        state.skills = defaultSkills();
    }
    renderSkills();
}

function defaultSkills() {
    return [
        { skill_id: "analysis", name: "Skill: 高复购外卖截流", description: "拦截商圈高检索但本地供给缺口的餐饮品类进行极速档口出餐平替。", enabled: true, sync_status: "synced", sku_count: 22 },
        { skill_id: "diagnose", name: "Skill: 门店自动化诊断", description: "自动分析门店经营数据，提供SKU汰换与补充建议。", enabled: false, sync_status: "local_only", sku_count: -13 },
        { skill_id: "defense", name: "Skill: 商圈竞对防御", description: "分析5公里内竞对上新趋势，生成防御性跟进策略。", enabled: false, sync_status: "unknown", sku_count: 8 },
        { skill_id: "pricing", name: "Skill: 动态定价引擎", description: "根据商圈供需实时调整价格带，最大化利润同时保持竞争力。", enabled: true, sync_status: "synced", sku_count: 0 },
    ];
}

function renderSkills() {
    const container = document.getElementById("skill-list-container");
    if (!container) return;
    let html = "";
    for (const s of state.skills) {
        const on = s.enabled;
        html += `
            <div class="p-3 bg-white/80 border border-slate-200/60 rounded-xl text-xs space-y-1.5 shadow-sm">
                <div class="flex items-center justify-between">
                    <span class="font-semibold text-slate-800 truncate">${escHtml(s.name || s.skill_id)}</span>
                    <div class="toggle-switch ${on ? "toggle-switch--on" : "toggle-switch--off"}" onclick="toggleSkill('${escAttr(s.skill_id)}', ${!on})">
                        <div class="toggle-switch__knob"></div>
                    </div>
                </div>
                <p class="text-slate-500 text-[11px] leading-snug">${escHtml(s.description || "")}</p>
                ${s.sync_status !== "synced" ? `<p class="text-[9px] text-amber-500">同步状态: ${s.sync_status}</p>` : ""}
            </div>`;
    }
    html += `
        <div class="pt-2">
            <button onclick="syncSkillsToWorkspace()" class="btn btn--secondary w-full text-[10px]">
                <span data-icon="refresh" class="w-3 h-3"></span> 同步到后端
            </button>
        </div>`;
    container.innerHTML = html;
    document.querySelectorAll("[data-icon]").forEach(el => {
        if (window.svgIcons[el.getAttribute("data-icon")]) {
            el.innerHTML = window.svgIcons[el.getAttribute("data-icon")];
        }
    });
}

async function toggleSkill(skillId, enabled) {
    if (!state.activeRunId) return;
    await apiPatchSkill(state.activeRunId, skillId, enabled);
    const found = state.skills.find(s => s.skill_id === skillId);
    if (found) found.enabled = enabled;
    renderSkills();
}

async function syncSkillsToWorkspace() {
    const { ok, data } = await apiSyncSkills();
    if (ok) {
        showToast(`已同步: ${(data.synced || []).join(", ")}`, "success");
    } else {
        showToast("同步失败", "error");
    }
    loadSkills();
}

// ═══════════════════ C Panel: Canvas ═══════════════════════

function openFileInCanvas(kind, name, isLive) {
    const tabId = kind + "-" + (name || Date.now()).replace(/[^a-z0-9]/gi, "_");

    // Check if tab already exists
    if (!state.canvasTabs.find(t => t.id === tabId)) {
        state.canvasTabs.push({
            id: tabId,
            title: name || tabId,
            icon: kind === "xlsx" || kind === "csv" ? "xlsx" : kind === "md" || kind === "markdown" ? "markdown" : "dashboard",
            kind: kind,
            live: isLive,
            content: null,
        });
    }

    renderCanvasTabs();
    switchCanvasTab(tabId);
    document.getElementById("canvas-empty").classList.add("hidden");

    // If live, fetch artifact
    if (isLive && state.activeRunId) {
        loadLiveArtifact(tabId);
    }
}

function openArtifactFromRef(data) {
    const tabId = data.artifact_id || ("artifact-" + Date.now());
    if (!state.canvasTabs.find(t => t.id === tabId)) {
        state.canvasTabs.push({
            id: tabId,
            title: data.title || tabId,
            icon: data.renderer === "table" ? "xlsx" : "dashboard",
            kind: data.renderer || "html",
            live: data.kind === "live",
            content: null,
        });
    }
    renderCanvasTabs();
    switchCanvasTab(tabId);
    document.getElementById("canvas-empty").classList.add("hidden");
}

async function loadLiveArtifact(artifactId) {
    if (!state.activeRunId) return;
    const { ok, data } = await apiGetArtifact(state.activeRunId, artifactId);
    if (ok && data) {
        const tab = state.canvasTabs.find(t => t.id === artifactId);
        if (tab) tab._artifactData = data;
        renderCanvasContent(artifactId, data);
    }
}

async function refreshArtifactTab(artifactId) {
    const tab = state.canvasTabs.find(t => t.id === artifactId || t.live);
    if (tab) {
        await loadLiveArtifact(tab.id);
    }
}

function renderCanvasContent(tabId, artifactData) {
    const contents = document.getElementById("canvas-contents");
    if (!contents) return;

    const tab = state.canvasTabs.find(t => t.id === tabId);
    if (!tab) return;

    const contentId = "canvas-" + tabId;
    let contentEl = document.getElementById(contentId);

    if (!contentEl) {
        contentEl = document.createElement("div");
        contentEl.id = contentId;
        contentEl.className = "canvas-tab-content" + (state.activeCanvasTabId === tabId ? " active" : "");
        contentEl.style.flex = "1 1 0%";
        contentEl.style.overflowY = "auto";
        contents.appendChild(contentEl);
    }

    if (tab.kind === "xlsx" || tab.kind === "csv" || (artifactData && artifactData.manifest && artifactData.manifest.renderer === "table")) {
        renderTableContent(contentEl, artifactData);
    } else if (tab.kind === "md" || tab.kind === "markdown" || (artifactData && artifactData.manifest && artifactData.manifest.renderer === "markdown")) {
        renderMarkdownContent(contentEl, artifactData);
    } else {
        renderDashboardContent(contentEl, artifactData);
    }
}

function renderTableContent(el, artifactData) {
    // Build simple table from artifact sources or default
    const rows = artifactData?._rows || [
        ["SPU-10001", "招牌秘制泡菜五花肉丼饭", "招牌主食", "42", "18.2%", "¥38", "高销组"],
        ["SPU-10002", "韩式传统大酱汤套餐", "招牌主食", "35", "15.1%", "¥32", "高销组"],
        ["SPU-10003", "琥珀蜂蜜芥末全鸡", "人气炸鸡", "38", "19.5%", "¥68", "高销组"],
        ["SPU-10004", "冷榨贵州刺梨黄皮冰饮", "时令冷饮", "28", "22.1%", "¥18", "时令组"],
    ];
    const cols = artifactData?._columns || ["SPU ID", "商品名称", "分类", "日均销量", "转化率", "客单价", "策略组"];

    let html = '<div class="p-4"><div class="bg-white border border-slate-200/50 rounded-xl shadow-sm overflow-hidden"><table class="w-full text-left border-collapse text-[11px]"><thead><tr class="bg-slate-50/70 border-b border-slate-200/40 text-[10px] font-bold text-slate-400 uppercase tracking-wider">';
    for (const c of cols) html += `<th class="py-2.5 px-3">${escHtml(c)}</th>`;
    html += '</tr></thead><tbody class="divide-y divide-slate-100 text-slate-600 font-medium">';
    for (const row of rows) {
        html += '<tr class="hover:bg-slate-50/60">';
        for (const cell of row) {
            html += `<td class="py-2 px-3 font-mono text-slate-400">${escHtml(String(cell))}</td>`;
        }
        html += '</tr>';
    }
    html += `</tbody></table></div><p class="text-[9px] text-slate-400 mt-3 px-1">共 ${rows.length} 条记录</p></div>`;
    el.innerHTML = html;
}

function renderMarkdownContent(el, artifactData) {
    const content = artifactData?._content || "";
    let html = `<div class="p-5 max-w-lg mx-auto text-xs leading-relaxed text-slate-600 space-y-4">
        <h1 class="text-lg font-bold text-slate-800">${escHtml(state.currentRun?.title || "分析报告")}</h1>
        <p class="text-slate-400 text-[11px]">生成日期: ${new Date().toISOString().slice(0, 10)} · 分析师: BA Agent Engine</p>
        <hr class="border-slate-200">`;
    if (content) {
        html += `<div>${content}</div>`;
    } else {
        html += `<p class="text-slate-400">暂无内容，等待 Agent 生成报告...</p>`;
    }
    html += "</div>";
    el.innerHTML = html;
}

function renderDashboardContent(el, artifactData) {
    el.innerHTML = `
        <div class="p-4 space-y-4">
            <div class="bg-white border border-slate-200/60 rounded-xl p-4 text-center">
                <span class="text-[10px] font-bold text-slate-400 uppercase block">日均订单</span>
                <span class="text-2xl font-black text-slate-800 block mt-1">428</span>
                <span class="text-[10px] text-slate-400">单</span>
            </div>
            <div class="bg-white border border-slate-200/60 rounded-xl p-4 text-center">
                <span class="text-[10px] font-bold text-slate-400 uppercase block">进店转化率</span>
                <span class="text-2xl font-black text-slate-800 block mt-1">14.4%</span>
                <span class="text-[9px] text-emerald-500 flex items-center justify-center gap-0.5 mt-0.5">▲ 2.1% <span class="text-slate-400">vs 上月</span></span>
            </div>
            <p class="text-[9px] text-slate-400 text-center">等待 Agent 生成动态数据...</p>
        </div>`;
}

function switchCanvasTab(tabId) {
    state.activeCanvasTabId = tabId;

    // Update tab buttons
    document.querySelectorAll(".canvas-tab-btn").forEach(b => b.classList.remove("active"));
    const btn = document.querySelector(`.canvas-tab-btn[data-canvas-tab="${tabId}"]`);
    if (btn) btn.classList.add("active");

    // Update content visibility
    document.querySelectorAll(".canvas-tab-content").forEach(c => c.classList.remove("active"));
    const contentEl = document.getElementById("canvas-" + tabId);
    if (contentEl) {
        contentEl.classList.add("active");
        contentEl.style.display = "";
    }
}

function renderCanvasTabs() {
    const row = document.getElementById("canvas-tabs-row");
    if (!row) return;

    let html = "";
    for (const tab of state.canvasTabs) {
        const isActive = tab.id === state.activeCanvasTabId;
        html += `
            <button onclick="switchCanvasTab('${escAttr(tab.id)}')" data-canvas-tab="${escAttr(tab.id)}" class="canvas-tab-btn${isActive ? " active" : ""}">
                <span data-icon="${tab.icon}" class="w-3 h-3"></span>${escHtml(tab.title)}
                <span class="tab-close" onclick="event.stopPropagation();closeCanvasTab('${escAttr(tab.id)}', this)">&times;</span>
            </button>`;
    }
    row.innerHTML = html;

    // Render icons
    document.querySelectorAll("[data-icon]").forEach(el => {
        if (window.svgIcons[el.getAttribute("data-icon")]) {
            el.innerHTML = window.svgIcons[el.getAttribute("data-icon")];
        }
    });

    // Render initial content for each tab
    const contents = document.getElementById("canvas-contents");
    if (contents) {
        for (const tab of state.canvasTabs) {
            const contentId = "canvas-" + tab.id;
            if (!document.getElementById(contentId)) {
                const el = document.createElement("div");
                el.id = contentId;
                el.className = "canvas-tab-content" + (tab.id === state.activeCanvasTabId ? " active" : "");
                el.style.flex = "1 1 0%";
                el.style.overflowY = "auto";
                contents.appendChild(el);
                renderCanvasContent(tab.id, null);
            }
        }
    }
}

function closeCanvasTab(tabId, closeBtn) {
    const btn = closeBtn ? closeBtn.closest(".canvas-tab-btn") : document.querySelector(`.canvas-tab-btn[data-canvas-tab="${tabId}"]`);
    const wasActive = state.activeCanvasTabId === tabId;

    if (btn) {
        btn.classList.add("hidden");
        btn.style.display = "none";
    }

    // Remove content
    const contentEl = document.getElementById("canvas-" + tabId);
    if (contentEl) contentEl.remove();

    // Remove from state
    state.canvasTabs = state.canvasTabs.filter(t => t.id !== tabId);

    if (wasActive) {
        if (state.canvasTabs.length > 0) {
            switchCanvasTab(state.canvasTabs[state.canvasTabs.length - 1].id);
        } else {
            state.activeCanvasTabId = null;
            document.getElementById("canvas-empty").classList.remove("hidden");
        }
    }
}

function toggleCanvas() {
    state.canvasCollapsed = !state.canvasCollapsed;
    const canvas = document.getElementById("panel-canvas");
    const resizer2 = document.getElementById("resizer-2");
    const icon = document.querySelector(".toggle-canvas-icon");
    const label = document.getElementById("toggle-canvas-label");

    if (!canvas) return;

    if (state.canvasCollapsed) {
        canvas._savedWidth = parseInt(canvas.style.width) || canvas.offsetWidth;
        canvas.style.width = "36px";
        canvas.style.minWidth = "36px";
        if (resizer2) resizer2.style.display = "none";
        if (icon) icon.style.transform = "rotate(180deg)";
        if (label) label.textContent = "";
    } else {
        canvas.style.width = (canvas._savedWidth || 560) + "px";
        canvas.style.minWidth = "400px";
        if (resizer2) resizer2.style.display = "";
        if (icon) icon.style.transform = "";
        if (label) label.textContent = "收起";
    }
}

// ═══════════════════ Dark Mode ═══════════════════════

function toggleDarkMode() {
    state.darkMode = !state.darkMode;
    if (state.darkMode) {
        document.documentElement.classList.add("dark");
    } else {
        document.documentElement.classList.remove("dark");
    }
    localStorage.setItem("tequila-dark-mode", state.darkMode ? "true" : "false");
}

// ═══════════════════ Resizers ═══════════════════════

function initResizers() {
    const taskbar = document.getElementById("panel-taskbar");
    const canvas = document.getElementById("panel-canvas");

    const resizer1 = document.getElementById("resizer-1");
    if (resizer1 && taskbar) {
        resizer1.addEventListener("mousedown", (e) => {
            e.preventDefault();
            resizer1.classList.add("dragging");
            const startW = taskbar.offsetWidth;
            const startX = e.clientX;
            function onMove(ev) {
                let w = startW + (ev.clientX - startX);
                if (w < 200) w = 200;
                if (w > 400) w = 400;
                taskbar.style.width = w + "px";
            }
            function onUp() {
                resizer1.classList.remove("dragging");
                document.removeEventListener("mousemove", onMove);
                document.removeEventListener("mouseup", onUp);
            }
            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", onUp);
        });
    }

    const resizer2 = document.getElementById("resizer-2");
    if (resizer2 && canvas) {
        resizer2.addEventListener("mousedown", (e) => {
            e.preventDefault();
            resizer2.classList.add("dragging");
            const startW = canvas.offsetWidth;
            const startX = e.clientX;
            function onMove(ev) {
                let w = startW - (ev.clientX - startX);
                if (w < 360) w = 360;
                if (w > 900) w = 900;
                canvas.style.width = w + "px";
            }
            function onUp() {
                resizer2.classList.remove("dragging");
                document.removeEventListener("mousemove", onMove);
                document.removeEventListener("mouseup", onUp);
            }
            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", onUp);
        });
    }
}

// ═══════════════════ Toast ═══════════════════════

let _toastTimer = null;

function showToast(message, type) {
    const container = document.getElementById("toast-container");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = `toast toast--${type || "info"}`;
    toast.textContent = message;
    container.appendChild(toast);

    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => {
        toast.remove();
        _toastTimer = null;
    }, 3000);
}

// ═══════════════════ Utilities ═══════════════════════

function escHtml(str) {
    if (!str) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function escAttr(str) {
    if (!str) return "";
    return String(str).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// ═══════════════════ Boot ═══════════════════

document.addEventListener("DOMContentLoaded", init);

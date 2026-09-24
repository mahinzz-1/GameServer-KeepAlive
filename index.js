const express = require("express");
const PORT = process.env.PORT || 8091;
const HOST = "0.0.0.0";

const CLOUD_BASE = process.env.OPENHANDS_HOST || "https://app.all-hands.dev";
const API_KEY = process.env.OPENHANDS_API_KEY;
const CONVERSATION_ID = process.env.OPENHANDS_CONVERSATION_ID;
const INTERVAL_MINUTES = Number(process.env.INTERVAL_MINUTES || 20);
const MESSAGE_TEXT = process.env.MESSAGE_TEXT || "ReStart server";
const SESSION_API_KEY_FALLBACK = process.env.SESSION_API_KEY || "";

const state = { startedAt: new Date().toISOString(), ticks: 0, ok: 0, failed: 0,
  lastResult: null, lastError: null, lastRunAt: null, nextRunAt: null };

async function resolveTarget() {
  const url = `${CLOUD_BASE}/api/v1/app-conversations?ids=${encodeURIComponent(CONVERSATION_ID)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${API_KEY}` } });
  if (!res.ok) throw new Error(`resolve failed: HTTP ${res.status}`);
  const body = await res.json();
  const items = Array.isArray(body) ? body : body.items || [];
  if (!items.length) throw new Error(`conversation ${CONVERSATION_ID} not found`);
  const conv = items[0];
  return {
    conversationUrl: conv.conversation_url.replace(/\/$/, ""),
    sessionApiKey: conv.session_api_key || SESSION_API_KEY_FALLBACK,
    sandboxStatus: conv.sandbox_status,
    executionStatus: conv.execution_status,
  };
}

async function ping() {
  state.ticks += 1;
  state.lastRunAt = new Date().toISOString();
  const started = Date.now();
  try {
    const target = await resolveTarget();
    const res = await fetch(`${target.conversationUrl}/events`, {
      method: "POST",
      headers: { "X-Session-API-Key": target.sessionApiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ role: "user", content: [{ type: "text", text: MESSAGE_TEXT }], run: false }),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    state.ok += 1;
    state.lastResult = { at: new Date().toISOString(), ms: Date.now() - started, ...target };
  } catch (err) {
    state.failed += 1;
    state.lastError = { at: new Date().toISOString(), message: String(err.message || err) };
    console.error(`[ping] FAILED: ${err.message || err}`);
  }
  state.nextRunAt = new Date(Date.now() + INTERVAL_MINUTES * 60_000).toISOString();
}

const app = express();
app.use(express.json());
app.get("/", (_req, res) => res.json({ service: "gameserver-keepalive", ...state }));
app.get("/health", (_req, res) => res.json({ status: "ok", ...state }));
app.post("/ping", async (_req, res) => { await ping(); res.json(state); });

app.listen(PORT, HOST, () => {
  console.log(`keepalive on ${HOST}:${PORT} | conv=${CONVERSATION_ID} interval=${INTERVAL_MINUTES}min`);
  ping();
  setInterval(ping, INTERVAL_MINUTES * 60_000);
});

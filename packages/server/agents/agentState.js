/**
 * Agent State — Persistent counter/state management for all newsroom agents.
 * Saves daily counts, topic indices, and last-run timestamps to disk.
 * Survives server restarts — the core fix for the "156 stories" bug.
 */
const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '..', 'content', 'agent-state.json');

/**
 * Load state from disk. Returns empty object if file missing/corrupt.
 */
function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    }
  } catch (_) {
    console.warn('[agent-state] State file corrupt, starting fresh');
  }
  return {};
}

/**
 * Save state to disk.
 */
function saveState(state) {
  try {
    const dir = path.dirname(STATE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
  } catch (e) {
    console.error('[agent-state] Failed to save:', e.message);
  }
}

/**
 * Get an agent's persisted state. Auto-resets counters on new day.
 */
function getAgentState(agentName) {
  const state = loadState();
  const today = new Date().toISOString().split('T')[0];
  const defaults = { dailyCount: 0, lastResetDate: today, lastRunAt: null, topicIndex: 0 };
  const agent = state[agentName] || { ...defaults };

  // Reset daily count on new day (preserve topicIndex)
  if (agent.lastResetDate !== today) {
    agent.dailyCount = 0;
    agent.lastResetDate = today;
    state[agentName] = agent;
    saveState(state);
    console.log(`[agent-state] ${agentName} daily count reset for ${today}`);
  }

  return agent;
}

/**
 * Increment an agent's daily count and record lastRunAt. Returns new count.
 */
function incrementDailyCount(agentName) {
  const state = loadState();
  const today = new Date().toISOString().split('T')[0];

  if (!state[agentName]) {
    state[agentName] = { dailyCount: 0, lastResetDate: today, lastRunAt: null, topicIndex: 0 };
  }
  if (state[agentName].lastResetDate !== today) {
    state[agentName].dailyCount = 0;
    state[agentName].lastResetDate = today;
  }

  state[agentName].dailyCount++;
  state[agentName].lastRunAt = new Date().toISOString();
  saveState(state);

  return state[agentName].dailyCount;
}

/**
 * Record that an agent just ran (without incrementing count).
 */
function recordRun(agentName) {
  const state = loadState();
  const today = new Date().toISOString().split('T')[0];

  if (!state[agentName]) {
    state[agentName] = { dailyCount: 0, lastResetDate: today, lastRunAt: null, topicIndex: 0 };
  }
  state[agentName].lastRunAt = new Date().toISOString();
  saveState(state);
}

/**
 * Get/set topic index for agents that rotate through a queue.
 */
function getTopicIndex(agentName) {
  const agent = getAgentState(agentName);
  return agent.topicIndex || 0;
}

function setTopicIndex(agentName, index) {
  const state = loadState();
  const today = new Date().toISOString().split('T')[0];

  if (!state[agentName]) {
    state[agentName] = { dailyCount: 0, lastResetDate: today, lastRunAt: null, topicIndex: 0 };
  }
  state[agentName].topicIndex = index;
  saveState(state);
}

/**
 * Check if enough time has passed since the agent last ran.
 * Used to prevent restart-spam: if the agent ran recently, skip startup cycle.
 * @param {string} agentName
 * @param {number} minIntervalMs - minimum time between runs in ms
 * @returns {boolean} true if enough time has passed (or never ran)
 */
function canRunAgain(agentName, minIntervalMs = 30 * 60 * 1000) {
  const agent = getAgentState(agentName);
  if (!agent.lastRunAt) return true;

  const msSinceLast = Date.now() - new Date(agent.lastRunAt).getTime();
  if (msSinceLast < minIntervalMs) {
    console.log(`[agent-state] ${agentName} ran ${(msSinceLast / 60000).toFixed(0)}min ago, need ${(minIntervalMs / 60000).toFixed(0)}min gap`);
    return false;
  }
  return true;
}

/**
 * Get all agent states (for debugging/stats).
 */
function getAllStates() {
  return loadState();
}

module.exports = {
  getAgentState,
  incrementDailyCount,
  recordRun,
  getTopicIndex,
  setTopicIndex,
  canRunAgain,
  getAllStates,
};

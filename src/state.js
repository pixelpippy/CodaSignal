// src/state.js
const EVENT_TO_STATE = {
  permission_prompt: 'red',
  PreToolUse: 'yellow',
  PostToolUse: 'yellow',
  Stop: 'green',
  SessionStart: 'idle',
  SessionEnd: 'idle',
};

const STATE_LABELS = {
  idle: '空闲',
  red: '等待审批',
  yellow: '执行中',
  green: '已完成',
};

function stateForEvent(event) {
  return Object.prototype.hasOwnProperty.call(EVENT_TO_STATE, event) ? EVENT_TO_STATE[event] : null;
}

class AppState {
  constructor() {
    this.state = 'idle';
    this.cwd = undefined;
    this.sessionId = undefined;
    this.startTs = undefined;
    this.endTs = undefined;
    this.lastUpdate = Date.now();
  }
  applyEvent(event, extra = {}) {
    const s = stateForEvent(event);
    if (s) this.state = s;
    if (event === 'SessionStart') {
      this.startTs = Date.now();
      if (extra.cwd) this.cwd = extra.cwd;
      if (extra.sessionId) this.sessionId = extra.sessionId;
    }
    if (event === 'SessionEnd' || event === 'Stop') {
      this.endTs = Date.now();
    }
    this.lastUpdate = Date.now();
    return this;
  }
  snapshot(projectName) {
    return {
      state: this.state,
      label: STATE_LABELS[this.state] || this.state,
      cwd: this.cwd,
      project: projectName || (this.cwd ? projectNameFromCwd(this.cwd) : ''),
      startTs: this.startTs,
      endTs: this.endTs,
    };
  }
}

function projectNameFromCwd(cwd) {
  const parts = String(cwd).replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts[parts.length - 1] || '';
}

module.exports = { EVENT_TO_STATE, STATE_LABELS, stateForEvent, AppState, projectNameFromCwd };

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
    this.transcriptPath = undefined;
    this.startTs = undefined;
    this.endTs = undefined;
    this.lastUpdate = Date.now();
  }
  applyEvent(event, extra = {}) {
    if (event === 'Stop') {
      // 仅当正在“执行中/等待审批”时，Stop 才表示本回合结束（变绿=已完成）。
      // 若当前是空闲/已完成，说明这是会话开始时的占位 Stop（见日志：Stop 在
      // SessionStart 之前发出），忽略之，否则会在一上来先闪一下绿灯。
      if (this.state === 'yellow' || this.state === 'red') {
        this.state = 'green';
      }
    } else {
      const s = stateForEvent(event);
      if (s) this.state = s;
    }
    if (event === 'SessionStart') {
      this.startTs = Date.now();
      if (extra.cwd) this.cwd = extra.cwd;
      if (extra.sessionId || extra.session_id) this.sessionId = extra.sessionId || extra.session_id;
      // CodeBuddy 在 hook 的 stdin(JSON) 里直接给出本次会话 transcript 的精确路径，
      // 用它读统计最可靠，可避开“cwd 经过 slug 编码后大小写/斜杠不一致”导致找不到目录的问题。
      if (extra.transcript_path) this.transcriptPath = extra.transcript_path;
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

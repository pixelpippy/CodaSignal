// src/state.js
const EVENT_TO_STATE = {
  permission_prompt: 'red',
  UserPromptSubmit: 'yellow',
  PreToolUse: 'yellow',
  PostToolUse: 'yellow',
  Stop: 'green',
  SessionStart: 'idle',
  SessionEnd: 'idle',
};
const STATE_LABELS = {
  idle: '空闲', red: '等待审批', yellow: '思考中', green: '已完成',
};
function stateForEvent(event) {
  return Object.prototype.hasOwnProperty.call(EVENT_TO_STATE, event) ? EVENT_TO_STATE[event] : null;
}
function projectNameFromCwd(cwd) {
  const parts = String(cwd).replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts[parts.length - 1] || '';
}

const PRIORITY = { red: 3, yellow: 2, green: 1, idle: 0 };

class SessionState {
  constructor(sessionId) {
    this.sessionId = sessionId;
    this.state = 'idle';
    this.phase = null;
    this.cwd = undefined;
    this.transcriptPath = undefined;
    this.startTs = undefined;
    this.endTs = undefined;
    this.lastUpdate = Date.now();
  }
  applyEvent(event, extra = {}) {
    if (event === 'Stop') {
      // 仅当正在“执行中/等待审批”时，Stop 才表示本回合结束（变绿=已完成）。
      // 若当前是空闲/已完成，说明这是会话开始时的占位 Stop，忽略之，
      // 否则会在一上来先闪一下绿灯。
      if (this.state === 'yellow' || this.state === 'red') {
        this.state = 'green';
        this.phase = null;
      }
    } else {
      const s = stateForEvent(event);
      if (s) {
        this.state = s;
        // 黄灯区分“思考中”与“执行中”：UserPromptSubmit 是刚发消息、模型开始思考；
        // PreToolUse/PostToolUse 是模型真正在调用工具。其它状态不保留 phase。
        if (s === 'yellow') {
          this.phase = event === 'UserPromptSubmit' ? 'thinking' : 'executing';
        } else {
          this.phase = null;
        }
      }
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
  snapshot() {
    // 黄灯文字随阶段切换：思考中（刚发消息、模型推理） / 执行中（正在调用工具）
    const label = this.state === 'yellow' && this.phase === 'executing'
      ? '执行中'
      : (STATE_LABELS[this.state] || this.state);
    return {
      state: this.state,
      label,
      cwd: this.cwd,
      project: this.cwd ? projectNameFromCwd(this.cwd) : '',
      startTs: this.startTs,
      endTs: this.endTs,
    };
  }
}

class StateManager {
  constructor() {
    this.sessions = new Map(); // sessionId -> SessionState
  }
  _sid(data = {}) {
    if (data.session_id || data.sessionId) return data.session_id || data.sessionId;
    if (data.cwd) return 'cwd:' + data.cwd;
    // 兜底：事件既没带 session_id 也没带 cwd（例如 hook 配成了字面量 JSON）。
    // 归到「最近更新的活跃会话」，避免凭空造出一个 'default' 幽灵会话，
    // 让真会话永远收不到 Stop/SessionEnd（灯不变绿、不回空闲、统计不落盘）。
    const active = this.activeSessions();
    if (active.length) {
      active.sort((a, b) => (b.lastUpdate || 0) - (a.lastUpdate || 0));
      return active[0].sessionId;
    }
    return 'default';
  }
  getSession(sid) { return this.sessions.get(sid); }
  activeSessions() {
    return Array.from(this.sessions.values()).filter((s) => s.state !== 'ended');
  }
  applyEvent(event, data = {}) {
    const sid = this._sid(data);
    let s = this.sessions.get(sid);
    if (!s) { s = new SessionState(sid); this.sessions.set(sid, s); }
    if (event === 'SessionEnd') {
      s.state = 'ended';
      s.endTs = Date.now();
      s.lastUpdate = Date.now();
      return sid;
    }
    s.applyEvent(event, data);
    return sid;
  }
  aggregateState() {
    let best = 'idle';
    for (const s of this.activeSessions()) {
      if (PRIORITY[s.state] > PRIORITY[best]) best = s.state;
    }
    return best;
  }
  mostUrgent() {
    const list = this.activeSessions();
    if (!list.length) return null;
    list.sort((a, b) => {
      const pa = PRIORITY[a.state], pb = PRIORITY[b.state];
      if (pb !== pa) return pb - pa;
      return (b.lastUpdate || 0) - (a.lastUpdate || 0);
    });
    return list[0];
  }
  snapshot() {
    const agg = this.aggregateState();
    const urgent = this.mostUrgent();
    const label = agg === 'yellow'
      ? (urgent && urgent.phase === 'executing' ? '执行中' : '思考中')
      : (STATE_LABELS[agg] || agg);
    return {
      state: agg,
      label,
      count: this.activeSessions().length,
      project: urgent ? urgent.snapshot().project : '',
      cwd: urgent ? urgent.cwd : undefined,
      sessions: this.activeSessions().map((s) => s.snapshot()),
    };
  }
}

module.exports = {
  EVENT_TO_STATE, STATE_LABELS, stateForEvent, projectNameFromCwd,
  SessionState, StateManager, PRIORITY,
};

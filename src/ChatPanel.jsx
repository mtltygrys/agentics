import React, { useEffect, useRef } from 'react';

export default function ChatPanel({
  busy,
  messages,
  draft,
  setDraft,
  onSend,
}) {
  const scrollRef = useRef(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  return (
    <div style={styles.wrap}>
      <div style={styles.head}>
        <div style={styles.title}>Chat</div>
        <div style={styles.meta}>{busy ? 'Working…' : 'Ready'}</div>
      </div>

      <div ref={scrollRef} style={styles.chat}>
        {messages.filter(m => m.role !== 'system').map((m, i) => (
          <div key={i} style={m.role === 'user' ? styles.userBubble : styles.assistantBubble}>
            <div style={styles.bubbleRole}>{m.role}</div>
            <div style={styles.bubbleText}>{typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "", null, 2)}</div>
          </div>
        ))}
      </div>

      <div style={styles.inputRow}>
        <textarea
          style={styles.textarea}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder="Tell the Orchestrator what to build…"
        />
        <div style={styles.btnCol}>
          <button style={styles.buttonAlt} onClick={onSend} disabled={busy || !draft.trim()}>Send</button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  wrap: { display: 'flex', flexDirection: 'column', height: '100%' },
  head: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 12px',
    borderBottom: '1px solid rgba(233,238,252,.10)',
    background: 'rgba(0,0,0,.12)'
  },
  title: { fontWeight: 800 },
  meta: { fontSize: 12, opacity: .75 },
  chat: { flex: 1, minHeight: 0, overflow: 'auto', padding: 12 },
  userBubble: {
    marginBottom: 10,
    padding: '10px 12px',
    borderRadius: 14,
    background: 'linear-gradient(135deg, rgba(90,140,255,.22), rgba(186,85,255,.14))',
    border: '1px solid rgba(233,238,252,.12)'
  },
  assistantBubble: {
    marginBottom: 10,
    padding: '10px 12px',
    borderRadius: 14,
    background: 'rgba(255,255,255,.05)',
    border: '1px solid rgba(233,238,252,.10)'
  },
  bubbleRole: { fontSize: 11, opacity: .75, marginBottom: 6, textTransform: 'uppercase' },
  bubbleText: { whiteSpace: 'pre-wrap', lineHeight: 1.35 },
  inputRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 140px',
    gap: 10,
    padding: 12,
    borderTop: '1px solid rgba(233,238,252,.10)',
    background: 'rgba(0,0,0,.10)'
  },
  textarea: {
    resize: 'none',
    height: 86,
    background: 'rgba(0,0,0,.22)',
    border: '1px solid rgba(233,238,252,.12)',
    color: '#e9eefc',
    padding: 12,
    borderRadius: 14,
    outline: 'none',
    fontFamily: 'inherit'
  },
  btnCol: { display: 'flex', flexDirection: 'column', gap: 10 },
  button: {
    padding: '10px 12px',
    borderRadius: 14,
    border: '1px solid rgba(233,238,252,.16)',
    background: 'rgba(255,255,255,.06)',
    color: '#e9eefc',
    cursor: 'pointer',
    fontWeight: 800
  },
  buttonAlt: {
    padding: '10px 12px',
    borderRadius: 14,
    border: '1px solid rgba(233,238,252,.16)',
    background: 'linear-gradient(135deg, rgba(90,140,255,.28), rgba(186,85,255,.18))',
    color: '#e9eefc',
    cursor: 'pointer',
    fontWeight: 800
  },
};

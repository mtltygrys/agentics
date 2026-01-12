import React, { useMemo, useState } from 'react';
import { chatCompletion } from '../api';

export default function ChatPanel({ models }) {
  const defaultModel = useMemo(() => {
    // prefer large/reasoning if present, otherwise first
    const list = (models || []).map(m => m.id).filter(Boolean);
    return list.find(x => /large|reason/i.test(x)) || list[0] || '';
  }, [models]);

  const [model, setModel] = useState(defaultModel);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([
    { role: 'assistant', content: 'Say what you want to build. I will keep context and patch, not reset.' }
  ]);
  const [busy, setBusy] = useState(false);

  async function send() {
    const text = input.trim();
    if (!text || !model || busy) return;

    const next = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setInput('');
    setBusy(true);
    try {
      const resp = await chatCompletion({ model, messages: next });
      const msg = (resp.choices?.[0]?.message) || { role: 'assistant', content: JSON.stringify(resp) };
      setMessages(prev => [...prev, msg]);
    } catch (e) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${e?.message || e}` }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontWeight: 800 }}>Chat</div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ opacity: .75, fontSize: 12 }}>Model</div>
          <select value={model} onChange={(e) => setModel(e.target.value)} style={{ padding: '8px 10px', borderRadius: 10 }}>
            {(models || []).map(m => (
              <option key={m.id} value={m.id}>{m.id}</option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 14, padding: 12, background: 'rgba(255,255,255,0.04)' }}>
        {messages.map((m, idx) => (
          <div key={idx} style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 12, opacity: .75, marginBottom: 4 }}>{m.role.toUpperCase()}</div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
          placeholder="Tell the Orchestrator what to do…"
          style={{ flex: 1, padding: '12px 12px', borderRadius: 14, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(0,0,0,0.25)', color: 'white' }}
        />
        <button onClick={send} disabled={busy || !model} style={{ padding: '12px 14px', borderRadius: 14, fontWeight: 800 }}>
          {busy ? '…' : 'Send'}
        </button>
      </div>
    </div>
  );
}

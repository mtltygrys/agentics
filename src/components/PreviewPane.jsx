import React from 'react';

const BACKEND = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8000';

export default function PreviewPane() {
  const src = `${BACKEND}/preview/`;
  return (
    <div style={{ height: '100%', borderRadius: 14, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.12)' }}>
      <iframe title="preview" src={src} style={{ width: '100%', height: '100%', border: 0 }} />
    </div>
  );
}

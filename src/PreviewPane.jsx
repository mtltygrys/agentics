import React, { useEffect, useState } from 'react';

export default function PreviewPane({ src }) {
  const [key, setKey] = useState(0);

  // Lightweight auto-refresh: bump iframe key when src changes.
  useEffect(() => {
    setKey(k => k + 1);
  }, [src]);

  return (
    <iframe
      key={key}
      title="preview"
      src={src}
      style={{ width: '100%', height: '100%', border: 0, background: '#070b14' }}
    />
  );
}

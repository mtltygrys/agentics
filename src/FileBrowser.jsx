import React from 'react';

export default function FileBrowser({
  files,
  selectedFile,
  content,
  error,
  onSelectFile,
  onRefresh,
}) {
  return (
    <div style={styles.wrap}>
      <div style={styles.left}>
        <div style={styles.leftHead}>
          <div style={styles.title}>Workspace Files</div>
          <button style={styles.btn} onClick={onRefresh}>Refresh</button>
        </div>

        <div style={styles.list}>
          {files?.length ? files.map((f) => (
            <button
              key={f}
              onClick={() => onSelectFile(f)}
              style={{
                ...styles.item,
                ...(selectedFile === f ? styles.itemActive : {})
              }}
              title={f}
            >{f}</button>
          )) : (
            <div style={styles.muted}>No files yet.</div>
          )}
        </div>
      </div>

      <div style={styles.right}>
        <div style={styles.rightHead}>
          <div style={styles.title}>{selectedFile || 'Select a file'}</div>
        </div>
        <div style={styles.viewer}>
          {error ? (
            <div style={styles.error}>{error}</div>
          ) : (
            <pre style={styles.pre}>{content || (selectedFile ? '(empty)' : 'Pick a file from the list.')}</pre>
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
  wrap: { display: 'grid', gridTemplateColumns: '320px 1fr', height: '100%', minHeight: 0 },
  left: { borderRight: '1px solid rgba(233,238,252,.10)', minHeight: 0, display: 'flex', flexDirection: 'column' },
  right: { minHeight: 0, display: 'flex', flexDirection: 'column' },
  leftHead: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 12px',
    borderBottom: '1px solid rgba(233,238,252,.10)',
    background: 'rgba(0,0,0,.10)'
  },
  rightHead: {
    padding: '10px 12px',
    borderBottom: '1px solid rgba(233,238,252,.10)',
    background: 'rgba(0,0,0,.10)'
  },
  title: { fontWeight: 800 },
  btn: {
    padding: '8px 10px',
    borderRadius: 12,
    border: '1px solid rgba(233,238,252,.12)',
    background: 'rgba(255,255,255,.06)',
    color: '#e9eefc',
    cursor: 'pointer'
  },
  list: { flex: 1, overflow: 'auto', padding: 10 },
  item: {
    width: '100%',
    textAlign: 'left',
    padding: '8px 10px',
    borderRadius: 12,
    border: '1px solid rgba(233,238,252,.08)',
    background: 'rgba(255,255,255,.04)',
    color: '#e9eefc',
    cursor: 'pointer',
    marginBottom: 8,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  itemActive: {
    background: 'linear-gradient(135deg, rgba(90,140,255,.22), rgba(186,85,255,.14))',
    border: '1px solid rgba(233,238,252,.16)'
  },
  muted: { opacity: .7, fontSize: 13, padding: 10 },
  viewer: { flex: 1, minHeight: 0, overflow: 'auto', padding: 12 },
  pre: {
    margin: 0,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    lineHeight: 1.35,
    fontSize: 13,
  },
  error: {
    padding: 12,
    borderRadius: 14,
    border: '1px solid rgba(255,120,120,.35)',
    background: 'rgba(255,80,80,.08)'
  }
};

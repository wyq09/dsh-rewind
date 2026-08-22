// dsh-rewind client half: floating timeline panel (shell.overlay) + run-card strip.
const store = (() => {
  let s = { open: false, x: 24, y: 24 }
  const subs = new Set()
  return {
    get: () => s,
    patch: (p) => { s = Object.assign({}, s, p); subs.forEach((f) => { try { f() } catch (e) {} }) },
    sub: (f) => { subs.add(f); return () => subs.delete(f) },
  }
})()
const CSS = '.rw-pill{position:fixed;z-index:2147483000;display:flex;align-items:center;gap:6px;padding:7px 12px;border-radius:999px;background:rgba(23,24,29,.92);border:1px solid rgba(255,255,255,.14);color:#e7e9ee;font:600 12px/1 system-ui,sans-serif;cursor:grab;user-select:none;box-shadow:0 8px 24px rgba(0,0,0,.35);backdrop-filter:blur(8px)}.rw-pill-n{opacity:.85;font-variant-numeric:tabular-nums}.rw-panel{position:fixed;z-index:2147483000;width:440px;max-width:calc(100vw - 32px);max-height:600px;display:flex;flex-direction:column;border-radius:14px;background:rgba(23,24,29,.97);border:1px solid rgba(255,255,255,.14);color:#e7e9ee;font:13px/1.45 system-ui,sans-serif;box-shadow:0 18px 48px rgba(0,0,0,.5);overflow:hidden}.rw-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.1);cursor:grab;user-select:none}.rw-title{font-weight:700}.rw-sub{color:#9aa0ad;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.rw-spacer{flex:1}.rw-btn{border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);color:#e7e9ee;border-radius:8px;padding:5px 10px;font:600 12px/1 system-ui,sans-serif;cursor:pointer}.rw-btn:disabled{opacity:.4;cursor:default}.rw-btn-danger{border-color:rgba(248,113,113,.5);background:rgba(248,113,113,.14);color:#fca5a5}.rw-body{padding:10px 12px;display:flex;flex-direction:column;gap:8px;min-height:0}.rw-list{overflow:auto;max-height:190px;border:1px solid rgba(255,255,255,.1);border-radius:10px}.rw-item{display:block;width:100%;text-align:left;background:transparent;border:0;border-bottom:1px solid rgba(255,255,255,.07);color:inherit;padding:7px 10px;cursor:pointer;font:inherit}.rw-item:hover{background:rgba(255,255,255,.05)}.rw-item-sel{background:rgba(139,157,255,.12);border-left:3px solid #8b9dff}.rw-item-head{display:flex;justify-content:space-between;gap:8px}.rw-item-turn{font-weight:700;color:#8b9dff}.rw-item-meta{color:#9aa0ad;font-size:11px}.rw-item-label{display:block;color:#c9cdd6;font-size:12px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.rw-actions{display:flex;flex-wrap:wrap;gap:6px}.rw-msg{color:#7ee2a8;font-size:12px}.rw-err{color:#fca5a5;font-size:12px}.rw-diff{border:1px solid rgba(255,255,255,.1);border-radius:10px;overflow:auto;max-height:240px;font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;background:rgba(0,0,0,.3)}.rw-diff-stat{color:#b0b7c3;padding:6px 10px;border-bottom:1px solid rgba(255,255,255,.08)}.rw-line{padding:0 10px;white-space:pre-wrap;word-break:break-all}.rw-add{background:rgba(61,220,132,.12);color:#7ee2a8}.rw-del{background:rgba(248,81,73,.12);color:#ff9d96}.rw-hunk{color:#7db3ff}.rw-meta{color:#8b93a1}.rw-ctx{color:#d5d9e0}.rw-muted{color:#8b93a1;font-size:11px;padding:4px 10px}.rw-strip{display:inline-flex;align-items:center;gap:6px;margin:6px 0;padding:6px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);color:#e7e9ee;font:12px/1.4 system-ui,sans-serif;cursor:pointer}.rw-strip:hover{background:rgba(255,255,255,.08)}'
return {
  name: 'dsh-rewind-ui',
  inject: ['timer'],
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return
    styles.insert(CSS)
    let drag = { active: false, moved: false, id: 0, x0: 0, y0: 0, bx: 0, by: 0 }
    const dragStart = (e) => {
      const s = store.get()
      drag = { active: true, moved: false, id: e.pointerId, x0: e.clientX, y0: e.clientY, bx: s.x, by: s.y }
      try { if (e.currentTarget && e.currentTarget.setPointerCapture) e.currentTarget.setPointerCapture(e.pointerId) } catch (err) {}
    }
    const dragMove = (e) => {
      if (!drag.active || drag.id !== e.pointerId) return
      const dx = drag.x0 - e.clientX
      const dy = drag.y0 - e.clientY
      if (!drag.moved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) drag.moved = true
      if (drag.moved) store.patch({ x: Math.max(12, drag.bx + dx), y: Math.max(12, drag.by + dy) })
    }
    const dragEnd = (e) => {
      if (drag.id === e.pointerId) drag = { active: false, moved: false, id: 0, x0: 0, y0: 0, bx: 0, by: 0 }
    }
    const useTick = () => {
      const [, setTick] = React.useState(0)
      React.useEffect(() => store.sub(() => setTick((t) => t + 1)), [])
      return store.get()
    }
    const fmtTime = (t) => { try { return new Date(t).toLocaleTimeString([], { hour12: false }) } catch (e) { return String(t) } }
    const lineClass = (ln) => {
      if (ln[0] === '+') return 'rw-line rw-add'
      if (ln[0] === '-') return 'rw-line rw-del'
      if (ln[0] === '@') return 'rw-line rw-hunk'
      if (ln.indexOf('diff ') === 0 || ln.indexOf('index ') === 0 || ln.indexOf('---') === 0 || ln.indexOf('+++') === 0) return 'rw-line rw-meta'
      return 'rw-line rw-ctx'
    }
    function Panel() {
      const s = useTick()
      const [data, setData] = React.useState(null)
      const [sel, setSel] = React.useState('')
      const [confirm, setConfirm] = React.useState(false)
      const [diff, setDiff] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [msg, setMsg] = React.useState('')
      const refreshRef = React.useRef(null)
      refreshRef.current = async () => {
        try { setData(await host.call('state', {})) } catch (e) { setMsg(String((e && e.message) || e)) }
      }
      React.useEffect(() => {
        refreshRef.current()
        const stop = ctx.interval(() => { if (store.get().open) refreshRef.current() }, 4000)
        return () => stop()
      }, [])
      const call = async (method, args) => {
        setBusy(true)
        setMsg('')
        try {
          const r = await host.call(method, args || {})
          if (r && r.message) setMsg(r.message)
          await refreshRef.current()
        } catch (e) { setMsg(String((e && e.message) || e)) } finally { setBusy(false) }
      }
      const pick = async (c) => {
        setSel(c.id)
        setConfirm(false)
        setDiff(null)
        try { setDiff(await host.call('preview', { id: c.id })) } catch (e) { setMsg(String((e && e.message) || e)) }
      }
      const cps = data && data.checkpoints ? data.checkpoints : []
      if (!s.open) {
        return React.createElement('div', {
          className: 'rw-pill',
          title: 'dsh-rewind: open the checkpoint timeline',
          style: { right: s.x, bottom: s.y },
          onPointerDown: dragStart, onPointerMove: dragMove, onPointerUp: dragEnd,
          onClick: () => { if (!drag.moved) store.patch({ open: true }) },
        }, '⏪ ', React.createElement('span', { className: 'rw-pill-n' }, String(cps.length)))
      }
      const rows = cps.slice().reverse().map((c) => {
        const active = c.id === sel
        const tag = c.trigger === 'before-restore' ? 'safety' : c.trigger === 'resume' ? 'start' : c.trigger === 'manual' ? 'manual' : ''
        return React.createElement('button', {
          key: c.id,
          className: 'rw-item' + (active ? ' rw-item-sel' : ''),
          onClick: () => pick(c),
        },
          React.createElement('span', { className: 'rw-item-head' },
            React.createElement('span', { className: 'rw-item-turn' }, 'T' + c.turn + (tag ? ' · ' + tag : '')),
            React.createElement('span', { className: 'rw-item-meta' }, fmtTime(c.time) + ' · ' + c.files + ' files')),
          React.createElement('span', { className: 'rw-item-label' }, c.label || c.id))
      })
      const diffLines = diff && diff.diff ? diff.diff.split('\n') : []
      const shown = diffLines.slice(0, 1600)
      const diffEl = diff && diff.diff ? React.createElement('div', { className: 'rw-diff' },
        React.createElement('div', { className: 'rw-diff-stat' }, diff.stat || ''),
        shown.map((ln, i) => React.createElement('div', { key: i, className: lineClass(ln) }, ln === '' ? ' ' : ln)),
        diffLines.length > shown.length ? React.createElement('div', { className: 'rw-muted' }, '… diff truncated for display') : null
      ) : null
      const ready = data && data.ready
      return React.createElement('div', { className: 'rw-panel', style: { right: s.x, bottom: s.y } },
        React.createElement('div', { className: 'rw-head', onPointerDown: dragStart, onPointerMove: dragMove, onPointerUp: dragEnd },
          React.createElement('span', { className: 'rw-title' }, '⏪ Rewind'),
          React.createElement('span', { className: 'rw-sub' }, (data && data.root ? data.root.split('/').pop() : '…') + ' · ' + cps.length + ' checkpoints'),
          React.createElement('span', { className: 'rw-spacer' }),
          React.createElement('button', { className: 'rw-btn', title: 'Refresh', onClick: () => refreshRef.current() }, '⟳'),
          React.createElement('button', { className: 'rw-btn', title: 'Collapse', onClick: () => store.patch({ open: false }) }, '−'),
          React.createElement('button', { className: 'rw-btn', title: 'Close', onClick: () => store.patch({ open: false }) }, '×')),
        React.createElement('div', { className: 'rw-body' },
          ready === false ? React.createElement('div', { className: 'rw-err' }, 'dsh-rewind has not detected a workspace yet (' + (data && data.reason || 'unknown') + ')') : null,
          cps.length === 0 && ready ? React.createElement('div', { className: 'rw-muted' }, 'No checkpoints yet. A checkpoint is created after each agent turn that changes files.') : null,
          React.createElement('div', { className: 'rw-list' }, rows),
          diffEl,
          React.createElement('div', { className: 'rw-actions' },
            React.createElement('button', { className: 'rw-btn', disabled: busy, onClick: () => call('checkpoint', {}) }, '📸 Checkpoint now'),
            React.createElement('button', { className: 'rw-btn', disabled: busy, onClick: () => call('undo', {}) }, '↩ Undo (' + (data && data.undoCount || 0) + ')'),
            React.createElement('button', { className: 'rw-btn', disabled: busy, onClick: () => call('redo', {}) }, '↪ Redo (' + (data && data.redoCount || 0) + ')'),
            React.createElement('button', {
              className: 'rw-btn' + (confirm ? ' rw-btn-danger' : ''),
              disabled: busy || !sel,
              onClick: () => {
                if (!confirm) { setConfirm(true); setMsg('Restoring files to ' + sel + ' — click again to confirm') }
                else { setConfirm(false); call('restore', { id: sel }) }
              },
            }, confirm ? '⚠ Confirm restore' : '↺ Restore selected')),
          msg ? React.createElement('div', { className: 'rw-msg' }, msg) : null,
          data && data.error ? React.createElement('div', { className: 'rw-err' }, data.error) : null)
      )
    }
    function Strip() {
      const [n, setN] = React.useState(null)
      React.useEffect(() => {
        host.call('state', {}).then((r) => { if (r && r.checkpoints) setN(r.checkpoints.length) }).catch(() => {})
      }, [])
      return React.createElement('div', {
        className: 'rw-strip',
        title: 'Open the dsh-rewind checkpoint timeline',
        onClick: () => store.patch({ open: true }),
      }, '⏪ dsh-rewind · ', React.createElement('b', null, String(n === null ? '…' : n)), ' checkpoints — click to open the timeline')
    }
    slots.inject('shell.overlay', () => slots.register({ name: 'shell.overlay', id: 'dsh-rewind-overlay', order: 40, label: 'Rewind timeline' }, () => React.createElement(Panel)))
    slots.inject('tool.view.cordis', () => slots.register({ name: 'tool.view.cordis', key: 'self' }, () => React.createElement(Strip)))
  },
}

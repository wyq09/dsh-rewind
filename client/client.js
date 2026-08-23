// dsh-rewind web client: floating checkpoint timeline in `shell.overlay`.
// Talks to the host through the process-local /dsh-rewind/* endpoints; no LLM,
// no tokens. Current session id comes from the useSessions standard prop.
window.__ModuleLoader__.load({ id: 'dsh-rewind', factory: (require) => {
  var module = { exports: {} }
  var exports = module.exports
  Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
  const react = require('react')

  const name = 'dsh-rewind'
  const inject = ['slots']

  const store = (() => {
    let s = { open: false, x: 24, y: 24 }
    const subs = new Set()
    return {
      get: () => s,
      patch: (p) => { s = Object.assign({}, s, p); subs.forEach((f) => { try { f() } catch (e) {} }) },
      sub: (f) => { subs.add(f); return () => subs.delete(f) },
    }
  })()

  const CSS = '.rw-pill{position:fixed;z-index:2147483000;display:flex;align-items:center;gap:7px;padding:7px 12px;border-radius:999px;background:rgba(23,24,29,.92);border:1px solid rgba(255,255,255,.14);color:#e7e9ee;font:600 12px/1 system-ui,sans-serif;cursor:grab;user-select:none;box-shadow:0 8px 24px rgba(0,0,0,.35);backdrop-filter:blur(8px)}.rw-pill-n{opacity:.85;font-variant-numeric:tabular-nums}.rw-panel{position:fixed;z-index:2147483000;width:440px;max-width:calc(100vw - 32px);max-height:600px;display:flex;flex-direction:column;border-radius:14px;background:rgba(23,24,29,.97);border:1px solid rgba(255,255,255,.14);color:#e7e9ee;font:13px/1.45 system-ui,sans-serif;box-shadow:0 18px 48px rgba(0,0,0,.5);overflow:hidden}.rw-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.1);cursor:grab;user-select:none}.rw-title{display:inline-flex;align-items:center;gap:7px;font-weight:700}.rw-brand{color:#9aaaFF}.rw-icon{display:block;flex:0 0 auto}.rw-sub{color:#9aa0ad;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.rw-spacer{flex:1}.rw-head-actions{display:flex;gap:6px;cursor:default}.rw-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);color:#e7e9ee;border-radius:8px;padding:6px 10px;font:600 12px/1 system-ui,sans-serif;cursor:pointer;transition:background .15s ease,border-color .15s ease,transform .15s ease}.rw-btn:hover:not(:disabled){background:rgba(255,255,255,.11);border-color:rgba(255,255,255,.25)}.rw-btn:active:not(:disabled){transform:translateY(1px)}.rw-btn:disabled{opacity:.4;cursor:default}.rw-icon-btn{width:36px;height:32px;padding:0}.rw-btn-danger{border-color:rgba(248,113,113,.5);background:rgba(248,113,113,.14);color:#fca5a5}.rw-body{padding:10px 12px;display:flex;flex-direction:column;gap:8px;min-height:0}.rw-list{overflow:auto;max-height:190px;border:1px solid rgba(255,255,255,.1);border-radius:10px}.rw-item{display:block;width:100%;text-align:left;background:transparent;border:0;border-bottom:1px solid rgba(255,255,255,.07);color:inherit;padding:7px 10px;cursor:pointer;font:inherit}.rw-item:hover{background:rgba(255,255,255,.05)}.rw-item-sel{background:rgba(139,157,255,.12);border-left:3px solid #8b9dff}.rw-item-head{display:flex;justify-content:space-between;gap:8px}.rw-item-turn{font-weight:700;color:#8b9dff}.rw-item-meta{color:#9aa0ad;font-size:11px}.rw-item-label{display:block;color:#c9cdd6;font-size:12px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.rw-actions{display:flex;flex-wrap:wrap;gap:6px}.rw-msg{color:#7ee2a8;font-size:12px}.rw-err{color:#fca5a5;font-size:12px}.rw-diff{border:1px solid rgba(255,255,255,.1);border-radius:10px;overflow:auto;max-height:240px;font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;background:rgba(0,0,0,.3)}.rw-diff-stat{color:#b0b7c3;padding:6px 10px;border-bottom:1px solid rgba(255,255,255,.08)}.rw-line{padding:0 10px;white-space:pre-wrap;word-break:break-all}.rw-add{background:rgba(61,220,132,.12);color:#7ee2a8}.rw-del{background:rgba(248,81,73,.12);color:#ff9d96}.rw-hunk{color:#7db3ff}.rw-meta{color:#8b93a1}.rw-ctx{color:#d5d9e0}.rw-muted{color:#8b93a1;font-size:11px;padding:4px 10px}'

  const ICON_PATHS = {
    rewind: ['M3 12a9 9 0 1 0 3-6.7', 'M3 4v6h6', 'M12 7v5l3 2'],
    refresh: ['M20 6v5h-5', 'M4 18v-5h5', 'M19 11a7 7 0 0 0-12-4L4 11', 'M5 13a7 7 0 0 0 12 4l3-4'],
    minimize: ['M5 12h14'],
    close: ['M6 6l12 12M18 6L6 18'],
    camera: ['M4 8h3l2-3h6l2 3h3v11H4z', 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'],
    undo: ['M9 7l-5 5 5 5', 'M4 12h9a7 7 0 0 1 7 7'],
    redo: ['M15 7l5 5-5 5', 'M20 12h-9a7 7 0 0 0-7 7'],
    restore: ['M3 12a9 9 0 1 0 3-6.7', 'M3 4v6h6'],
    alert: ['M12 3 2 21h20L12 3z', 'M12 9v5', 'M12 18h.01'],
  }
  function Icon(props) {
    const paths = ICON_PATHS[props.name] || []
    return react.createElement('svg', {
      className: 'rw-icon' + (props.className ? ' ' + props.className : ''),
      width: props.size || 16, height: props.size || 16, viewBox: '0 0 24 24',
      fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round',
      'aria-hidden': 'true', focusable: 'false',
    }, paths.map((d, i) => react.createElement('path', { d, key: i })))
  }
  const buttonLabel = (icon, text) => [react.createElement(Icon, { name: icon, key: 'icon' }), react.createElement('span', { key: 'text' }, text)]

  const fmtTime = (t) => { try { return new Date(t).toLocaleTimeString([], { hour12: false }) } catch (e) { return String(t) } }
  const lineClass = (ln) => {
    if (ln[0] === '+') return 'rw-line rw-add'
    if (ln[0] === '-') return 'rw-line rw-del'
    if (ln[0] === '@') return 'rw-line rw-hunk'
    if (ln.indexOf('diff ') === 0 || ln.indexOf('index ') === 0 || ln.indexOf('---') === 0 || ln.indexOf('+++') === 0) return 'rw-line rw-meta'
    return 'rw-line rw-ctx'
  }
  const getJSON = async (url) => {
    const r = await fetch(url, { cache: 'no-store' })
    return await r.json()
  }

  function Panel(props) {
    const useSessions = props && props.useSessions
    const sessionId = useSessions ? useSessions((s) => s && s.current) : undefined

    const s = (() => {
      const [, setTick] = react.useState(0)
      react.useEffect(() => store.sub(() => setTick((t) => t + 1)), [])
      return store.get()
    })()

    const [data, setData] = react.useState(null)
    const [sel, setSel] = react.useState('')
    const [confirm, setConfirm] = react.useState(false)
    const [diff, setDiff] = react.useState(null)
    const [busy, setBusy] = react.useState(false)
    const [msg, setMsg] = react.useState('')
    const [drag, setDrag] = react.useState({ active: false, moved: false, id: 0, x0: 0, y0: 0, bx: 0, by: 0 })

    const refresh = react.useCallback(async () => {
      if (!sessionId) { setData({ ready: false, reason: 'no-session' }); return }
      try { setData(await getJSON('/dsh-rewind/state?session=' + encodeURIComponent(sessionId))) }
      catch (e) { setMsg(String((e && e.message) || e)) }
    }, [sessionId])
    const refreshNow = async () => {
      setMsg('')
      await refresh()
      setMsg('已刷新')
    }

    react.useEffect(() => {
      refresh()
      const timer = setInterval(() => { refresh() }, 4000)
      return () => clearInterval(timer)
    }, [refresh])

    const call = async (path) => {
      setBusy(true)
      setMsg('')
      try {
        const r = await getJSON(path + (path.indexOf('?') === -1 ? '?' : '&') + 'session=' + encodeURIComponent(sessionId || ''))
        if (r && r.message) setMsg(r.message)
        await refresh()
      } catch (e) { setMsg(String((e && e.message) || e)) } finally { setBusy(false) }
    }
    const pick = async (c) => {
      setSel(c.id)
      setConfirm(false)
      setDiff(null)
      try { setDiff(await getJSON('/dsh-rewind/preview?session=' + encodeURIComponent(sessionId || '') + '&id=' + encodeURIComponent(c.id))) }
      catch (e) { setMsg(String((e && e.message) || e)) }
    }

    const onDown = (e) => {
      if (e.target && typeof e.target.closest === 'function' && e.target.closest('button')) return
      const st = store.get()
      setDrag({ active: true, moved: false, id: e.pointerId, x0: e.clientX, y0: e.clientY, bx: st.x, by: st.y })
      try { if (e.currentTarget && e.currentTarget.setPointerCapture) e.currentTarget.setPointerCapture(e.pointerId) } catch (err) {}
    }
    const onMove = (e) => {
      if (!drag.active || drag.id !== e.pointerId) return
      const dx = drag.x0 - e.clientX
      const dy = drag.y0 - e.clientY
      let moved = drag.moved
      if (!moved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) moved = true
      setDrag({ active: true, moved, id: e.pointerId, x0: drag.x0, y0: drag.y0, bx: drag.bx, by: drag.by })
      if (moved) store.patch({ x: Math.max(12, drag.bx + dx), y: Math.max(12, drag.by + dy) })
    }
    const onUp = (e) => { if (drag.id === e.pointerId) setDrag({ active: false, moved: false, id: 0, x0: 0, y0: 0, bx: 0, by: 0 }) }

    const cps = data && data.checkpoints ? data.checkpoints : []

    if (!s.open) {
      // Keep CSS mounted while collapsed. Previously the only <style> lived in
      // the expanded panel, so a fresh page rendered the pill as unpositioned
      // plain text at the bottom of the document — easy to mistake for a plugin
      // that never loaded.
      return react.createElement(react.Fragment, null,
        react.createElement('style', null, CSS),
        react.createElement('div', {
          className: 'rw-pill',
          title: 'dsh-rewind: open the checkpoint timeline',
          style: { right: s.x, bottom: s.y },
          onPointerDown: onDown, onPointerMove: onMove, onPointerUp: onUp,
          onClick: () => { if (!drag.moved) store.patch({ open: true }) },
        }, react.createElement(Icon, { name: 'rewind', className: 'rw-brand', size: 17 }), react.createElement('span', { className: 'rw-pill-n' }, String(cps.length))))
    }

    const rows = cps.slice().reverse().map((c) => {
      const active = c.id === sel
      const tag = c.trigger === 'before-restore' ? 'safety' : c.trigger === 'start' || c.trigger === 'turn-start' || c.trigger === 'resume' ? 'start' : c.trigger === 'manual' ? 'manual' : ''
      return react.createElement('button', {
        key: c.id,
        className: 'rw-item' + (active ? ' rw-item-sel' : ''),
        onClick: () => pick(c),
      },
        react.createElement('span', { className: 'rw-item-head' },
          react.createElement('span', { className: 'rw-item-turn' }, 'T' + c.turn + (tag ? ' · ' + tag : '')),
          react.createElement('span', { className: 'rw-item-meta' }, fmtTime(c.time) + ' · ' + c.files + ' files')),
        react.createElement('span', { className: 'rw-item-label' }, c.label || c.id))
    })

    const diffLines = diff && diff.diff ? diff.diff.split('\n') : []
    const shown = diffLines.slice(0, 1600)
    const diffEl = diff && diff.diff ? react.createElement('div', { className: 'rw-diff' },
      react.createElement('div', { className: 'rw-diff-stat' }, diff.stat || ''),
      shown.map((ln, i) => react.createElement('div', { key: i, className: lineClass(ln) }, ln === '' ? ' ' : ln)),
      diffLines.length > shown.length ? react.createElement('div', { className: 'rw-muted' }, '… diff truncated for display') : null
    ) : null

    const ready = data && data.ready

    return react.createElement('div', { className: 'rw-panel', style: { right: s.x, bottom: s.y } },
      react.createElement('style', null, CSS),
      react.createElement('div', { className: 'rw-head', onPointerDown: onDown, onPointerMove: onMove, onPointerUp: onUp },
        react.createElement('span', { className: 'rw-title' }, react.createElement(Icon, { name: 'rewind', className: 'rw-brand', size: 18 }), react.createElement('span', null, 'Rewind')),
        react.createElement('span', { className: 'rw-sub' }, (data && data.root ? data.root.split('/').pop() : '…') + ' · ' + cps.length + ' checkpoints'),
        react.createElement('span', { className: 'rw-spacer' }),
        react.createElement('div', { className: 'rw-head-actions', onPointerDown: (e) => e.stopPropagation() },
          react.createElement('button', { type: 'button', className: 'rw-btn rw-icon-btn', title: '刷新', 'aria-label': '刷新', onClick: refreshNow }, react.createElement(Icon, { name: 'refresh' })),
          react.createElement('button', { type: 'button', className: 'rw-btn rw-icon-btn', title: '收起', 'aria-label': '收起', onClick: () => store.patch({ open: false }) }, react.createElement(Icon, { name: 'minimize' })),
          react.createElement('button', { type: 'button', className: 'rw-btn rw-icon-btn', title: '关闭', 'aria-label': '关闭', onClick: () => store.patch({ open: false }) }, react.createElement(Icon, { name: 'close' })))),
      react.createElement('div', { className: 'rw-body' },
        ready === false ? react.createElement('div', { className: 'rw-err' }, 'dsh-rewind 尚未检测到会话工作区（' + (data && data.reason || 'unknown') + '）') : null,
        cps.length === 0 && ready ? react.createElement('div', { className: 'rw-muted' }, '还没有检查点。每个改动过文件的 agent 回合结束后会自动创建。') : null,
        react.createElement('div', { className: 'rw-list' }, rows),
        diffEl,
        react.createElement('div', { className: 'rw-actions' },
          react.createElement('button', { type: 'button', className: 'rw-btn', disabled: busy, onClick: () => call('/dsh-rewind/checkpoint') }, buttonLabel('camera', '立即快照')),
          react.createElement('button', { type: 'button', className: 'rw-btn', disabled: busy, onClick: () => call('/dsh-rewind/undo') }, buttonLabel('undo', '撤销 (' + (data && data.undoCount || 0) + ')')),
          react.createElement('button', { type: 'button', className: 'rw-btn', disabled: busy, onClick: () => call('/dsh-rewind/redo') }, buttonLabel('redo', '重做 (' + (data && data.redoCount || 0) + ')')),
          react.createElement('button', {
            type: 'button',
            className: 'rw-btn' + (confirm ? ' rw-btn-danger' : ''),
            disabled: busy || !sel,
            onClick: () => {
              if (!confirm) { setConfirm(true); setMsg('将把文件还原到 ' + sel + ' — 再点一次确认') }
              else { setConfirm(false); call('/dsh-rewind/restore?id=' + encodeURIComponent(sel)) }
            },
          }, buttonLabel(confirm ? 'alert' : 'restore', confirm ? '确认还原' : '还原选中项'))),
        msg ? react.createElement('div', { className: 'rw-msg' }, msg) : null,
        data && data.error ? react.createElement('div', { className: 'rw-err' }, data.error) : null)
    )
  }

  function apply(ctx) {
    ctx.slots.inject('shell.overlay', () => ctx.slots.register(
      { name: 'shell.overlay', id: 'dsh-rewind', order: 40, label: 'Rewind' },
      (props) => react.createElement(Panel, props),
    ))
  }

  return { name, inject, apply }
}})

// dsh-rewind host: checkpoint/rewind engine for the DeepSeek Harness (dsh),
// adapted from arpagon/pi-rewind.
//
// A shadow git repo at <workspace>/.dsh-rewind snapshots every workspace — even
// outside a real git repo. One checkpoint per agent turn (tree-dedup), unified
// diff preview, safe restore, undo/redo stacks, per-session pruning (50 max).
//
// Surfaces:
//   - a `rewind` model tool (targets the calling agent's workspace)
//   - HTTP endpoints under /dsh-rewind/* for the web client
//   - automatic checkpoints on `agent/turn-stopping` for every live agent

import { REWIND_TOOL_DESCRIPTION } from './prompt.js'

const MAX_CHECKPOINTS = 50
const MAX_FILE_BYTES = 10 * 1024 * 1024
const MAX_DIR_FILES = 200
const IGNORED_DIRS = ['node_modules', '.venv', 'venv', 'env', '.env', 'dist', 'build', '.pytest_cache', '.mypy_cache', '.cache', '.tox', '__pycache__']
const MUTATING_TOOLS = ['write', 'edit', 'bash']

export const name = 'dsh-rewind'
export const version = '1.1.0'
export const inject = ['subprocess', 'fs', 'tools', 'webServer', 'agents']

export function apply(ctx, config = {}) {
    const scope = ctx
    const sp = scope.subprocess
    const fs = scope.fs
    const tools = scope.tools
    const webServer = scope.webServer
    const agents = scope.agents

    // ---- shared state ----
    const S = {
      gitPath: '',
      queue: Promise.resolve(),
      inited: new Set(),          // workspace + session pairs already initialized
      sessionWorkspace: new Map(), // sessionId -> cwd
      turnLabel: new Map(),        // sessionId -> { prompt, tools }
    }
    let gitPathPromise = null
    let teePathPromise = null
    let catPathPromise = null
    let rmPathPromise = null

    const log = (...a) => console.log('[dsh-rewind]', ...a)
    const warn = (...a) => console.error('[dsh-rewind]', ...a)
    log('host loaded', 'v' + version)

    const j = (root, ...parts) => (root.replace(/\/+$/, '') + '/' + parts.join('/')).replace(/\/{2,}/g, '/')
    const sanitize = (s) => String(s === null || s === undefined ? '' : s).replace(/[\r\n\t\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim()
    const trunc = (s, n) => { s = String(s === null || s === undefined ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s }
    const refSid = (sid) => String(sid).replace(/[^a-zA-Z0-9._-]/g, '_')
    const base = (p) => { const i = String(p).lastIndexOf('/'); return i === -1 ? String(p) : String(p).slice(i + 1) }
    const parentDir = (p) => { const i = String(p).lastIndexOf('/'); return i <= 0 ? '.' : String(p).slice(0, i) }
    const shouldIgnore = (p) => String(p).split('/').some((c) => IGNORED_DIRS.indexOf(c) !== -1)
    const skipPath = (p) => p === '.git' || p.indexOf('.git/') === 0 || p === '.dsh-rewind' || p.indexOf('.dsh-rewind/') === 0 || p === '.DS_Store'
    const iso = (t) => new Date(t).toISOString()
    const enqueue = (fn) => { const p = S.queue.then(fn); S.queue = p.catch(() => {}); return p }

    async function resolveGit() {
      if (gitPathPromise === null) gitPathPromise = sp.resolveExecutable('git').catch((e) => { gitPathPromise = null; throw e })
      return gitPathPromise
    }
    async function resolveTee() {
      if (teePathPromise === null) teePathPromise = sp.resolveExecutable('tee').catch((e) => { teePathPromise = null; throw e })
      return teePathPromise
    }
    async function resolveCat() {
      if (catPathPromise === null) catPathPromise = sp.resolveExecutable('cat').catch((e) => { catPathPromise = null; throw e })
      return catPathPromise
    }
    async function resolveRm() {
      if (rmPathPromise === null) rmPathPromise = sp.resolveExecutable('rm').catch((e) => { rmPathPromise = null; throw e })
      return rmPathPromise
    }

    function runCmd(bin, args, root, opts) {
      const o = opts || {}
      const cap = o.cap === undefined ? 1024 * 1024 : o.cap
      const env = {}
      if (o.env) for (const k of Object.keys(o.env)) env[k] = o.env[k]
      const handle = sp.spawn({
        argv: [bin].concat(args),
        cwd: root,
        stdio: { stdin: o.input === undefined ? 'ignore' : { data: o.input }, stdout: { maxBytes: cap }, stderr: { maxBytes: 64 * 1024 } },
        graceMs: 30000,
        env,
      })
      return handle.done.then((outcome) => {
        const out = handle.collected.stdout ? handle.collected.stdout.readFrom(0) : { text: '', lossy: false }
        const err = handle.collected.stderr ? handle.collected.stderr.readFrom(0) : { text: '', lossy: false }
        if (out.lossy) throw new Error('command output truncated for ' + String(args[0]))
        if (outcome.exitCode !== 0) {
          const first = String(err.text || '').trim().split('\n')[0]
          throw new Error(first || ('command ' + String(args[0]) + ' exited ' + outcome.exitCode))
        }
        return out.text
      })
    }

    function gitRun(root, args, opts) {
      const o = opts || {}
      if (S.gitPath === '') throw new Error('git not resolved')
      const env = { GIT_DIR: j(root, '.dsh-rewind', 'git'), GIT_WORK_TREE: root, GIT_INDEX_FILE: j(root, '.dsh-rewind', 'index') }
      return runCmd(S.gitPath, ['-c', 'core.quotepath=false'].concat(args), root, Object.assign({}, o, { env: Object.assign({}, env, o.env || {}) }))
    }

    async function writeFile(root, rel, content) {
      const tee = await resolveTee()
      await runCmd(tee, [j(root, rel)], root, { input: content })
    }
    async function readFile(root, rel) {
      const cat = await resolveCat()
      return await runCmd(cat, [j(root, rel)], root, {})
    }
    async function rmFile(root, rel) {
      const rm = await resolveRm()
      await runCmd(rm, ['-f', j(root, rel)], root, {})
    }

    async function readMeta(root) {
      try {
        const parsed = JSON.parse(await readFile(root, '.dsh-rewind/meta.json'))
        if (parsed && typeof parsed === 'object' && parsed.sessions) return parsed
      } catch (e) {}
      return { sessions: {} }
    }
    async function writeMeta(root, meta) {
      try { await writeFile(root, '.dsh-rewind/meta.json', JSON.stringify(meta)) } catch (e) { warn('meta write failed', String(e && e.message || e)) }
    }

    async function commitTree(root, tree, parent, info) {
      const time = info.time || Date.now()
      const lines = [
        'dsh-rewind:' + info.id,
        'sessionId ' + info.sessionId,
        'trigger ' + info.trigger,
        'turn ' + info.turn,
        'label ' + sanitize(info.label || ''),
        'created ' + time,
        'tree ' + tree,
        'files ' + (info.files || 0),
        'untracked ' + JSON.stringify(info.untracked || []),
        'largeFiles ' + JSON.stringify(info.skippedLarge || []),
        'largeDirs ' + JSON.stringify(info.skippedDirs || []),
      ].join('\n')
      const env = {
        GIT_AUTHOR_NAME: 'dsh-rewind', GIT_AUTHOR_EMAIL: 'rewind@dsh.local', GIT_AUTHOR_DATE: iso(time),
        GIT_COMMITTER_NAME: 'dsh-rewind', GIT_COMMITTER_EMAIL: 'rewind@dsh.local', GIT_COMMITTER_DATE: iso(time),
      }
      const argv = ['commit-tree', tree]
      if (parent) argv.push('-p', parent)
      return (await gitRun(root, argv, { input: lines + '\n', env })).trim()
    }

    async function initWorkspace(root, sid) {
      if (S.gitPath === '') S.gitPath = await resolveGit()
      const metaDir = j(root, '.dsh-rewind')
      let hasMeta = false
      try { const st = await fs.stat(await fs.resolve(metaDir)); hasMeta = Boolean(st && st.type === 'directory') } catch (e) {}
      if (!hasMeta) {
        try {
          const mk = await sp.resolveExecutable('mkdir')
          await runCmd(mk, ['-p', metaDir], root, {})
        } catch (e) { throw new Error('cannot create ' + metaDir + ': ' + String(e && e.message || e)) }
      }
      const gitDir = j(root, '.dsh-rewind', 'git')
      let exists = false
      try { const st = await fs.stat(await fs.resolve(gitDir)); exists = Boolean(st && st.type === 'directory') } catch (e) {}
      if (!exists) {
        try { await gitRun(root, ['init', '-q', '--initial-branch=rewind']) }
        catch (e) { await gitRun(root, ['init', '-q']); await gitRun(root, ['symbolic-ref', 'HEAD', 'refs/heads/rewind']) }
        await gitRun(root, ['config', 'user.name', 'dsh-rewind'])
        await gitRun(root, ['config', 'user.email', 'rewind@dsh.local'])
        try { await gitRun(root, ['config', 'commit.gpgsign', 'false']) } catch (e) {}
      }
      await rmFile(root, '.dsh-rewind/index.lock')
      try { await writeFile(root, '.dsh-rewind/git/info/exclude', '.git\n.dsh-rewind\n.DS_Store\n') } catch (e) { warn('exclude write failed', String(e && e.message || e)) }
      try { await gitRun(root, ['rm', '-r', '--cached', '-q', '--ignore-unmatch', '--', '.dsh-rewind', '.git']) } catch (e) {}
      const rs = refSid(sid)
      const headRef = 'refs/dsh-rewind/' + rs + '/head'
      const head = await gitRun(root, ['rev-parse', '--verify', headRef]).catch(() => '')
      if (head.trim() === '') {
        const emptyTree = (await gitRun(root, ['mktree'], { input: '' })).trim()
        const commit = await commitTree(root, emptyTree, null, { id: 'init', sessionId: sid, trigger: 'resume', turn: 0, label: 'workspace baseline', files: 0, untracked: [], skippedLarge: [], skippedDirs: [], time: Date.now() })
        await gitRun(root, ['update-ref', headRef, commit])
      }
      // The shadow repository has one index. Since all operations are serialized,
      // activating the calling session here safely prevents cross-session index
      // and HEAD leakage inside a shared workspace.
      await gitRun(root, ['symbolic-ref', 'HEAD', headRef])
      await gitRun(root, ['read-tree', headRef])

      // Record the real workspace as visible S0. The previous implementation
      // only recorded S1 after the first turn, so restoring the sole checkpoint
      // matched the current files and looked like a no-op.
      const meta = await readMeta(root)
      const sess = meta.sessions[sid]
      if (!sess || !Array.isArray(sess.checkpoints) || sess.checkpoints.length === 0) {
        await checkpoint(root, sid, { trigger: 'start', turn: 0, label: 'task start · before the first agent turn', force: true })
      }
      return true
    }

    async function ensureReady(root, sid) {
      if (S.gitPath === '') S.gitPath = await resolveGit()
      const key = root + '\u0000' + sid
      if (!S.inited.has(key)) {
        await initWorkspace(root, sid)
        S.inited.add(key)
      } else {
        const headRef = 'refs/dsh-rewind/' + refSid(sid) + '/head'
        await gitRun(root, ['symbolic-ref', 'HEAD', headRef])
        await gitRun(root, ['read-tree', headRef])
      }
      return true
    }

    function parseStatus(out) {
      const entries = []
      for (const rec of out.split('\0')) {
        if (rec.length < 4) continue
        const path = rec.slice(3)
        if (!path || skipPath(path)) continue
        if (rec[0] === '?' && rec[1] === '?') entries.push({ kind: 'untracked', path })
        else entries.push({ kind: 'changed', path })
      }
      return entries
    }

    async function checkpoint(root, sid, opts) {
      const o = opts || {}
      const trigger = o.trigger || 'manual'
      const turn = o.turn || 0
      const label = o.label || ''
      const rs = refSid(sid)
      await rmFile(root, '.dsh-rewind/index.lock')
      const status = await gitRun(root, ['status', '--porcelain=v1', '-z', '-uall', '--no-renames'], { cap: 16 * 1024 * 1024 })
      const changed = []
      const untrackedAll = []
      for (const e of parseStatus(status)) { if (e.kind === 'untracked') untrackedAll.push(e.path); else changed.push(e.path) }
      const counts = new Map()
      for (const p of untrackedAll) {
        if (shouldIgnore(p)) continue
        const b = parentDir(p)
        counts.set(b, (counts.get(b) || 0) + 1)
      }
      const bigDirs = new Set()
      const skippedDirs = []
      counts.forEach((n, b) => { if (n >= MAX_DIR_FILES) { bigDirs.add(b); skippedDirs.push(b) } })
      const candidates = untrackedAll.filter((p) => !shouldIgnore(p) && !bigDirs.has(parentDir(p)))
      const skippedLarge = []
      const large = new Set()
      for (let i = 0; i < candidates.length; i += 100) {
        const chunk = candidates.slice(i, i + 100)
        const results = await Promise.allSettled(chunk.map(async (p) => {
          const t = await fs.resolve(j(root, p))
          return { p, info: await fs.stat(t) }
        }))
        for (const r of results) {
          if (r.status === 'fulfilled' && r.value && r.value.info && typeof r.value.info.size === 'number' && r.value.info.size > MAX_FILE_BYTES) {
            skippedLarge.push(r.value.p)
            large.add(r.value.p)
          }
        }
      }
      const toAdd = []
      const seen = new Set()
      for (const p of changed) if (!seen.has(p)) { seen.add(p); toAdd.push(p) }
      for (const p of candidates) if (!large.has(p) && !seen.has(p)) { seen.add(p); toAdd.push(p) }
      if (toAdd.length > 0) {
        for (let i = 0; i < toAdd.length; i += 200) await gitRun(root, ['add', '-A', '-f', '--'].concat(toAdd.slice(i, i + 200)))
      }
      const tree = (await gitRun(root, ['write-tree'])).trim()
      const headRef = 'refs/dsh-rewind/' + rs + '/head'
      const parent = await gitRun(root, ['rev-parse', '--verify', headRef]).catch(() => '')
      const headTree = parent.trim() ? (await gitRun(root, ['rev-parse', headRef + '^{tree}']).catch(() => '')).trim() : ''
      if (tree === headTree && headTree !== '' && !o.force) return { skipped: true, reason: 'worktree unchanged since last checkpoint' }
      const time = Date.now()
      const id = trigger + '-' + turn + '-' + time
      const captured = candidates.filter((p) => !large.has(p))
      const commit = await commitTree(root, tree, parent.trim() || null, { id, sessionId: sid, trigger, turn, label, files: toAdd.length, untracked: captured, skippedLarge, skippedDirs, time })
      await gitRun(root, ['update-ref', 'refs/dsh-rewind/' + rs + '/' + id, commit])
      await gitRun(root, ['update-ref', headRef, commit])
      const meta = await readMeta(root)
      let sess = meta.sessions[sid]
      if (!sess) { sess = { checkpoints: [], undo: [], redo: [] }; meta.sessions[sid] = sess }
      sess.checkpoints.push({ id, sha: commit, tree, trigger, turn, label, time, files: toAdd.length, untracked: captured, skippedLarge, skippedDirs })
      const prunable = sess.checkpoints.filter((c) => c.trigger !== 'before-restore')
      if (prunable.length > MAX_CHECKPOINTS) {
        const drop = prunable.slice(0, prunable.length - MAX_CHECKPOINTS)
        const dropIds = new Set(drop.map((c) => c.id))
        sess.checkpoints = sess.checkpoints.filter((c) => !dropIds.has(c.id))
        for (const c of drop) { try { await gitRun(root, ['update-ref', '-d', 'refs/dsh-rewind/' + rs + '/' + c.id]) } catch (e) {} }
      }
      await writeMeta(root, meta)
      return { skipped: false, checkpoint: { id, sha: commit, tree, trigger, turn, label, time, files: toAdd.length } }
    }

    function parseCommit(msg, id, sha) {
      const get = (k) => { const m = msg.match(new RegExp('^' + k + ' (.*)$', 'm')); return m ? m[1].trim() : '' }
      const arr = (k) => { try { const a = JSON.parse(get(k) || '[]'); return Array.isArray(a) ? a : [] } catch (e) { return [] } }
      return {
        id, sha,
        tree: get('tree'),
        trigger: get('trigger') || 'turn',
        turn: parseInt(get('turn'), 10) || 0,
        label: get('label'),
        time: parseInt(get('created'), 10) || 0,
        files: parseInt(get('files'), 10) || 0,
        untracked: arr('untracked'),
        skippedLarge: arr('largeFiles'),
        skippedDirs: arr('largeDirs'),
      }
    }

    async function listCheckpoints(root, sid) {
      const meta = await readMeta(root)
      const sess = meta.sessions[sid]
      if (sess && sess.checkpoints && sess.checkpoints.length > 0) return sess.checkpoints
      const rs = refSid(sid)
      let out = ''
      try { out = await gitRun(root, ['for-each-ref', '--format=%(refname)', 'refs/dsh-rewind/' + rs + '/'], { cap: 4 * 1024 * 1024 }) } catch (e) { return [] }
      const cps = []
      for (const ref of out.split('\n')) {
        if (!ref) continue
        const id = ref.slice(('refs/dsh-rewind/' + rs + '/').length)
        if (id === 'head') continue
        try {
          const sha = (await gitRun(root, ['rev-parse', '--verify', ref])).trim()
          const msg = await gitRun(root, ['cat-file', 'commit', sha])
          const cp = parseCommit(msg, id, sha)
          if (!cp.tree) cp.tree = (await gitRun(root, ['rev-parse', sha + '^{tree}'])).trim()
          cps.push(cp)
        } catch (e) {}
      }
      cps.sort((a, b) => a.time - b.time)
      if (cps.length > 0) {
        meta.sessions[sid] = { checkpoints: cps, undo: [], redo: [] }
        await writeMeta(root, meta)
      }
      return cps
    }

    async function restoreTree(root, sid, cp) {
      await rmFile(root, '.dsh-rewind/index.lock')
      await gitRun(root, ['read-tree', '--reset', '-u', cp.tree])
      await gitRun(root, ['update-ref', 'refs/dsh-rewind/' + refSid(sid) + '/head', cp.sha])
      try {
        const out = await gitRun(root, ['ls-files', '--others', '--exclude-standard', '-z'], { cap: 8 * 1024 * 1024 })
        const current = out.split('\0').filter(Boolean)
        const pre = new Set(cp.untracked || [])
        const sf = new Set(cp.skippedLarge || [])
        const sd = cp.skippedDirs || []
        const toRemove = current.filter((p) => {
          if (pre.has(p)) return false
          if (skipPath(p) || shouldIgnore(p)) return false
          if (sf.has(p)) return false
          for (const d of sd) if (p === d || p.indexOf(d + '/') === 0) return false
          return true
        })
        for (let i = 0; i < toRemove.length; i += 200) { try { await gitRun(root, ['clean', '-f', '--'].concat(toRemove.slice(i, i + 200))) } catch (e) {} }
      } catch (e) { warn('safe-clean skipped', String(e && e.message || e)) }
    }

    async function doRestore(root, sid, id) {
      // listCheckpoints also rebuilds missing metadata from durable refs.
      await listCheckpoints(root, sid)
      const meta = await readMeta(root)
      const sess = meta.sessions[sid]
      if (!sess) throw new Error('no checkpoints for this session')
      const cp = sess.checkpoints.find((c) => c.id === id)
      if (!cp) throw new Error('unknown checkpoint: ' + id)
      const before = await checkpoint(root, sid, { trigger: 'before-restore', turn: cp.turn, label: 'before restore to ' + id })
      let beforeId = ''
      if (before.skipped) beforeId = sess.checkpoints.length ? sess.checkpoints[sess.checkpoints.length - 1].id : ''
      else beforeId = before.checkpoint.id
      if (!beforeId) throw new Error('cannot build a safety checkpoint before restore')
      await restoreTree(root, sid, cp)
      const m2 = await readMeta(root)
      const s2 = m2.sessions[sid]
      if (!s2) throw new Error('session metadata missing after restore')
      s2.undo.push({ before: beforeId, after: id })
      s2.redo = []
      await writeMeta(root, m2)
      return { restored: id, before: beforeId }
    }

    async function doUndoRedo(root, sid, which) {
      const meta = await readMeta(root)
      const sess = meta.sessions[sid]
      if (!sess) throw new Error('no checkpoints for this session')
      const stack = which === 'undo' ? sess.undo : sess.redo
      if (!stack || stack.length === 0) throw new Error(which + ' stack is empty')
      const entry = stack.pop()
      const target = which === 'undo' ? entry.before : entry.after
      const cp = sess.checkpoints.find((c) => c.id === target)
      if (!cp) throw new Error('checkpoint missing from store: ' + target)
      await restoreTree(root, sid, cp)
      const other = which === 'undo' ? sess.redo : sess.undo
      other.push(entry)
      await writeMeta(root, meta)
      return { action: which, restored: target }
    }

    async function diffPreview(root, sid, id) {
      const cps = await listCheckpoints(root, sid)
      const cp = cps.find((c) => c.id === id)
      if (!cp) throw new Error('unknown checkpoint: ' + id)
      // Reverse the ordinary commit→worktree diff. A preview describes the
      // patch restore will apply (current→checkpoint), so green lines are
      // genuinely added by restore and red lines genuinely removed.
      const stat = await gitRun(root, ['diff', '-R', '--stat', cp.sha, '--'], { cap: 256 * 1024 }).catch(() => '')
      let diff = ''
      let truncated = false
      try {
        diff = await gitRun(root, ['diff', '-R', '-U3', '--no-color', cp.sha, '--'], { cap: 96 * 1024 })
      } catch (e) { diff = String(e && e.message || e) }
      if (diff.length >= 96 * 1024 - 2048) truncated = true
      return { id, label: cp.label, turn: cp.turn, time: cp.time, stat, diff, truncated }
    }

    function trackAgent(agent) {
      try {
        if (!agent || typeof agent !== 'object') return
        const sid = agent.id !== undefined ? String(agent.id) : ''
        const cwd = agent.session && agent.session.header ? agent.session.header.cwd : ''
        if (sid && cwd) S.sessionWorkspace.set(sid, cwd)
      } catch (e) {}
    }

    async function workspaceFor(sessionId) {
      const sid = String(sessionId || '')
      if (S.sessionWorkspace.has(sid)) {
        const root = S.sessionWorkspace.get(sid)
        if (root) return { root, sid }
      }
      try {
        const a = typeof agents.get === 'function' ? agents.get(sid) : undefined
        const cwd = a && a.session && a.session.header ? a.session.header.cwd : ''
        if (cwd) { S.sessionWorkspace.set(sid, cwd); return { root: cwd, sid } }
      } catch (e) {}
      return null
    }

    // ---- automatic checkpoints (every live agent) ----
    ctx.on('agent/created', (p) => { trackAgent(p && p.agent) })
    ctx.on('agent/status', (p) => { trackAgent(p && p.agent) })
    ctx.on('agent/session-start', (p) => { trackAgent(p && p.agent) })
    ctx.on('agent/inbox/claimed', (p) => {
      if (!p || !p.agent) return
      trackAgent(p.agent)
      const sid = String(p.agent.id)
      const m = p.message
      let prompt = ''
      if (m && Array.isArray(m.content)) {
        for (const b of m.content) if (b && b.type === 'text' && typeof b.text === 'string') { prompt = trunc(b.text, 90); break }
      }
      S.turnLabel.set(sid, { prompt, tools: [] })
      const root = S.sessionWorkspace.get(sid)
      if (root) {
        // Queue S0 before the model can reach its first mutating tool. In Web the
        // state poll normally initializes even earlier; this path makes headless
        // and freshly resumed sessions obey the same before/after invariant.
        void enqueue(async () => {
          await ensureReady(root, sid)
          const r = await checkpoint(root, sid, { trigger: 'turn-start', turn: p.turn || 0, label: prompt ? 'before · "' + trunc(prompt, 80) + '"' : 'before agent turn' })
          if (!r.skipped) log('turn-start checkpoint', sid, r.checkpoint.id)
        }).catch((e) => warn('turn-start checkpoint failed', sid, String(e && e.message || e)))
      }
    })
    ctx.on('tools/result', (exec) => {
      if (!exec || !exec.agent) return
      const sid = String(exec.agent.id)
      if (MUTATING_TOOLS.indexOf(exec.name) === -1) return
      const label = S.turnLabel.get(sid) || { prompt: '', tools: [] }
      const args = exec.arguments
      let trail = exec.name
      if (args && typeof args === 'object' && typeof args.file_path === 'string') trail += ':' + trunc(base(args.file_path), 24)
      label.tools.push(trail)
      if (label.tools.length > 4) label.tools.shift()
      S.turnLabel.set(sid, label)
    })
    ctx.on('agent/turn-stopping', async (p) => {
      if (!p || !p.agent) return
      trackAgent(p.agent)
      const sid = String(p.agent.id)
      const root = S.sessionWorkspace.get(sid)
      if (!root) return
      const label = S.turnLabel.get(sid)
      const parts = []
      if (label && label.prompt) parts.push('"' + trunc(label.prompt, 60) + '"')
      if (label && label.tools && label.tools.length) parts.push(label.tools.join(', '))
      const desc = trunc(parts.join(' → '), 160) || 'turn checkpoint'
      try {
        await enqueue(async () => {
          await ensureReady(root, sid)
          const r = await checkpoint(root, sid, { trigger: 'turn', turn: p.turn || 0, label: desc })
          if (!r.skipped) log('turn checkpoint', sid, r.checkpoint.id, r.checkpoint.files + ' files')
        })
      } catch (e) { warn('turn checkpoint failed', sid, String(e && e.message || e)) }
    })

    // ---- HTTP endpoints for the web client ----
    const json = (res, status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify(body))
    }
    const route = (path, handler) => {
      const register = () => webServer.register({ kind: 'exact', path, handler })
      return typeof ctx.effect === 'function' ? ctx.effect(register, 'dsh-rewind route ' + path) : register()
    }
    const params = (req) => new URL(req.url, 'http://localhost').searchParams
    const wsOr404 = async (req, res) => {
      const ws = await workspaceFor(params(req).get('session') || '')
      if (!ws) { json(res, 200, { ok: true, ready: false, reason: 'no-session', checkpoints: [], undoCount: 0, redoCount: 0 }); return null }
      return ws
    }

    route('/dsh-rewind/health', async (_req, res) => {
      json(res, 200, { ok: true, plugin: name, version, engine: 'git-shadow', automatic: ['start', 'turn-start', 'turn'] })
    })

    route('/dsh-rewind/state', async (req, res) => {
      try {
        const ws = await wsOr404(req, res)
        if (!ws) return
        await enqueue(async () => {
          await ensureReady(ws.root, ws.sid)
          const cps = await listCheckpoints(ws.root, ws.sid)
          const meta = await readMeta(ws.root)
          const sess = meta.sessions[ws.sid]
          json(res, 200, {
            ok: true, ready: true, root: ws.root, sessionId: ws.sid,
            checkpoints: cps.map((c) => ({ id: c.id, sha: c.sha, trigger: c.trigger, turn: c.turn, label: c.label, time: c.time, files: c.files })),
            undoCount: sess && sess.undo ? sess.undo.length : 0,
            redoCount: sess && sess.redo ? sess.redo.length : 0,
            error: '',
          })
        })
      } catch (e) { json(res, 500, { ok: false, message: String(e && e.message || e) }) }
    })

    route('/dsh-rewind/checkpoint', async (req, res) => {
      try {
        const ws = await wsOr404(req, res)
        if (!ws) return
        await enqueue(async () => {
          await ensureReady(ws.root, ws.sid)
          const r = await checkpoint(ws.root, ws.sid, { trigger: 'manual', turn: 0, label: 'manual checkpoint' })
          json(res, 200, r.skipped ? { ok: true, skipped: true, message: r.reason } : { ok: true, skipped: false, message: 'checkpoint ' + r.checkpoint.id + ' (' + r.checkpoint.files + ' files)' })
        })
      } catch (e) { json(res, 500, { ok: false, message: String(e && e.message || e) }) }
    })

    route('/dsh-rewind/preview', async (req, res) => {
      try {
        const ws = await wsOr404(req, res)
        if (!ws) return
        const id = params(req).get('id') || ''
        await enqueue(async () => {
          await ensureReady(ws.root, ws.sid)
          const d = await diffPreview(ws.root, ws.sid, id)
          json(res, 200, { ok: true, id: d.id, label: d.label, turn: d.turn, time: d.time, stat: d.stat, diff: d.diff, truncated: d.truncated })
        })
      } catch (e) { json(res, 500, { ok: false, message: String(e && e.message || e) }) }
    })

    route('/dsh-rewind/restore', async (req, res) => {
      try {
        const ws = await wsOr404(req, res)
        if (!ws) return
        const id = params(req).get('id') || ''
        await enqueue(async () => {
          await ensureReady(ws.root, ws.sid)
          const r = await doRestore(ws.root, ws.sid, id)
          json(res, 200, { ok: true, message: 'restored to ' + r.restored + ' (safety checkpoint ' + r.before + ')' })
        })
      } catch (e) { json(res, 500, { ok: false, message: String(e && e.message || e) }) }
    })

    route('/dsh-rewind/undo', async (req, res) => {
      try {
        const ws = await wsOr404(req, res)
        if (!ws) return
        await enqueue(async () => {
          await ensureReady(ws.root, ws.sid)
          const r = await doUndoRedo(ws.root, ws.sid, 'undo')
          json(res, 200, { ok: true, message: 'undid last rewind → ' + r.restored })
        })
      } catch (e) { json(res, 500, { ok: false, message: String(e && e.message || e) }) }
    })

    route('/dsh-rewind/redo', async (req, res) => {
      try {
        const ws = await wsOr404(req, res)
        if (!ws) return
        await enqueue(async () => {
          await ensureReady(ws.root, ws.sid)
          const r = await doUndoRedo(ws.root, ws.sid, 'redo')
          json(res, 200, { ok: true, message: 'redid → ' + r.restored })
        })
      } catch (e) { json(res, 500, { ok: false, message: String(e && e.message || e) }) }
    })

    // ---- model tool ----
    tools.register({
      name: 'rewind',
      description: REWIND_TOOL_DESCRIPTION,
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'preview', 'restore', 'undo', 'redo', 'checkpoint'], description: 'Which rewind operation to run.' },
          id: { type: 'string', description: 'Checkpoint id, required for preview and restore.' },
        },
        required: ['action'],
      },
      output: {
        schema: { type: 'string' },
        render(_args, value) { return [{ type: 'text', text: value }] },
      },
      async execute(args, exec) {
        const run = async () => {
          const agent = exec && exec.agent
          let root = ''
          let sid = ''
          try {
            if (agent) {
              if (agent.id !== undefined) sid = String(agent.id)
              if (agent.session && agent.session.header && typeof agent.session.header.cwd === 'string') root = agent.session.header.cwd
            }
          } catch (e) {}
          if (!root) return 'dsh-rewind: no workspace detected for this session yet.'
          if (agent) trackAgent(agent)
          await ensureReady(root, sid)
          const action = args && args.action ? String(args.action) : 'list'
          const id = args && args.id ? String(args.id) : ''
          if (action === 'list') {
            const cps = await listCheckpoints(root, sid)
            if (cps.length === 0) return 'No checkpoints yet for workspace ' + root + '. A checkpoint is created after each agent turn that changes files.'
            const lines = cps.map((c, i) => '[' + i + '] ' + c.id + '  turn ' + c.turn + '  ' + (c.label || '') + '  ' + c.files + ' files  ' + iso(c.time))
            return 'Checkpoints for ' + root + ' (' + cps.length + '):\n' + lines.join('\n') + '\nUse action:"preview" with a checkpoint id to see the diff that restoring it would apply.'
          }
          if (action === 'checkpoint') {
            const r = await checkpoint(root, sid, { trigger: 'manual', turn: 0, label: 'manual checkpoint' })
            return r.skipped ? 'Skipped: ' + r.reason : 'Checkpoint ' + r.checkpoint.id + ' created (' + r.checkpoint.files + ' files).'
          }
          if (action === 'preview') {
            if (!id) return 'action:"preview" needs the checkpoint id argument.'
            const d = await diffPreview(root, sid, id)
            if (!d.diff && !d.stat) return 'Checkpoint ' + id + ' matches the current workspace - nothing would change.'
            return 'Restoring ' + id + ' would apply:\n' + (d.stat || '') + '\n' + (d.diff ? d.diff + (d.truncated ? '\n… diff truncated' : '') : '')
          }
          if (action === 'restore') {
            if (!id) return 'action:"restore" needs the checkpoint id argument.'
            const r = await doRestore(root, sid, id)
            return 'Workspace restored to ' + r.restored + '. Safety checkpoint: ' + r.before + '. Use action:"undo" to revert this restore.'
          }
          if (action === 'undo' || action === 'redo') {
            const r = await doUndoRedo(root, sid, action)
            return (action === 'undo' ? 'Undid last rewind → ' : 'Redid → ') + r.restored
          }
          return 'Unknown action: ' + action
        }
        try { return await enqueue(run) } catch (e) { return 'dsh-rewind error: ' + String(e && e.message || e) }
      },
    })
}

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../dsh/index.js'

function subprocess() {
  return {
    async resolveExecutable(name) { return name },
    spawn(spec) {
      let stdout = ''
      let stderr = ''
      const child = spawn(spec.argv[0], spec.argv.slice(1), {
        cwd: spec.cwd,
        env: { ...process.env, ...(spec.env || {}) },
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      child.stdout.on('data', chunk => { stdout += chunk })
      child.stderr.on('data', chunk => { stderr += chunk })
      if (spec.stdio.stdin && typeof spec.stdio.stdin === 'object') child.stdin.end(spec.stdio.stdin.data)
      else child.stdin.end()
      return {
        collected: {
          stdout: { readFrom: () => ({ text: stdout, lossy: false }) },
          stderr: { readFrom: () => ({ text: stderr, lossy: false }) },
        },
        done: new Promise((resolve, reject) => {
          child.once('error', reject)
          child.once('close', exitCode => resolve({ exitCode }))
        }),
      }
    },
  }
}

function harness() {
  const events = new Map()
  let rewindTool
  const routes = new Map()
  const ctx = {
    subprocess: subprocess(),
    fs: {
      async resolve(path) { return { targetKey: path, displayPath: path } },
      async stat(target) {
        try {
          const value = await stat(target.targetKey)
          return { type: value.isDirectory() ? 'directory' : value.isFile() ? 'file' : 'other', size: value.size }
        } catch { return undefined }
      },
    },
    tools: { register(tool) { rewindTool = tool; return () => {} } },
    webServer: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path) } },
    agents: { list() { return [] }, get() { return undefined } },
    on(name, handler) {
      const list = events.get(name) || []
      list.push(handler)
      events.set(name, list)
      return () => {}
    },
  }
  apply(ctx)
  return { events, routes, get tool() { return rewindTool } }
}

async function emit(h, name, payload) {
  for (const handler of h.events.get(name) || []) await handler(payload)
}

async function call(h, agent, action, id = '') {
  return await h.tool.execute({ action, ...(id ? { id } : {}) }, { agent })
}

function ids(text) {
  return [...text.matchAll(/^\[\d+\] (\S+)/gm)].map(match => match[1])
}

test('captures S0, restores the first turn, and supports undo', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-rewind-test-'))
  try {
    const file = join(root, 'app.txt')
    await writeFile(file, 'before\n')
    const h = harness()
    const agent = { id: 'session-a', session: { header: { cwd: root } } }

    await emit(h, 'agent/inbox/claimed', { agent, turn: 1, message: { content: [{ type: 'text', text: 'change app' }] } })
    const start = await call(h, agent, 'list')
    const startIds = ids(start)
    assert.equal(startIds.length, 1)
    assert.match(startIds[0], /^start-/)

    await writeFile(file, 'after\n')
    await emit(h, 'agent/turn-stopping', { agent, turn: 1 })
    const after = await call(h, agent, 'list')
    assert.equal(ids(after).length, 2)

    const preview = await call(h, agent, 'preview', startIds[0])
    assert.match(preview, /-after/)
    assert.match(preview, /\+before/)

    await call(h, agent, 'restore', startIds[0])
    assert.equal(await readFile(file, 'utf8'), 'before\n')
    await call(h, agent, 'undo')
    assert.equal(await readFile(file, 'utf8'), 'after\n')

    await rm(join(root, '.dsh-rewind', 'meta.json'))
    assert.ok(ids(await call(h, agent, 'list')).length >= 2)
    await call(h, agent, 'restore', startIds[0])
    assert.equal(await readFile(file, 'utf8'), 'before\n')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('keeps independent session timelines in one workspace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-rewind-sessions-'))
  try {
    await writeFile(join(root, 'value.txt'), 'one\n')
    const h = harness()
    const a = { id: 'session-a', session: { header: { cwd: root } } }
    const b = { id: 'session-b', session: { header: { cwd: root } } }
    assert.equal(ids(await call(h, a, 'list')).length, 1)
    await writeFile(join(root, 'value.txt'), 'two\n')
    assert.equal(ids(await call(h, b, 'list')).length, 1)
    assert.equal(ids(await call(h, a, 'list')).length, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

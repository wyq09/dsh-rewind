import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../client/client.js', import.meta.url), 'utf8')

test('header controls stop pointerdown before the draggable header', () => {
  assert.match(source, /rw-head-actions[^\n]+onPointerDown: \(e\) => e\.stopPropagation\(\)/)
  assert.match(source, /e\.target\.closest\('button'\)/)
})

test('visible controls use SVG icons instead of emoji glyphs', () => {
  assert.match(source, /function Icon\(props\)/)
  assert.doesNotMatch(source, /[⏪📸⚠↩↪↺⟳]/u)
  for (const name of ['rewind', 'refresh', 'minimize', 'close', 'camera', 'undo', 'redo', 'restore', 'alert']) {
    assert.match(source, new RegExp('\\n\\s+' + name + ': \\['))
  }
})

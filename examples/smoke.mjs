// Smoke test for the published package: mount apply() on a fake Cordis ctx,
// then exercise vps_list and vps_exec against the real ledger and the real
// orca target. Run: node smoke.mjs
import { apply } from '../src/index.js'

const registered = []
const fakeCtx = {
  config: {},
  tools: { register: (tool) => registered.push(tool) },
}

apply(fakeCtx)
console.log('registered tools:', registered.map((t) => t.name).join(', '))

const byName = (n) => registered.find((t) => t.name === n)

// 1) vps_list — reads the real ledger at ~/.dsh/vpshub-targets.json
const list = await byName('vps_list').execute({})
console.log('\n[vps_list] count =', list.count)
console.log('targets:', list.targets.map((t) => `${t.label} (${t.host}) source=${t.source}`).join(' | '))

// 2) vps_exec — real read-only command on the first online target
const target = list.targets[0]
if (target) {
  const res = await byName('vps_exec').execute({ id: target.id, command: 'uname -s && hostname', timeoutMs: 20000 })
  console.log('\n[vps_exec] exit =', res.exitCode, 'ok =', res.ok)
  console.log('stdout:', res.stdout.trim())
  console.log('stderr:', res.stderr.trim() || '(empty)')
} else {
  console.log('\n[vps_exec] skipped: no targets')
}
console.log('\nSMOKE DONE')

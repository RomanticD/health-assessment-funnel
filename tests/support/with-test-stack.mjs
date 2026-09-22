import { spawn, spawnSync } from 'node:child_process'

const mode = process.argv[2]
if (!['integration', 'e2e', 'all'].includes(mode)) {
  throw new Error('Usage: node tests/support/with-test-stack.mjs <integration|e2e|all>')
}

const host = '127.0.0.1'
const port = '3110'
const appOrigin = `http://${host}:${port}`
const supabaseExclude = [
  'realtime',
  'storage-api',
  'imgproxy',
  'mailpit',
  'postgres-meta',
  'studio',
  'edge-runtime',
  'logflare',
  'vector',
  'supavisor',
].join(',')

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    env: process.env,
  })

  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    const output = options.capture ? `${result.stdout ?? ''}${result.stderr ?? ''}` : ''
    throw new Error(`${command} ${args.join(' ')} failed with exit ${result.status}.\n${output}`)
  }
  return result.stdout ?? ''
}

function supabase(args, options = {}) {
  return run('pnpm', ['exec', 'supabase', ...args], options)
}

function parseEnv(text) {
  const values = {}
  for (const line of text.split(/\r?\n/u)) {
    const match = /^([A-Z][A-Z0-9_]*)=(?:"([^"]*)"|(.*))$/u.exec(line.trim())
    if (match !== null) values[match[1]] = match[2] ?? match[3] ?? ''
  }
  return values
}

function readLocalEnvironment() {
  return parseEnv(supabase(['status', '-o', 'env'], { capture: true }))
}

function hasRequiredEnvironment(environment) {
  return (
    environment.API_URL !== undefined &&
    (environment.SECRET_KEY !== undefined || environment.SERVICE_ROLE_KEY !== undefined) &&
    (environment.PUBLISHABLE_KEY !== undefined || environment.ANON_KEY !== undefined)
  )
}

function ensureSupabase() {
  let environment
  try {
    environment = readLocalEnvironment()
  } catch {
    environment = undefined
  }

  // A previously started ultra-minimal stack can omit Auth and therefore omit
  // the current local publishable/secret credentials from `supabase status`.
  if (environment !== undefined && !hasRequiredEnvironment(environment)) {
    supabase(['stop', '--no-backup', '--yes'])
    environment = undefined
  }

  if (environment === undefined) {
    // `supabase start` prints local credentials; capture them so CI logs do
    // not turn even disposable development keys into copied artifacts.
    supabase(['start', '--exclude', supabaseExclude, '--yes'], { capture: true })
    environment = readLocalEnvironment()
  }

  if (!hasRequiredEnvironment(environment)) {
    throw new Error(
      'Supabase started, but its API URL and local publishable/secret keys were not reported.',
    )
  }

  supabase(['db', 'reset', '--local', '--yes'])
  return environment
}

async function waitForApp(child, output) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Next.js exited before becoming ready.\n${output.join('')}`)
    }
    try {
      const response = await fetch(`${appOrigin}/api/health`, { signal: AbortSignal.timeout(1000) })
      if (response.ok) return
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Next.js did not become ready within 60 seconds.\n${output.join('')}`)
}

function runTestCommand(command, args, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: environment,
      stdio: 'inherit',
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} failed (${signal ?? `exit ${code ?? 'unknown'}`}).`))
    })
  })
}

const local = ensureSupabase()
const testEnvironment = {
  ...process.env,
  APP_ORIGIN: appOrigin,
  SUPABASE_URL: local.API_URL,
  SUPABASE_SECRET_KEY: local.SECRET_KEY ?? local.SERVICE_ROLE_KEY,
  TEST_SUPABASE_PUBLISHABLE_KEY: local.PUBLISHABLE_KEY ?? local.ANON_KEY,
  TEST_API_BASE_URL: appOrigin,
  NODE_ENV: 'development',
}

const nextOutput = []
const next = spawn('pnpm', ['exec', 'next', 'dev', '--hostname', host, '--port', port], {
  cwd: process.cwd(),
  env: testEnvironment,
  stdio: ['ignore', 'pipe', 'pipe'],
})

const captureOutput = (chunk) => {
  nextOutput.push(chunk.toString())
  if (nextOutput.length > 200) nextOutput.shift()
}
next.stdout.on('data', captureOutput)
next.stderr.on('data', captureOutput)

let stopping = false
async function stopNext() {
  if (stopping || next.exitCode !== null) return
  stopping = true
  next.kill('SIGTERM')
  await Promise.race([
    new Promise((resolve) => next.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ])
  if (next.exitCode === null) next.kill('SIGKILL')
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    void stopNext().finally(() => process.exit(130))
  })
}

try {
  await waitForApp(next, nextOutput)
  if (mode === 'integration' || mode === 'all') {
    await runTestCommand(
      'pnpm',
      ['exec', 'vitest', 'run', '--config', 'vitest.integration.config.mts'],
      testEnvironment,
    )
  }
  if (mode === 'e2e' || mode === 'all') {
    await runTestCommand('pnpm', ['exec', 'playwright', 'test'], testEnvironment)
  }
} catch (error) {
  process.exitCode = 1
  console.error(error instanceof Error ? error.message : error)
  if (nextOutput.length > 0) {
    console.error('\nRecent Next.js output:\n' + nextOutput.join(''))
  }
} finally {
  await stopNext()
}

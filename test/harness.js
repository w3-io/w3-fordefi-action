/**
 * Runs the action as the runner does, against a stand-in for ForDefi.
 *
 * A step's contract with its consumer is which outputs exist when it fails,
 * and that is decided in the entry point, not in a function a unit test can
 * call. So the action runs as a child process against a local HTTP server,
 * and the outputs are read from the file the runner would read.
 */

import { spawn } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ENTRY = fileURLToPath(new URL('../src/index.js', import.meta.url))

/** Parse the runner's output file: `name<<delim\nvalue\ndelim` records. */
function parseOutputs(text) {
  const out = {}
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const m = /^([^<]+)<<(.+)$/.exec(lines[i])
    if (!m) continue
    const value = []
    for (i++; i < lines.length && lines[i] !== m[2]; i++) value.push(lines[i])
    out[m[1]] = value.join('\n')
  }
  return out
}

/**
 * Start the stand-in. `run(inputs, response)` runs the action once with
 * `inputs` (an `undefined` value leaves the input unset) and answers every
 * request with `response` (`{ status, json, headers?, delayMs?, stallBody? }`:
 * `delayMs` holds the whole answer back, `stallBody` sends the headers and
 * then never finishes the body), or with `response(n)` for the n-th request. It
 * resolves to the exit code, stdout, the step outputs and the requests the
 * stand-in received. `close()` stops the server.
 */
export async function startStandIn() {
  const pem = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({
    type: 'pkcs8',
    format: 'pem',
  })
  const dir = mkdtempSync(join(tmpdir(), 'fordefi-action-'))
  let requests = []
  let respond = () => ({ status: 500, json: {} })
  let runs = 0

  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, headers: req.headers, body })
      const { status, json, headers, delayMs = 0, stallBody = false } = respond(requests.length)
      const answer = () => {
        // A zero retry-after keeps a retried attempt from waiting out the
        // backoff, unless the response sets its own.
        res.writeHead(status, {
          'content-type': 'application/json',
          'retry-after': '0',
          ...headers,
        })
        if (stallBody) {
          res.write(JSON.stringify(json).slice(0, 1))
          return
        }
        res.end(JSON.stringify(json))
      }
      // Unreferenced, so an answer still held back when the tests end does
      // not keep the process alive.
      if (delayMs) setTimeout(answer, delayMs).unref()
      else answer()
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const baseUrl = `http://127.0.0.1:${server.address().port}`

  async function run(inputs, response) {
    requests = []
    respond = typeof response === 'function' ? response : () => response
    const outputFile = join(dir, `out-${runs++}`)
    writeFileSync(outputFile, '')
    const env = { PATH: process.env.PATH, GITHUB_OUTPUT: outputFile }
    const all = { 'access-token': 'jwt', 'private-key': pem, 'api-url': baseUrl, ...inputs }
    for (const [k, v] of Object.entries(all)) {
      if (v !== undefined) env[`INPUT_${k.toUpperCase()}`] = v
    }
    const child = spawn(process.execPath, [ENTRY], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    child.stdout.on('data', (c) => (stdout += c))
    const code = await new Promise((r) => child.on('close', r))
    return { code, stdout, requests, outputs: parseOutputs(readFileSync(outputFile, 'utf8')) }
  }

  async function close() {
    server.closeAllConnections()
    await new Promise((r) => server.close(r))
    rmSync(dir, { recursive: true, force: true })
  }

  return { run, close }
}

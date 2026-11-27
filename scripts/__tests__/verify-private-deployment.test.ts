import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  new URL("../../.github/workflows/pipeline.yml", import.meta.url),
  "utf8",
);
const block = workflow.match(/ {8}python3 - <<'PY'\n([\s\S]*?)\n {8}PY/);
if (!block?.[1]) throw new Error("Private deployment verifier not found");
const verifier = block[1]
  .split("\n")
  .map((line) => line.slice(8))
  .join("\n");

const fixture = `
import io, json, os, subprocess, sys, time, urllib.error, urllib.request
scenario = sys.argv[1]
source = 'a' * 40
digest = 'sha256:' + 'b' * 64
reference = 'ghcr.io/nocoo/pew@' + digest
os.environ['IMAGE_SHA'] = source
release = {'service':'web', 'image':'ghcr.io/nocoo/pew', 'sourceSha':source, 'digest':digest}
if scenario == 'manifest': release['image'] = 'ghcr.io/nocoo/other'
if scenario == 'service': release['service'] = 'other'
if scenario == 'source': release['sourceSha'] = 'c' * 40
if scenario == 'mutable': release['digest'] = 'latest'
os.environ['RELEASE_IMAGES'] = json.dumps([release])
if scenario == 'empty': os.environ['RELEASE_IMAGES'] = '[]'
if scenario == 'malformed': os.environ['RELEASE_IMAGES'] = 'null'
if scenario == 'sha': os.environ['IMAGE_SHA'] = 'main'
image = {'Id':'image-id', 'RepoDigests':[reference], 'Config':{'Labels':{'org.opencontainers.image.revision':source, 'org.opencontainers.image.source':'https://github.com/nocoo/pew'}}}
container = {'Image':'image-id', 'Config':{'Image':reference, 'Env':['PORT=7020']}, 'State':{'Running':True}}
if scenario == 'e2e-env': container['Config']['Env'].append('E2E_SKIP_AUTH=sensitive fixture body or env')
if scenario == 'e2e-empty': container['Config']['Env'].append('E2E_TEST_USER_ID=')
if scenario == 'node-options': container['Config']['Env'].append('NODE_OPTIONS=sensitive fixture body or env')
if scenario == 'digest': container['Config']['Image'] = 'wrong'
if scenario == 'id': container['Image'] = 'wrong'
if scenario == 'repo-digest': image['RepoDigests'] = []
if scenario == 'revision': image['Config']['Labels']['org.opencontainers.image.revision'] = 'c' * 40
if scenario == 'source-label': image['Config']['Labels']['org.opencontainers.image.source'] = 'wrong'
if scenario == 'stopped': container['State']['Running'] = False
def command(args, **kwargs):
    if args == ['docker','image','inspect',reference]: return json.dumps([image])
    if args == ['docker','inspect','pew-app']: return json.dumps([container])
    if args[:5] == ['docker','exec','pew-app','node','-p']:
        assert args[5] == "JSON.parse(require('fs').readFileSync('/app/packages/web/package.json')).version"
        return 'invalid' if scenario == 'package' else '3.4.0'
    raise AssertionError('Unexpected command')
subprocess.check_output = command
time.sleep = lambda seconds: None
seen = []
class Response:
    def __init__(self, status, headers, body): self.status, self.headers, self.body = status, headers, body
    def read(self): return self.body
class Opener:
    def __init__(self, handler): self.handler = handler
    def open(self, req, **kwargs):
        assert req.get_header('Host') == 'pew.md'
        assert req.get_header('X-forwarded-proto') == 'https'
        assert req.full_url.startswith('http://127.0.0.1:17020/')
        assert req.get_header('Authorization') is None
        path = req.full_url.removeprefix('http://127.0.0.1:17020')
        seen.append((path, req.method))
        if path == '/api/live':
            if scenario == 'timeout': raise TimeoutError('sensitive fixture body or env')
            if scenario == 'redirect':
                redirect = self.handler.redirect_request(req, None, 302, 'redirect', {}, 'https://pew.md/api/live')
                if redirect is None:
                    raise urllib.error.HTTPError(req.full_url, 302, 'redirect', {}, io.BytesIO(b'sensitive fixture body or env'))
            data = {'status':'ok', 'component':'dashboard', 'version':'3.4.0', 'database':{'connected':True}}
            if scenario == 'version': data['version'] = '0.0.0'
            if scenario == 'component': data['component'] = 'other'
            if scenario == 'health': data['status'] = 'error'
            if scenario == 'database': data['database']['connected'] = False
            body = b'sensitive fixture body or env' if scenario == 'json' else json.dumps(data).encode()
            return Response(503 if scenario == 'status' else 200, {'Cache-Control':'max-age=60' if scenario == 'cache' else 'no-store'}, body)
        if path in ['/', '/login', '/privacy']:
            return Response(302 if scenario == 'page' else 200, {'Content-Type':'text/html'}, b'<html>sensitive fixture body or env</html>')
        if path == '/logo-80.png': return Response(404 if scenario == 'asset' else 200, {'Content-Type':'image/png'}, b'png')
        if path == '/api/leaderboard?limit=1':
            data = {} if scenario == 'leaderboard' else {'entries':[], 'scope':'global'}
            return Response(200, {}, json.dumps(data).encode())
        if path == '/api/devices': return Response(200 if scenario == 'private' else 401, {}, b'{}')
        if path in ['/api/ingest', '/api/ingest/sessions', '/api/ingest/evidence', '/api/ingest/details']:
            assert req.method == 'POST' and req.data == b''
            assert req.get_header('X-pew-client-version') is None
            return Response(201 if scenario == 'write' else 401, {}, b'sensitive fixture body or env')
        raise AssertionError('Unexpected request')
def build_opener(*handlers):
    assert any(isinstance(h, urllib.request.ProxyHandler) and h.proxies == {} for h in handlers)
    return Opener(next(h for h in handlers if isinstance(h, urllib.request.HTTPRedirectHandler)))
urllib.request.build_opener = build_opener
exec(compile(sys.stdin.read(), 'private-deployment-verifier', 'exec'))
if scenario == 'valid':
    assert all((path, 'POST') in seen for path in ['/api/ingest', '/api/ingest/sessions', '/api/ingest/evidence', '/api/ingest/details'])
    assert all((path, 'GET') in seen for path in ['/', '/login', '/privacy', '/logo-80.png', '/api/leaderboard?limit=1', '/api/devices'])
`;

function run(code: string, scenario: string) {
  return spawnSync("python3", ["-c", fixture, scenario], {
    input: code,
    encoding: "utf8",
    timeout: 10_000,
  });
}

type ScenarioResult = { status: number; stdout: string; stderr: string };

const batchDriver = `
import contextlib, io, json, os, subprocess, sys, time, urllib.request
scenarios = json.loads(sys.argv[1])
code = sys.stdin.read()
harness = ${JSON.stringify(fixture)}
base_env = os.environ.copy()
orig_check_output = subprocess.check_output
orig_sleep = time.sleep
orig_build_opener = urllib.request.build_opener
orig_argv = list(sys.argv)
results = {}
for scenario in scenarios:
    os.environ.clear()
    os.environ.update(base_env)
    sys.argv = ['private-deployment-verifier', scenario]
    out, err = io.StringIO(), io.StringIO()
    status = 0
    ns = {'__name__': '__main__'}
    def run_scenario():
        ns_code = code
        old_stdin = sys.stdin
        sys.stdin = io.StringIO(ns_code)
        try:
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                exec(compile(harness, 'fixture-harness', 'exec'), ns)
        finally:
            sys.stdin = old_stdin
    try:
        run_scenario()
    except SystemExit as e:
        if e.code is None:
            status = 0
        elif isinstance(e.code, int):
            status = e.code
        else:
            status = 1
            err.write(str(e.code))
    except Exception as e:
        status = 1
        err.write(repr(e))
    finally:
        subprocess.check_output = orig_check_output
        time.sleep = orig_sleep
        urllib.request.build_opener = orig_build_opener
        sys.argv = orig_argv
    results[scenario] = {'status': status, 'stdout': out.getvalue(), 'stderr': err.getvalue()}
os.environ.clear()
os.environ.update(base_env)
print(json.dumps(results))
`;

const SCENARIOS = [
  "valid",
  "manifest",
  "service",
  "source",
  "mutable",
  "empty",
  "malformed",
  "sha",
  "digest",
  "id",
  "repo-digest",
  "revision",
  "source-label",
  "stopped",
  "e2e-env",
  "e2e-empty",
  "node-options",
  "package",
  "redirect",
  "json",
  "timeout",
  "version",
  "component",
  "health",
  "database",
  "cache",
  "status",
  "page",
  "asset",
  "leaderboard",
  "private",
  "write",
] as const;

let batchCache: Map<string, ScenarioResult> | null = null;

function runBatch(code: string, scenarios: readonly string[]): Map<string, ScenarioResult> {
  if (batchCache) return batchCache;
  const res = spawnSync("python3", ["-c", batchDriver, JSON.stringify(scenarios)], {
    input: code,
    encoding: "utf8",
    timeout: 15_000,
  });
  expect(res.error).toBeUndefined();
  expect(res.status, res.stderr).toBe(0);
  const parsed = JSON.parse(res.stdout) as Record<string, ScenarioResult>;
  batchCache = new Map(Object.entries(parsed));
  return batchCache;
}

describe("private deployment verifier behavior", () => {
  it("detects a weakened redirect policy with a positive mutation control", () => {
    const weakened = verifier.replace("return None", "return req");
    expect(weakened).not.toBe(verifier);
    const result = run(weakened, "redirect");
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Private Pew acceptance passed");
  });

  it.each(SCENARIOS)("fails closed for %s unless every private-origin check passes", (scenario) => {
    const result = runBatch(verifier, SCENARIOS).get(scenario);
    expect(result).toBeDefined();
    expect(result?.status === 0).toBe(scenario === "valid");
    expect(Boolean(result?.stdout.includes("Private Pew acceptance passed"))).toBe(
      scenario === "valid",
    );
    expect((result?.stdout ?? "") + (result?.stderr ?? "")).not.toContain(
      "sensitive fixture body or env",
    );
  });
});

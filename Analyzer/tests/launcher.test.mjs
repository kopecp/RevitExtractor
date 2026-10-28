import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const launcher = fileURLToPath(new URL('../public/downloads/Start-RevitExport-2026.ps1', import.meta.url));
const shell = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
const available = spawnSync(shell, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'], { encoding: 'utf8' }).status === 0;
const quote = value => `'${value.replaceAll("'", "''")}'`;

test('launcher defaults, custom index and cancellation never need a live Revit process', { skip: !available }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'revit-launcher-test-'));
  try {
    const revit = path.join(root, 'Fake Revit 2026');
    await fs.mkdir(path.join(revit, 'RevitExtractor'), { recursive: true });
    await fs.writeFile(path.join(revit, 'RevitExtractor/RevitExtractor.exe'), 'TEST STUB - NOT EXECUTABLE');
    await fs.writeFile(path.join(revit, 'Revit.exe'), 'TEST STUB - NOT EXECUTABLE');
    const model = path.join(root, 'Model with spaces.rvt');
    await fs.writeFile(model, 'TEST MODEL');
    const custom = path.join(root, 'custom.json');
    const customBytes = Buffer.from('\uFEFF{"metadata":{"parameters":{"derivative_type":{"3dviewing":{"view_unique_ids":["only-this-view"]}}}}}\r\n');
    await fs.writeFile(custom, customBytes);
    const bad = path.join(root, 'bad.json'); await fs.writeFile(bad, '{broken');
    const schema = path.join(root, 'schema.json'); await fs.writeFile(schema, '{}');

    async function run(name, args = '', answers = ['', 'T']) {
      const output = path.join(root, name);
      const wrapper = path.join(root, `${name}.ps1`);
      // Fake installation/version/process: the test must never execute Autodesk binaries.
      // All filesystem writes remain in this temporary fixture.
      await fs.writeFile(wrapper, `
$ErrorActionPreference = 'Stop'
$global:answers = [Collections.Generic.Queue[string]]::new()
${answers.map(answer => `$global:answers.Enqueue(${quote(answer)})`).join('\n')}
function Read-Host { param($Prompt); if (!$global:answers.Count) { throw "Unexpected prompt: $Prompt" }; return $global:answers.Dequeue() }
function Get-Item { param($LiteralPath); return [pscustomobject]@{VersionInfo=[pscustomobject]@{ProductVersion='2026.7.2.16'}} }
function Start-Process {
  param($FilePath,$ArgumentList,$WorkingDirectory,[switch]$Wait,[switch]$PassThru,$WindowStyle,$RedirectStandardOutput,$RedirectStandardError)
  if ($FilePath -ne ${quote(path.join(revit, 'RevitExtractor/RevitExtractor.exe'))}) { throw 'Unexpected executable' }
  $runIndex = [regex]::Match($ArgumentList, '^"([^"]+)"').Groups[1].Value
  if (!(Test-Path -LiteralPath $runIndex)) { throw 'index.json must exist before process start' }
  $runRoot = Split-Path -Parent $runIndex
  [IO.File]::WriteAllText((Join-Path $runRoot 'arguments.txt'), $ArgumentList)
  [IO.File]::WriteAllText((Join-Path $runRoot 'output/bubble.json'), '{"type":"design"}')
  [void][IO.Directory]::CreateDirectory((Join-Path $runRoot 'output/Resource'))
  [IO.File]::WriteAllText($RedirectStandardOutput, 'Success Jobs: 1, Failed Jobs: 0')
  [IO.File]::WriteAllText($RedirectStandardError, '')
  return [pscustomobject]@{ExitCode=0}
}
& ${quote(launcher)} -ModelPath ${quote(model)} -RevitDirectory ${quote(revit)} -OutputParent ${quote(output)} -NoPause ${args}
exit $LASTEXITCODE
`, 'utf8');
      const result = spawnSync(shell, ['-NoProfile', '-File', wrapper], { encoding: 'utf8', timeout: 30000 });
      if (result.error) throw result.error;
      return { ...result, output };
    }
    const defaultRun = await run('default-enter');
    assert.equal(defaultRun.status, 0, defaultRun.stdout + defaultRun.stderr);
    const [runName] = await fs.readdir(defaultRun.output);
    const runRoot = path.join(defaultRun.output, runName);
    const bytes = await fs.readFile(path.join(runRoot, 'index.json'));
    assert.notDeepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'Default JSON must be UTF-8 without BOM');
    assert.deepEqual(JSON.parse(bytes), { metadata: { parameters: { derivative_type: { '2dviewing': {}, '3dviewing': {}, properties_data: { pdb: true } } } } });
    const argsText = await fs.readFile(path.join(runRoot, 'arguments.txt'), 'utf8');
    const args = [...argsText.matchAll(/"([^"]*)"/g)].map(match => match[1]);
    // Windows may expand an 8.3 temporary path when resolving OutputParent.
    assert.equal(await fs.realpath(args[0]), await fs.realpath(path.join(runRoot, 'index.json')));
    assert.equal(await fs.realpath(args[1]), await fs.realpath(model));
    assert.equal(args[2], '-RCEPath'); assert.equal(args[4], '-LogPath'); assert.equal(args[6], '-journalPath');

    const customRun = await run('custom', `-IndexPath ${quote(custom)}`, ['T']);
    assert.equal(customRun.status, 0, customRun.stdout + customRun.stderr);
    const [customName] = await fs.readdir(customRun.output);
    assert.deepEqual(await fs.readFile(path.join(customRun.output, customName, 'index.json')), customBytes);
    assert.deepEqual(await fs.readFile(custom), customBytes, 'Source index must not change');

    for (const [name, args, answers, expected] of [
      ['validate-default', '-ValidateOnly', [], 0],
      ['validate-explicit', '-UseDefaultIndex -ValidateOnly', [], 0],
      ['validate-custom', `-IndexPath ${quote(custom)} -ValidateOnly`, [], 0],
      ['cancel-confirmation', '', ['', 'N'], 0],
      ['cancel-index', '', ['Q'], 1],
      ['invalid-json', `-IndexPath ${quote(bad)} -ValidateOnly`, [], 1],
      ['invalid-schema', `-IndexPath ${quote(schema)} -ValidateOnly`, [], 1],
      ['missing-index', `-IndexPath ${quote(path.join(root, 'missing.json'))} -ValidateOnly`, [], 1],
      ['conflict', `-IndexPath ${quote(custom)} -UseDefaultIndex`, [], 1]
    ]) {
      const result = await run(name, args, answers);
      assert.equal(result.status, expected, `${name}: ${result.stdout}${result.stderr}`);
      await assert.rejects(fs.access(result.output), `${name} must not create output or invoke the exporter`);
    }
  } finally {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('revit-launcher-test-'));
    await fs.rm(root, { recursive: true, force: true });
  }
});

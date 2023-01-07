import * as child_process from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

/**
 * compilePolicyWasm compiles a string containing an OPA policy to a WASM binary.
 *
 * @param regoSource OPA Rego policy source code
 * @returns Buffer containing WASM binary module
 */
export const compilePolicyWasm = async (
  regoSource: string
): Promise<Buffer> => {
  const origcwd = process.cwd();
  const tempdir = await fs.mkdtemp((await fs.realpath(os.tmpdir())) + path.sep);
  try {
    process.chdir(tempdir);
    await fs.writeFile('policy.rego', regoSource);
    child_process.execFileSync(
      'opa',
      ['build', '-t', 'wasm', '-e', 'authmerge/allow', 'policy.rego'],
      {
        cwd: tempdir,
        stdio: 'inherit',
      }
    );
    child_process.execFileSync(
      'tar',
      ['-xvf', 'bundle.tar.gz', '/policy.wasm'],
      {
        cwd: tempdir,
      }
    );
    return await fs.readFile('policy.wasm');
  } finally {
    process.chdir(origcwd);
    await fs.rm(tempdir, {recursive: true, force: true});
  }
};

export const allowAllRego = `
package authmerge

default allow := true
`;

export const testPolicyPath = path.join(__dirname, 'policies');

const main = async () => {
  const regoFiles = await fs.readdir(testPolicyPath);
  const compileFile = async (sourcePath: string): Promise<void> => {
    const sourceContents = await fs.readFile(sourcePath);
    const compiledWasm = await compilePolicyWasm(
      sourceContents.toString('utf-8')
    );
    const destPath = path.join(sourcePath.replace(/\.rego$/, '.wasm'));
    await fs.writeFile(destPath, compiledWasm);
  };
  for (const sourceFilename of regoFiles) {
    if (!sourceFilename.match(/\.rego$/)) {
      continue;
    }
    await compileFile(path.join(testPolicyPath, sourceFilename));
  }
};

process.exitCode = 1;
main()
  .then(() => {
    process.exitCode = 0;
  })
  .catch(err => {
    console.log('failed', err);
  });

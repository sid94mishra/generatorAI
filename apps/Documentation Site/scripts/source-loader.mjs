import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';

export const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const repo = path.resolve(site, '../..');
const cache = new Map();

// Used only for the repository's pure token/schema modules. It neither builds
// product packages nor writes transpiled files into the product tree.
export function loadSource(relativePath) {
  let filename = path.resolve(repo, relativePath);
  if (filename.endsWith('.js') && fs.existsSync(filename.replace(/\.js$/, '.ts'))) filename = filename.replace(/\.js$/, '.ts');
  if (!path.extname(filename)) filename += '.ts';
  if (!filename.startsWith(repo + path.sep)) throw new Error('Source escaped repository');
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = {exports: {}};
  cache.set(filename, module);
  const nativeRequire = createRequire(filename);
  const requireSource = id => id.startsWith('.') ? loadSource(path.resolve(path.dirname(filename), id)) : nativeRequire(id);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}, fileName: filename,
  }).outputText;
  vm.runInThisContext(`(function(exports, require, module, __filename, __dirname){${code}\n})`, {filename})(module.exports, requireSource, module, filename, path.dirname(filename));
  return module.exports;
}

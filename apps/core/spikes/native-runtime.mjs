import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import process from 'node:process';

import keyring from '@napi-rs/keyring';
import serializePackage from '@xterm/addon-serialize';
import headlessPackage from '@xterm/headless';
import pty from 'node-pty';
import { Language, Parser } from 'web-tree-sitter';

const require = createRequire(import.meta.url);
const { Entry } = keyring;
const { SerializeAddon } = serializePackage;
const { Terminal } = headlessPackage;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function verifySqlite() {
  const database = new DatabaseSync(':memory:');
  try {
    database.exec('CREATE TABLE spike (value TEXT NOT NULL)');
    database.prepare('INSERT INTO spike (value) VALUES (?)').run('sqlite-ok');
    const row = database.prepare('SELECT value FROM spike').get();
    assert(row?.value === 'sqlite-ok', 'node:sqlite did not round-trip a row');
  } finally {
    database.close();
  }
}

async function verifyTreeSitter() {
  const runtimeWasm = require.resolve('web-tree-sitter/web-tree-sitter.wasm');
  const bashWasm = require.resolve('@vscode/tree-sitter-wasm/wasm/tree-sitter-bash.wasm');

  await Parser.init({
    locateFile() {
      return runtimeWasm;
    },
  });

  const parser = new Parser();
  const language = await Language.load(bashWasm);
  parser.setLanguage(language);
  const tree = parser.parse('printf "ok\\n" | grep ok');
  assert(tree?.rootNode.type === 'program', 'Bash grammar did not produce a program');
  assert(tree.rootNode.toString().includes('pipeline'), 'Bash grammar did not parse a pipeline');
  tree.delete();
  parser.delete();
}

async function verifyHeadlessTerminal() {
  const terminal = new Terminal({
    allowProposedApi: true,
    cols: 80,
    rows: 24,
    scrollback: 100,
  });
  const serializeAddon = new SerializeAddon();
  terminal.loadAddon(serializeAddon);
  await new Promise((resolve) => terminal.write('terminal-ok\r\n', resolve));
  const serialized = serializeAddon.serialize();
  assert(serialized.includes('terminal-ok'), 'Headless terminal snapshot omitted output');
  terminal.dispose();
}

function verifyKeyring() {
  const service = 'terminal-agent-native-spike';
  const account = `spike-${process.pid}`;
  const entry = new Entry(service, account);
  try {
    entry.setPassword('credential-ok');
    assert(entry.getPassword() === 'credential-ok', 'Windows Credential Manager round-trip failed');
  } finally {
    entry.deletePassword();
  }
}

async function verifyConPty() {
  await new Promise((resolve, reject) => {
    const terminal = pty.spawn('cmd.exe', ['/d', '/s', '/c', 'echo conpty-ok'], {
      cols: 80,
      cwd: process.cwd(),
      env: process.env,
      name: 'xterm-256color',
      rows: 24,
    });

    let output = '';
    const timer = setTimeout(() => {
      try {
        terminal.kill();
      } finally {
        reject(new Error(`ConPTY spike timed out; output=${JSON.stringify(output.slice(0, 500))}`));
        setTimeout(() => process.exit(2), 250);
      }
    }, 10_000);

    terminal.onData((chunk) => {
      output += chunk;
    });
    terminal.onExit(({ exitCode }) => {
      clearTimeout(timer);
      try {
        assert(exitCode === 0, `ConPTY child exited with ${exitCode}`);
        assert(output.includes('conpty-ok'), 'ConPTY output was not observed');
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function main() {
  console.log('sqlite');
  verifySqlite();
  console.log('tree-sitter');
  await verifyTreeSitter();
  console.log('headless');
  await verifyHeadlessTerminal();
  console.log('keyring');
  verifyKeyring();
  console.log('conpty');
  await verifyConPty();
  console.log('native-runtime-spike: ok');
}

await main();
process.exit(0);

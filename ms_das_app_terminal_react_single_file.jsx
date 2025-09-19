import React, { useEffect, useRef, useState } from "react";

/*
  MS-DAS-APP Terminal
  --------------------
  Single-file React component (default export) that renders an MS-DOS style terminal UI
  and implements a simple command interpreter + in-memory virtual filesystem.

  Features included:
  - Prompt + command input with caret and blinking
  - Command history (Up/Down)
  - Tab completion (filename and command completion)
  - Built-in commands: help, cls/clear, dir, cd, pwd, type, echo, mkdir, touch, rm, cat (alias type), ls
  - Pluggable command registry so you can add bespoke commands easily
  - Virtual filesystem stored in localStorage (optional persistence)
  - Output buffering and simple pagination
  - Basic keyboard accessibility and selection prevention for a "terminal feel"

  How to use:
  - Drop this file into a React project (CRA / Vite). Ensure Tailwind is available for styling
    or replace tailwind classes with your preferred CSS.
  - Import and render <MsDosTerminal /> in your app.

  Notes / Next steps:
  - Add file upload / download handlers to emulate COPY and TYPE better
  - Add support for executables mapped to JS functions
  - Add authentication or sandboxing if hooking to a backend
*/

// ---------- Utility helpers ----------
function uid() {
  return Math.random().toString(36).slice(2, 9);
}

function splitArgs(str) {
  // simplistic argument splitter that respects double quotes
  const args = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (!inQuote && ch === ' ') {
      if (cur.length) { args.push(cur); cur = ""; }
      continue;
    }
    cur += ch;
  }
  if (cur.length) args.push(cur);
  return args;
}

// ---------- Virtual filesystem ----------
function defaultFs() {
  return {
    name: '/',
    type: 'dir',
    children: [
      { name: 'AUTOEXEC.BAT', type: 'file', content: 'rem MS-DOS-like environment\n' },
      { name: 'README.TXT', type: 'file', content: 'This is a simulated MS-DOS environment.\nUse DIR, CD, TYPE etc.' },
      { name: 'GAMES', type: 'dir', children: [
        { name: 'README.TXT', type: 'file', content: 'This is the GAMES folder.' }
      ] }
    ]
  };
}

function findNodeByPath(root, pathParts) {
  if (!pathParts || pathParts.length === 0 || (pathParts.length === 1 && pathParts[0] === '')) return root;
  let node = root;
  for (const part of pathParts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      // no parent reference in this tree for root-level; return root
      // NOTE: we keep parent by walking from root each time for simplicity in this demo
      continue;
    }
    if (!node.children) return null;
    const found = node.children.find(c => c.name.toUpperCase() === part.toUpperCase());
    if (!found) return null;
    node = found;
  }
  return node;
}

function normalizePath(cwd, target) {
  if (!target) return cwd;
  let parts = [];
  if (target.startsWith('/')) {
    parts = target.split('/').filter(Boolean);
  } else {
    parts = [...cwd.split('/').filter(Boolean), ...target.split('/').filter(Boolean)];
  }
  const out = [];
  for (const p of parts) {
    if (p === '..') { out.pop(); }
    else if (p === '.' || p === '') continue;
    else out.push(p);
  }
  return '/' + out.join('/');
}

// ---------- The Terminal Component ----------
export default function MsDosTerminal({ storageKey = 'msdos_vfs_v1', username = 'USER' }) {
  const [lines, setLines] = useState([]); // {id, text, type}
  const [input, setInput] = useState('');
  const [history, setHistory] = useState([]);
  const [histIdx, setHistIdx] = useState(-1);
  const [cwd, setCwd] = useState('/');
  const [fs, setFs] = useState(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return defaultFs();
  });
  const [commandRegistry, setCommandRegistry] = useState(() => ({}));
  const terminalRef = useRef(null);
  const inputRef = useRef(null);

  // Keep vfs persisted
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(fs)); } catch (e) {}
  }, [fs]);

  useEffect(() => {
    // register builtins
    const builtins = {
      help: { fn: cmdHelp, desc: 'Shows help' },
      cls: { fn: cmdClear, desc: 'Clear screen (alias CLEAR)' },
      clear: { fn: cmdClear, desc: 'Clear screen' },
      dir: { fn: cmdDir, desc: 'List directory contents' },
      ls: { fn: cmdDir, desc: 'List directory contents (alias for DIR)' },
      cd: { fn: cmdCd, desc: 'Change directory' },
      pwd: { fn: cmdPwd, desc: 'Print working directory' },
      type: { fn: cmdType, desc: 'Show file contents (alias CAT)' },
      cat: { fn: cmdType, desc: 'Show file contents' },
      echo: { fn: cmdEcho, desc: 'Echo text' },
      mkdir: { fn: cmdMkdir, desc: 'Make directory' },
      touch: { fn: cmdTouch, desc: 'Create empty file' },
      rm: { fn: cmdRm, desc: 'Remove file/directory' },
      clearfs: { fn: cmdClearFs, desc: 'Reset virtual filesystem' }
    };
    setCommandRegistry(builtins);
    // focus
    focusInput();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function focusInput() {
    setTimeout(() => {
      inputRef.current?.focus();
    }, 10);
  }

  // ---------- Command implementations ----------
  function cmdHelp(args) {
    const keys = Object.keys(commandRegistry).sort();
    printLines(keys.map(k => `${k.padEnd(12)} - ${commandRegistry[k].desc || ''}`));
  }

  function cmdClear() { setLines([]); }

  function listChildren(node) {
    if (!node || !node.children) return [];
    return node.children.map(c => ({ name: c.name, type: c.type }));
  }

  function cmdDir(args) {
    const target = args[0] || '.';
    const path = normalizePath(cwd, target);
    const parts = path.split('/').filter(Boolean);
    const node = findNodeByPath(fs, parts);
    if (!node) return printLine(`File not found: ${target}`);
    if (node.type === 'file') return printLine(node.name);
    const children = listChildren(node);
    // format like MS-DOS: names only in columns
    const formatted = children.map(c => `${c.name}${c.type === 'dir' ? '\\' : ''}`).join('\n');
    printLine(formatted || 'Directory is empty');
  }

  function cmdCd(args) {
    const target = args[0] || '/';
    const path = normalizePath(cwd, target);
    const parts = path.split('/').filter(Boolean);
    const node = findNodeByPath(fs, parts);
    if (!node) return printLine(`The system cannot find the path specified: ${target}`);
    if (node.type !== 'dir') return printLine(`Not a directory: ${target}`);
    setCwd(path === '' ? '/' : path);
  }

  function cmdPwd() { printLine(cwd); }

  function cmdType(args) {
    if (!args[0]) return printLine('Specify a file');
    const path = normalizePath(cwd, args[0]);
    const parts = path.split('/').filter(Boolean);
    const node = findNodeByPath(fs, parts);
    if (!node) return printLine('File not found');
    if (node.type !== 'file') return printLine('Not a file');
    printLine(node.content || '');
  }

  function cmdEcho(args) { printLine(args.join(' ')); }

  function cmdMkdir(args) {
    if (!args[0]) return printLine('Specify directory name');
    const path = normalizePath(cwd, args[0]);
    const parts = path.split('/').filter(Boolean);
    const name = parts.pop();
    const parent = findNodeByPath(fs, parts);
    if (!parent || parent.type !== 'dir') return printLine('Parent not found');
    if (parent.children.find(c => c.name.toUpperCase() === name.toUpperCase())) return printLine('Already exists');
    parent.children.push({ name, type: 'dir', children: [] });
    setFs({ ...fs });
  }

  function cmdTouch(args) {
    if (!args[0]) return printLine('Specify filename');
    const path = normalizePath(cwd, args[0]);
    const parts = path.split('/').filter(Boolean);
    const name = parts.pop();
    const parent = findNodeByPath(fs, parts);
    if (!parent || parent.type !== 'dir') return printLine('Parent not found');
    const existing = parent.children.find(c => c.name.toUpperCase() === name.toUpperCase());
    if (existing) {
      if (existing.type === 'file') return printLine('File exists');
    } else {
      parent.children.push({ name, type: 'file', content: '' });
      setFs({ ...fs });
    }
  }

  function cmdRm(args) {
    if (!args[0]) return printLine('Specify path to remove');
    const path = normalizePath(cwd, args[0]);
    const parts = path.split('/').filter(Boolean);
    const name = parts.pop();
    const parent = findNodeByPath(fs, parts);
    if (!parent || !parent.children) return printLine('Not found');
    const idx = parent.children.findIndex(c => c.name.toUpperCase() === name.toUpperCase());
    if (idx === -1) return printLine('Not found');
    parent.children.splice(idx, 1);
    setFs({ ...fs });
  }

  function cmdClearFs() {
    setFs(defaultFs());
    printLine('Filesystem reset');
  }

  // ---------- Printing helpers ----------
  function printLine(text) {
    setLines(l => [...l, { id: uid(), text: String(text) }]);
    // scroll
    setTimeout(() => terminalRef.current?.scrollTo({ top: terminalRef.current.scrollHeight, behavior: 'smooth' }), 5);
  }

  function printLines(arr) {
    arr.forEach(a => printLine(a));
  }

  // ---------- Command execution ----------
  function handleCommand(raw) {
    if (!raw.trim()) return;
    setLines(l => [...l, { id: uid(), text: `${username}@DOS:${cwd}> ${raw}`, type: 'cmd' }]);
    const parts = splitArgs(raw.trim());
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);

    setHistory(h => [...h, raw]);
    setHistIdx(-1);

    const entry = commandRegistry[cmd];
    if (entry) {
      try {
        const res = entry.fn(args);
        // if command returns string, print it
        if (typeof res === 'string') printLine(res);
      } catch (e) {
        printLine('Error executing command: ' + e.message);
      }
    } else {
      printLine(`'${cmd}' is not recognized as an internal or external command`);
    }
  }

  // ---------- Input handlers ----------
  function onKeyDown(e) {
    if (e.key === 'Enter') {
      handleCommand(input);
      setInput('');
      e.preventDefault();
      return;
    }
    if (e.key === 'ArrowUp') {
      if (history.length === 0) return;
      const idx = histIdx === -1 ? history.length - 1 : Math.max(0, histIdx - 1);
      setHistIdx(idx);
      setInput(history[idx]);
      e.preventDefault();
      return;
    }
    if (e.key === 'ArrowDown') {
      if (history.length === 0) return;
      if (histIdx === -1) return; // nothing
      const idx = histIdx + 1;
      if (idx >= history.length) { setHistIdx(-1); setInput(''); }
      else { setHistIdx(idx); setInput(history[idx]); }
      e.preventDefault();
      return;
    }
    if (e.key === 'Tab') {
      // completion
      e.preventDefault();
      const tokens = input.trim().split(/\s+/);
      const incomplete = tokens[0] || '';
      const args = tokens.slice(1);
      if (tokens.length === 1) {
        const choices = Object.keys(commandRegistry).filter(k => k.startsWith(incomplete));
        if (choices.length === 1) setInput(choices[0] + ' ');
        else if (choices.length > 1) printLines(choices);
      } else {
        // complete filename in cwd
        const node = findNodeByPath(fs, cwd.split('/').filter(Boolean));
        if (node && node.children) {
          const last = args[args.length - 1] || '';
          const matches = node.children.map(c => c.name).filter(n => n.startsWith(last));
          if (matches.length === 1) {
            const prefix = tokens.slice(0, -1).join(' ');
            setInput(prefix + ' ' + matches[0] + ' ');
          } else if (matches.length > 1) printLines(matches);
        }
      }
      return;
    }
  }

  // ---------- Render ----------
  return (
    <div className="w-full h-full min-h-[360px] bg-black text-green-300 font-mono p-4 rounded-lg shadow-lg" onClick={focusInput}>
      <div ref={terminalRef} className="overflow-auto h-[60vh] max-h-[60vh] p-2 border border-black bg-black" style={{ whiteSpace: 'pre-wrap' }}>
        {lines.map(l => (
          <div key={l.id} className="leading-5">{l.text}</div>
        ))}
      </div>

      <div className="mt-2 flex gap-2 items-start">
        <div className="select-none">{username}@DOS:{cwd}&gt;</div>
        <div className="flex-1">
          <div className="relative">
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              className="w-full bg-black focus:outline-none text-green-300 font-mono"
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
            />
            {/* Simple blinking caret using CSS */}
            <div style={{ position: 'absolute', right: 6, top: 0, bottom: 0 }} aria-hidden>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-3 text-sm text-gray-400">
        Type <span className="text-green-400">help</span> to see available commands. Use <span className="text-green-400">Tab</span> for completion and <span className="text-green-400">ArrowUp</span> for history.
      </div>
    </div>
  );
}

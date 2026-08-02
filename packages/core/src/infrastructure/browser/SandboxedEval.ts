// ────────────────────────────────────────────────────────────────
// SandboxedEval — compiles `run_playwright_code`'s agent-authored function
// body inside a `node:vm` context instead of `new AsyncFunction(...)` in
// the server's own realm.
//
// Why this matters: `new AsyncFunction('page', fnDef)` compiles `fnDef`
// with the SAME global scope as the server process — `require`, `process`,
// `fs`, `global` are all free variables the code can reach. `evalAllowed`
// gates *whether* this tool is on, but once on, the blast radius was the
// whole server host process, not just the browser page.
//
// A plain `vm.createContext({ console, JSON, page, ... })` is NOT enough on
// its own, and the reason is worth spelling out because it is easy to get
// wrong: every host value placed in the sandbox is a bridge back to the
// host realm via its constructor chain. Given any host object `o` reachable
// from sandbox code,
//
//     o.constructor.constructor('return process.env')()
//
// compiles a function in the HOST realm, whose scope chain is the host
// global — so it reads `process`, and with it every API key in the
// environment. `require` is not reachable that way (it is a CommonJS
// module-scope binding, not a true global), so this was never RCE, but it
// was full environment disclosure. The same trick works through
// `JSON.constructor`, `setTimeout.constructor`, `Object.prototype` reached
// via the sandbox object's own prototype, and — most importantly — through
// `page` itself, which we are required to hand in.
//
// So the rules this module enforces are:
//   1. The sandbox object has a NULL prototype, so `this.constructor` from
//      sandbox code resolves to `undefined` rather than the host `Object`.
//   2. No host intrinsics are injected. `JSON`, `Math`, `Date`, `Promise`,
//      `Array`… already exist inside the vm realm and are vm-realm objects;
//      injecting the host copies would have re-opened the hole for nothing.
//   3. Every host value that genuinely must cross the boundary (`page`,
//      `console`, the timers) is handed to a bootstrap that runs INSIDE the
//      vm and captures it in a closure. Closures are not reflectable from
//      JavaScript, so the raw host reference is never addressable from
//      sandbox code — only the membrane proxy over it is.
//   4. That membrane denies `constructor` / `__proto__` / `prototype`,
//      pins `getPrototypeOf` to null, and recursively wraps every object or
//      function it returns, so there is no path back to a host constructor
//      no matter how deep the property walk goes.
//
// Residual risk, stated plainly: this is a membrane, not a separate
// process. It stops reflection-based reach-around, which is the only escape
// class that was actually demonstrated here. It does not impose memory or
// CPU limits — vm's `timeout` interrupts a synchronous infinite loop but
// not a hung `await`. A `node:worker_threads` Worker would add those, but
// `page` is a live Playwright object graph that cannot cross a
// structured-clone boundary without building an RPC proxy for the whole
// Playwright surface.
// ────────────────────────────────────────────────────────────────

import * as vm from 'node:vm';

const COMPILE_TIMEOUT_MS = 2000;

export class SandboxedCompileError extends Error {}

/**
 * Runs inside the vm realm. Receives the host references as arguments so
 * they live only in this closure — never as a sandbox property — and
 * returns the vm-realm helpers the caller needs.
 *
 * Everything in this string is vm-realm code: `Proxy`, `WeakMap`,
 * `Reflect` and friends here are the vm's own intrinsics, so a function
 * derived from them compiles in the vm realm, where there is no `process`
 * and no `require` to find.
 */
const MEMBRANE_BOOTSTRAP = `(function install(hostRefs) {
  'use strict';

  // Denied on every wrapped value: the property names that lead back to a
  // host-realm function constructor.
  var BLOCKED = ['constructor', '__proto__', 'prototype'];
  function isBlocked(prop) {
    return typeof prop === 'string' && BLOCKED.indexOf(prop) !== -1;
  }

  // host value -> membrane proxy, so identity is stable across calls
  // (agent code doing \`page.mouse === page.mouse\` still holds).
  var outbound = new WeakMap();
  // membrane proxy -> host value, used to unwrap arguments handed back
  // into host calls and to unwrap the final return value.
  var inbound = new WeakMap();

  function isThenable(v) {
    return v !== null && (typeof v === 'object' || typeof v === 'function') && typeof v.then === 'function';
  }

  // Sandbox -> host. A membrane proxy becomes the real host object again;
  // anything else (primitive, vm-realm object, vm-realm function) passes
  // through untouched, which is what Playwright wants for
  // \`page.evaluate(fn)\` (it stringifies the function) and option bags.
  function unwrap(value) {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value;
    var original = inbound.get(value);
    return original === undefined ? value : original;
  }

  // Host -> sandbox.
  function wrap(value) {
    if (value === null) return null;
    var type = typeof value;
    if (type !== 'object' && type !== 'function') return value;

    var existing = outbound.get(value);
    if (existing !== undefined) return existing;

    // The proxy target only decides callability; every trap reads through
    // to \`value\` instead, so the target itself stays an empty vm object.
    var target = type === 'function' ? function () {} : {};
    var proxy = new Proxy(target, {
      get: function (_t, prop) {
        if (isBlocked(prop)) return undefined;
        return wrap(value[prop]);
      },
      set: function (_t, prop, next) {
        if (isBlocked(prop)) return false;
        value[prop] = unwrap(next);
        return true;
      },
      has: function (_t, prop) {
        if (isBlocked(prop)) return false;
        return prop in value;
      },
      deleteProperty: function (_t, prop) {
        if (isBlocked(prop)) return false;
        delete value[prop];
        return true;
      },
      ownKeys: function () {
        return Reflect.ownKeys(value).filter(function (k) { return !isBlocked(k); });
      },
      getOwnPropertyDescriptor: function (_t, prop) {
        if (isBlocked(prop)) return undefined;
        var desc = Reflect.getOwnPropertyDescriptor(value, prop);
        if (desc === undefined) return undefined;
        // Must report configurable:true — the real target is an empty
        // object, so a non-configurable report breaks Proxy invariants.
        return { value: wrap(value[prop]), writable: true, enumerable: !!desc.enumerable, configurable: true };
      },
      // Pinning the prototype to null closes the
      // \`Object.getPrototypeOf(proxy).constructor\` route.
      getPrototypeOf: function () { return null; },
      setPrototypeOf: function () { return false; },
      apply: function (_t, thisArg, args) {
        var out = Reflect.apply(value, unwrap(thisArg), args.map(unwrap));
        return isThenable(out) ? Promise.resolve(out).then(wrap) : wrap(out);
      },
      construct: function (_t, args) {
        return wrap(Reflect.construct(value, args.map(unwrap)));
      },
    });

    outbound.set(value, proxy);
    inbound.set(proxy, value);
    return proxy;
  }

  // Methods are reached as \`proxy.foo\` -> wrap(hostFn), so calling them
  // goes through the \`apply\` trap with \`thisArg\` = the parent proxy, which
  // unwraps back to the correct host receiver. No extra binding needed.
  globalThis.console = wrap(hostRefs.console);
  globalThis.setTimeout = wrap(hostRefs.setTimeout);
  globalThis.clearTimeout = wrap(hostRefs.clearTimeout);
  globalThis.setInterval = wrap(hostRefs.setInterval);
  globalThis.clearInterval = wrap(hostRefs.clearInterval);

  return { wrap: wrap, unwrap: unwrap };
})`;

interface Membrane {
  wrap: (value: unknown) => unknown;
  unwrap: (value: unknown) => unknown;
}

/**
 * Compile `fnDef` (the body of an async function taking `page`) inside a
 * fresh `vm` context with no `require`/`process`/`fs`/`global` in scope and
 * no reflective path back to a host-realm function constructor.
 * Throws `SandboxedCompileError` on a syntax error — callers should report
 * that as a compile failure, same as the old `new AsyncFunction(...)` path.
 */
export function compileSandboxedPageFunction<TPage>(fnDef: string): (page: TPage) => Promise<unknown> {
  // Null prototype: without it, `this.constructor` from sandbox code walks
  // the sandbox object's chain to the HOST `Object.prototype` and hands
  // back the host `Function` constructor.
  const context = vm.createContext(Object.create(null) as object);

  let membrane: Membrane;
  try {
    const install = new vm.Script(MEMBRANE_BOOTSTRAP, { filename: 'sandbox-membrane.js' })
      .runInContext(context, { timeout: COMPILE_TIMEOUT_MS }) as (refs: Record<string, unknown>) => Membrane;
    membrane = install({ console, setTimeout, clearTimeout, setInterval, clearInterval });
  } catch (err) {
    throw new SandboxedCompileError(`sandbox init failed: ${(err as Error).message}`);
  }

  const wrapped = `(async function (page) {\n${fnDef}\n})`;
  let compiled: vm.Script;
  try {
    compiled = new vm.Script(wrapped, { filename: 'run_playwright_code.js' });
  } catch (err) {
    throw new SandboxedCompileError((err as Error).message);
  }

  let fn: (page: unknown) => Promise<unknown>;
  try {
    fn = compiled.runInContext(context, { timeout: COMPILE_TIMEOUT_MS }) as (page: unknown) => Promise<unknown>;
  } catch (err) {
    throw new SandboxedCompileError((err as Error).message);
  }

  return async (page: TPage): Promise<unknown> => {
    const result = await fn(membrane.wrap(page));
    // Unwrap so the caller's result summariser sees the plain host value
    // rather than a membrane proxy.
    return membrane.unwrap(result);
  };
}

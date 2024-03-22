# ECMAScript Explicit Resource Management

> **NOTE:** This proposal has subsumed the [Async Explicit Resource Management](https://github.com/tc39/proposal-async-explicit-resource-management)
> proposal. This proposal repository should be used for further discussion of both sync and async of explicit resource
> management.

This proposal intends to address a common pattern in software development regarding
the lifetime and management of various resources (memory, I/O, etc.). This pattern
generally includes the allocation of a resource and the ability to explicitly
release critical resources.

For example, ECMAScript Generator Functions and Async Generator Functions expose this pattern through the
`return` method, as a means to explicitly evaluate `finally` blocks to ensure
user-defined cleanup logic is preserved:

```js
// sync generators
function * g() {
  const handle = acquireFileHandle(); // critical resource
  try {
    ...
  }
  finally {
    handle.release(); // cleanup
  }
}

const obj = g();
try {
  const r = obj.next();
  ...
}
finally {
  obj.return(); // calls finally blocks in `g`
}
```

```js
// async generators
async function * g() {
  const handle = acquireStream(); // critical resource
  try {
    ...
  }
  finally {
    await stream.close(); // cleanup
  }
}

const obj = g();
try {
  const r = await obj.next();
  ...
}
finally {
  await obj.return(); // calls finally blocks in `g`
}
```

As such, we propose the adoption of a novel syntax to simplify this common pattern:

```js
// sync disposal
function * g() {
  using handle = acquireFileHandle(); // block-scoped critical resource
} // cleanup

{
  using obj = g(); // block-scoped declaration
  const r = obj.next();
} // calls finally blocks in `g`
```

```js
// async disposal
async function * g() {
  using stream = acquireStream(); // block-scoped critical resource
  ...
} // cleanup

{
  await using obj = g(); // block-scoped declaration
  const r = await obj.next();
} // calls finally blocks in `g`
```

In addition, we propose the addition of two disposable container objects to assist
with managing multiple resources:

- `DisposableStack` &mdash; A stack-based container of disposable resources.
- `AsyncDisposableStack` &mdash; A stack-based container of asynchronously disposable resources.

## Status

**Stage:** 3  \
**Champion:** Ron Buckton (@rbuckton)  \
**Last Presented:** March, 2023 ([slides](https://1drv.ms/p/s!AjgWTO11Fk-Tkodu1RydtKh2ZVafxA?e=yasS3Y),
[notes #1](https://github.com/tc39/notes/blob/main/meetings/2023-03/mar-21.md#async-explicit-resource-management),
[notes #2](https://github.com/tc39/notes/blob/main/meetings/2023-03/mar-23.md#async-explicit-resource-management-again))

_For more information see the [TC39 proposal process](https://tc39.es/process-document/)._

## Authors

- Ron Buckton (@rbuckton)

# Motivations

This proposal is motivated by a number of cases:

- Inconsistent patterns for resource management:
  - ECMAScript Iterators: `iterator.return()`
  - WHATWG Stream Readers: `reader.releaseLock()`
  - NodeJS FileHandles: `handle.close()`
  - Emscripten C++ objects handles: `Module._free(ptr) obj.delete() Module.destroy(obj)`
- Avoiding common footguns when managing resources:
  ```js
  const reader = stream.getReader();
  ...
  reader.releaseLock(); // Oops, should have been in a try/finally
  ```
- Scoping resources:
  ```js
  const handle = ...;
  try {
    ... // ok to use `handle`
  }
  finally {
    handle.close();
  }
  // not ok to use `handle`, but still in scope
  ```
- Avoiding common footguns when managing multiple resources:
  ```js
  const a = ...;
  const b = ...;
  try {
    ...
  }
  finally {
    a.close(); // Oops, issue if `b.close()` depends on `a`.
    b.close(); // Oops, `b` never reached if `a.close()` throws.
  }
  ```
- Avoiding lengthy code when managing multiple resources correctly:
  ```js
  // sync disposal
  { // block avoids leaking `a` or `b` to outer scope
    const a = ...;
    try {
      const b = ...;
      try {
        ...
      }
      finally {
        b.close(); // ensure `b` is closed before `a` in case `b`
                   // depends on `a`
      }
    }
    finally {
      a.close(); // ensure `a` is closed even if `b.close()` throws
    }
  }
  // both `a` and `b` are out of scope
  ```
  Compared to:
  ```js
  // avoids leaking `a` or `b` to outer scope
  // ensures `b` is disposed before `a` in case `b` depends on `a`
  // ensures `a` is disposed even if disposing `b` throws
  using a = ..., b = ...;
  ...
  ```
  ```js
  // async sync disposal
  { // block avoids leaking `a` or `b` to outer scope
    const a = ...;
    try {
      const b = ...;
      try {
        ...
      }
      finally {
        await b.close(); // ensure `b` is closed before `a` in case `b`
                        // depends on `a`
      }
    }
    finally {
      await a.close(); // ensure `a` is closed even if `b.close()` throws
    }
  }
  // both `a` and `b` are out of scope
  ```
  Compared to:
  ```js
  // avoids leaking `a` or `b` to outer scope
  // ensures `b` is disposed before `a` in case `b` depends on `a`
  // ensures `a` is disposed even if disposing `b` throws
  await using a = ..., b = ...;
  ...
  ```
- Non-blocking memory/IO applications:
  ```js
  import { ReaderWriterLock } from "...";
  const lock = new ReaderWriterLock();

  export async function readData() {
    // wait for outstanding writer and take a read lock
    using lockHandle = await lock.read();
    ... // any number of readers
    await ...;
    ... // still in read lock after `await`
  } // release the read lock

  export async function writeData(data) {
    // wait for all readers and take a write lock
    using lockHandle = await lock.write();
    ... // only one writer
    await ...;
    ... // still in write lock after `await`
  } // release the write lock
  ```
- Potential for use with the [Fixed Layout Objects Proposal](https://github.com/tc39/proposal-structs) and
  `shared struct`:
  ```js
  // main.js
  shared struct class SharedData {
    ready = false;
    processed = false;
  }

  const worker = new Worker('worker.js');
  const m = new Atomics.Mutex();
  const cv = new Atomics.ConditionVariable();
  const data = new SharedData();
  worker.postMessage({ m, cv, data });

  // send data to worker
  {
    // wait until main can get a lock on 'm'
    using lck = m.lock();

    // mark data for worker
    data.ready = true;
    console.log("main is ready");

  } // unlocks 'm'

  // notify potentially waiting worker
  cv.notifyOne();

  {
    // reacquire lock on 'm'
    using lck = m.lock();

    // release the lock on 'm' and wait for the worker to finish processing
    cv.wait(m, () => data.processed);

  } // unlocks 'm'
  ```

  ```js
  // worker.js
  onmessage = function (e) {
    const { m, cv, data } = e.data;

    {
      // wait until worker can get a lock on 'm'
      using lck = m.lock();

      // release the lock on 'm' and wait until main() sends data
      cv.wait(m, () => data.ready);

      // after waiting we once again own the lock on 'm'
      console.log("worker thread is processing data");

      // send data back to main
      data.processed = true;
      console.log("worker thread is done");

    } // unlocks 'm'
  }
  ```

# Prior Art

<!-- Links to similar concepts in existing languages, prior proposals, etc. -->

- C#:
  - [`using` statement](https://docs.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/using-statement)
  - [`using` declaration](https://docs.microsoft.com/en-us/dotnet/csharp/language-reference/proposals/csharp-8.0/using#using-declaration)
- Java: [`try`-with-resources statement](https://docs.oracle.com/javase/tutorial/essential/exceptions/tryResourceClose.html)
- Python: [`with` statement](https://docs.python.org/3/reference/compound_stmts.html#the-with-statement)

# Definitions

- _Resource_ &mdash; An object with a specific lifetime, at the end of which either a lifetime-sensitive operation
  should be performed or a non-garbage-collected reference (such as a file handle, socket, etc.) should be closed or
  freed.
- _Resource Management_ &mdash; A process whereby "resources" are released, triggering any lifetime-sensitive operations
  or freeing any related non-garbage-collected references.
- _Implicit Resource Management_ &mdash; Indicates a system whereby the lifetime of a "resource" is managed implicitly
  by the runtime as part of garbage collection, such as:
  - `WeakMap` keys
  - `WeakSet` values
  - `WeakRef` values
  - `FinalizationRegistry` entries
- _Explicit Resource Management_ &mdash; Indicates a system whereby the lifetime of a "resource" is managed explicitly
  by the user either **imperatively** (by directly calling a method like `Symbol.dispose`) or **declaratively** (through
  a block-scoped declaration like `using`).

# Syntax

## `using` Declarations

```js
// a synchronously-disposed, block-scoped resource
using x = expr1;            // resource w/ local binding
using y = expr2, z = expr4; // multiple resources
```


# Grammar

Please refer to the [specification text][Specification] for the most recent version of the grammar.

## `await using` Declarations

```js
// an asynchronously-disposed, block-scoped resource
await using x = expr1;            // resource w/ local binding
await using y = expr2, z = expr4; // multiple resources
```

An `await using` declaration can appear in the following contexts:
- The top level of a _Module_ anywhere _VariableStatement_ is allowed, as long as it is not immediately nested inside
  of a _CaseClause_ or _DefaultClause_.
- In the body of an async function or async generator anywhere a _VariableStatement_ is allowed, as long as it is not
  immediately nested inside of a _CaseClause_ or _DefaultClause_.
- In the head of a `for-of` or `for-await-of` statement.

## `await using` in `for-of` and `for-await-of` Statements

```js
for (await using x of y) ...

for await (await using x of y) ...
```

You can use an `await using` declaration in a `for-of` or `for-await-of` statement inside of an async context to
explicitly bind each iterated value as an async disposable resource. `for-await-of` does not implicitly make a non-async
`using` declaration into an async `await using` declaration, as the `await` markers in  `for-await-of` and `await using`
are explicit indicators for distinct cases: `for await` *only* indicates async iteration, while `await using` *only*
indicates async disposal. For example:

```js

// sync iteration, sync disposal
for (using x of y) ; // no implicit `await` at end of each iteration

// sync iteration, async disposal
for (await using x of y) ; // implicit `await` at end of each iteration

// async iteration, sync disposal
for await (using x of y) ; // implicit `await` at end of each iteration

// async iteration, async disposal
for await (await using x of y) ; // implicit `await` at end of each iteration
```

While there is some overlap in that the last three cases introduce some form of implicit `await` during execution, it
is intended that the presence or absence of the `await` modifier in a `using` declaration is an explicit indicator as to
whether we are expecting the iterated value to have an `@@asyncDispose` method. This distinction is in line with the
behavior of `for-of` and `for-await-of`:

```js
const iter = { [Symbol.iterator]() { return [].values(); } };
const asyncIter = { [Symbol.asyncIterator]() { return [].values(); } };

for (const x of iter) ; // ok: `iter` has @@iterator
for (const x of asyncIter) ; // throws: `asyncIter` does not have @@iterator

for await (const x of iter) ; // ok: `iter` has @@iterator (fallback)
for await (const x of asyncIter) ; // ok: `asyncIter` has @@asyncIterator

```

`using` and `await using` have the same distinction:

```js
const res = { [Symbol.dispose]() {} };
const asyncRes = { [Symbol.asyncDispose]() {} };

using x = res; // ok: `res` has @@dispose
using x = asyncRes; // throws: `asyncRes` does not have @@dispose

await using x = res; // ok: `res` has @@dispose (fallback)
await using x = asyncres; // ok: `asyncRes` has @@asyncDispose
```

This results in a matrix of behaviors based on the presence of each `await` marker:

```js
const res = { [Symbol.dispose]() {} };
const asyncRes = { [Symbol.asyncDispose]() {} };
const iter = { [Symbol.iterator]() { return [res, asyncRes].values(); } };
const asyncIter = { [Symbol.asyncIterator]() { return [res, asyncRes].values(); } };

for (using x of iter) ;
// sync iteration, sync disposal
// - `iter` has @@iterator: ok
// - `res` has @@dispose: ok
// - `asyncRes` does not have @@dispose: *error*

for (using x of asyncIter) ;
// sync iteration, sync disposal
// - `asyncIter` does not have @@iterator: *error*

for (await using x of iter) ;
// sync iteration, async disposal
// - `iter` has @@iterator: ok
// - `res` has @@dispose (fallback): ok
// - `asyncRes` has @@asyncDispose: ok

for (await using x of asyncIter) ;
// sync iteration, async disposal
// - `asyncIter` does not have @@iterator: error

for await (using x of iter) ;
// async iteration, sync disposal
// - `iter` has @@iterator (fallback): ok
// - `res` has @@dispose: ok
// - `asyncRes` does not have @@dispose: error

for await (using x of asyncIter) ;
// async iteration, sync disposal
// - `asyncIter` has @@asyncIterator: ok
// - `res` has @@dispose: ok
// - `asyncRes` does not have @@dispose: error

for await (await using x of iter) ;
// async iteration, async disposal
// - `iter` has @@iterator (fallback): ok
// - `res` has @@dispose (fallback): ok
// - `asyncRes` does has @@asyncDispose: ok

for await (await using x of asyncIter) ;
// async iteration, async disposal
// - `asyncIter` has @@asyncIterator: ok
// - `res` has @@dispose (fallback): ok
// - `asyncRes` does has @@asyncDispose: ok
```

Or, in table form:

| Syntax                           | Iteration                      | Disposal                     |
|:---------------------------------|:------------------------------:|:----------------------------:|
| `for (using x of y)`             | `@@iterator`                   | `@@dispose`                  |
| `for (await using x of y)`       | `@@iterator`                   | `@@asyncDispose`/`@@dispose` |
| `for await (using x of y)`       | `@@asyncIterator`/`@@iterator` | `@@dispose`                  |
| `for await (await using x of y)` | `@@asyncIterator`/`@@iterator` | `@@asyncDispose`/`@@dispose` |

# Semantics

## `using` Declarations

### `using` Declarations with Explicit Local Bindings

```grammarkdown
UsingDeclaration :
  `using` BindingList `;`

LexicalBinding :
    BindingIdentifier Initializer
```

When a `using` declaration is parsed with _BindingIdentifier_ _Initializer_, the bindings created in the declaration
are tracked for disposal at the end of the containing _Block_ or _Module_ (a `using` declaration cannot be used
at the top level of a _Script_):

```js
{
  ... // (1)
  using x = expr1;
  ... // (2)
}
```

The above example has similar runtime semantics as the following transposed representation:

```js
{
  const $$try = { stack: [], error: undefined, hasError: false };
  try {
    ... // (1)

    const x = expr1;
    if (x !== null && x !== undefined) {
      const $$dispose = x[Symbol.dispose];
      if (typeof $$dispose !== "function") {
        throw new TypeError();
      }
      $$try.stack.push({ value: x, dispose: $$dispose });
    }

    ... // (2)
  }
  catch ($$error) {
    $$try.error = $$error;
    $$try.hasError = true;
  }
  finally {
    while ($$try.stack.length) {
      const { value: $$expr, dispose: $$dispose } = $$try.stack.pop();
      try {
        $$dispose.call($$expr);
      }
      catch ($$error) {
        $$try.error = $$try.hasError ? new SuppressedError($$error, $$try.error) : $$error;
        $$try.hasError = true;
      }
    }
    if ($$try.hasError) {
      throw $$try.error;
    }
  }
}
```

If exceptions are thrown both in the block following the `using` declaration and in the call to
`[Symbol.dispose]()`, all exceptions are reported.

### `using` Declarations with Multiple Resources

A `using` declaration can mix multiple explicit bindings in the same declaration:

```js
{
  ...
  using x = expr1, y = expr2;
  ...
}
```

These bindings are again used to perform resource disposal when the _Block_ or _Module_ exits, however in this case
`[Symbol.dispose]()` is invoked in the reverse order of their declaration. This is _approximately_ equivalent to the
following:

```js
{
  ... // (1)
  using x = expr1;
  using y = expr2;
  ... // (2)
}
```

Both of the above cases would have similar runtime semantics as the following transposed representation:

```js
{
  const $$try = { stack: [], error: undefined, hasError: false };
  try {
    ... // (1)

    const x = expr1;
    if (x !== null && x !== undefined) {
      const $$dispose = x[Symbol.dispose];
      if (typeof $$dispose !== "function") {
        throw new TypeError();
      }
      $$try.stack.push({ value: x, dispose: $$dispose });
    }

    const y = expr2;
    if (y !== null && y !== undefined) {
      const $$dispose = y[Symbol.dispose];
      if (typeof $$dispose !== "function") {
        throw new TypeError();
      }
      $$try.stack.push({ value: y, dispose: $$dispose });
    }

    ... // (2)
  }
  catch ($$error) {
    $$try.error = $$error;
    $$try.hasError = true;
  }
  finally {
    while ($$try.stack.length) {
      const { value: $$expr, dispose: $$dispose } = $$try.stack.pop();
      try {
        $$dispose.call($$expr);
      }
      catch ($$error) {
        $$try.error = $$try.hasError ? new SuppressedError($$error, $$try.error) : $$error;
        $$try.hasError = true;
      }
    }
    if ($$try.hasError) {
      throw $$try.error;
    }
  }
}
```

Since we must always ensure that we properly release resources, we must ensure that any abrupt completion that might
occur during binding initialization results in evaluation of the cleanup step. When there are multiple declarations in
the list, we track each resource in the order they are declared. As a result, we must release these resources in reverse
order.

### `using` Declarations and `null` or `undefined` Values

This proposal has opted to ignore `null` and `undefined` values provided to the `using` declarations. This is similar to
the behavior of `using` in C#, which also allows `null`. One primary reason for this behavior is to simplify a common
case where a resource might be optional, without requiring duplication of work or needless allocations:

```js
if (isResourceAvailable()) {
  using resource = getResource();
  ... // (1)
  resource.doSomething()
  ... // (2)
}
else {
  // duplicate code path above
  ... // (1) above
  ... // (2) above
}
```

Compared to:

```js
using resource = isResourceAvailable() ? getResource() : undefined;
... // (1) do some work with or without resource
resource?.doSomething();
... // (2) do some other work with or without resource
```

### `using` Declarations and Values Without `[Symbol.dispose]`

If a resource does not have a callable `[Symbol.dispose]` member, a `TypeError` would be thrown **immediately** when the
resource is tracked.

### `using` Declarations in `for-of` and `for-await-of` Loops

A `using` declaration _may_ occur in the _ForDeclaration_ of a `for-of` or `for-await-of` loop:

```js
for (using x of iterateResources()) {
  // use x
}
```

In this case, the value bound to `x` in each iteration will be _synchronously_ disposed at the end of each iteration.
This will not dispose resources that are not iterated, such as if iteration is terminated early due to `return`,
`break`, or `throw`.

`using` declarations _may not_ be used in in the head of a `for-in` loop.

## `await using` Declarations

### `await using` Declarations with Explicit Local Bindings

```grammarkdown
UsingDeclaration :
  `await` `using` BindingList `;`

LexicalBinding :
    BindingIdentifier Initializer
```

When an `await using` declaration is parsed with _BindingIdentifier_ _Initializer_, the bindings created in the
declaration are tracked for disposal at the end of the containing async function body, _Block_, or _Module_:

```js
{
  ... // (1)
  await using x = expr1;
  ... // (2)
}
```

The above example has similar runtime semantics as the following transposed representation:

```js
{
  const $$try = { stack: [], error: undefined, hasError: false };
  try {
    ... // (1)

    const x = expr1;
    if (x !== null && x !== undefined) {
      let $$dispose = x[Symbol.asyncDispose];
      if (typeof $$dispose !== "function") {
        $$dispose = x[Symbol.dispose];
      }
      if (typeof $$dispose !== "function") {
        throw new TypeError();
      }
      $$try.stack.push({ value: x, dispose: $$dispose });
    }

    ... // (2)
  }
  catch ($$error) {
    $$try.error = $$error;
    $$try.hasError = true;
  }
  finally {
    while ($$try.stack.length) {
      const { value: $$expr, dispose: $$dispose } = $$try.stack.pop();
      try {
        await $$dispose.call($$expr);
      }
      catch ($$error) {
        $$try.error = $$try.hasError ? new SuppressedError($$error, $$try.error) : $$error;
        $$try.hasError = true;
      }
    }
    if ($$try.hasError) {
      throw $$try.error;
    }
  }
}
```

If exceptions are thrown both in the statements following the `await using` declaration and in the call to
`[Symbol.asyncDispose]()`, all exceptions are reported.

### `await using` Declarations with Multiple Resources

An `await using` declaration can mix multiple explicit bindings in the same declaration:

```js
{
  ...
  await using x = expr1, y = expr2;
  ...
}
```

These bindings are again used to perform resource disposal when the _Block_ or _Module_ exits, however in this case each
resource's `[Symbol.asyncDispose]()` is invoked in the reverse order of their declaration. This is _approximately_
equivalent to the following:

```js
{
  ... // (1)
  await using x = expr1;
  await using y = expr2;
  ... // (2)
}
```

Both of the above cases would have similar runtime semantics as the following transposed representation:

```js
{
  const $$try = { stack: [], error: undefined, hasError: false };
  try {
    ... // (1)

    const x = expr1;
    if (x !== null && x !== undefined) {
      let $$dispose = x[Symbol.asyncDispose];
      if (typeof $$dispose !== "function") {
        $$dispose = x[Symbol.dispose];
      }
      if (typeof $$dispose !== "function") {
        throw new TypeError();
      }
      $$try.stack.push({ value: x, dispose: $$dispose });
    }

    const y = expr2;
    if (y !== null && y !== undefined) {
      let $$dispose = y[Symbol.asyncDispose];
      if (typeof $$dispose !== "function") {
        $$dispose = y[Symbol.dispose];
      }
      if (typeof $$dispose !== "function") {
        throw new TypeError();
      }
      $$try.stack.push({ value: y, dispose: $$dispose });
    }

    ... // (2)
  }
  catch ($$error) {
    $$try.error = $$error;
    $$try.hasError = true;
  }
  finally {
    while ($$try.stack.length) {
      const { value: $$expr, dispose: $$dispose } = $$try.stack.pop();
      try {
        await $$dispose.call($$expr);
      }
      catch ($$error) {
        $$try.error = $$try.hasError ? new SuppressedError($$error, $$try.error) : $$error;
        $$try.hasError = true;
      }
    }
    if ($$try.hasError) {
      throw $$try.error;
    }
  }
}
```

Since we must always ensure that we properly release resources, we must ensure that any abrupt completion that might
occur during binding initialization results in evaluation of the cleanup step. When there are multiple declarations in
the list, we track each resource in the order they are declared. As a result, we must release these resources in reverse
order.

### `await using` Declarations and `null` or `undefined` Values

This proposal has opted to ignore `null` and `undefined` values provided to `await using` declarations. This is
consistent with the proposed behavior for the `using` declarations in this proposal. Like in the sync case, this allows
simplifying a common case where a resource might be optional, without requiring duplication of work or needless
allocations:

```js
if (isResourceAvailable()) {
  await using resource = getResource();
  ... // (1)
  resource.doSomething()
  ... // (2)
}
else {
  // duplicate code path above
  ... // (1) above
  ... // (2) above
}
```

Compared to:

```js
await using resource = isResourceAvailable() ? getResource() : undefined;
... // (1) do some work with or without resource
resource?.doSomething();
... // (2) do some other work with or without resource
```

### `await using` Declarations and Values Without `[Symbol.asyncDispose]` or `[Symbol.dispose]`

If a resource does not have a callable `[Symbol.asyncDispose]` or `[Symbol.asyncDispose]` member, a `TypeError` would be thrown **immediately** when the resource is tracked.

### `await using` Declarations in `for-of` and `for-await-of` Loops

An `await using` declaration _may_ occur in the _ForDeclaration_ of a `for-await-of` loop:

```js
for await (await using x of iterateResources()) {
  // use x
}
```

In this case, the value bound to `x` in each iteration will be _asynchronously_ disposed at the end of each iteration.
This will not dispose resources that are not iterated, such as if iteration is terminated early due to `return`,
`break`, or `throw`.

`await using` declarations _may not_ be used in in the head of a `for-of` or `for-in` loop.

### Implicit Async Interleaving Points ("implicit `await`")

The `await using` syntax introduces an implicit async interleaving point (i.e., an implicit `await`) whenever control
flow exits an async function body, _Block_, or _Module_ containing an `await using` declaration. This means that two
statements that currently execute in the same microtask, such as:

```js
async function f() {
  {
    a();
  } // exit block
  b(); // same microtask as call to `a()`
}
```

will instead execute in different microtasks if an `await using` declaration is introduced:

```js
async function f() {
  {
    await using x = ...;
    a();
  } // exit block, implicit `await`
  b(); // different microtask from call to `a()`.
}
```

It is important that such an implicit interleaving point be adequately indicated within the syntax. We believe that
the presence of `await using` within such a block is an adequate indicator, since it should be fairly easy to recognize
a _Block_ containing an `await using` statement in well-formatted code.

It is also feasible for editors to use features such as syntax highlighting, editor decorations, and inlay hints to
further highlight such transitions, without needing to specify additional syntax.

Further discussion around the `await using` syntax and how it pertains to implicit async interleaving points can be
found in [#1](https://github.com/tc39/proposal-async-explicit-resource-management/issues/1).

# Examples

The following show examples of using this proposal with various APIs, assuming those APIs adopted this proposal.

### WHATWG Streams API
```js
{
  using reader = stream.getReader();
  const { value, done } = reader.read();
} // 'reader' is disposed
```

### NodeJS FileHandle
```js
{
  using f1 = await fs.promises.open(s1, constants.O_RDONLY),
        f2 = await fs.promises.open(s2, constants.O_WRONLY);
  const buffer = Buffer.alloc(4092);
  const { bytesRead } = await f1.read(buffer);
  await f2.write(buffer, 0, bytesRead);
} // 'f2' is disposed, then 'f1' is disposed
```

### NodeJS Streams
```js
{
  await using writable = ...;
  writable.write(...);
} // 'writable.end()' is called and its result is awaited
```

### Logging and tracing
```js
// audit privileged function call entry and exit
function privilegedActivity() {
  using activity = auditLog.startActivity("privilegedActivity"); // log activity start
  ...
} // log activity end
```

### Async Coordination
```js
import { Semaphore } from "...";
const sem = new Semaphore(1); // allow one participant at a time

export async function tryUpdate(record) {
  using lck = await sem.wait(); // asynchronously block until we are the sole participant
  ...
} // synchronously release semaphore and notify the next participant
```

### Three-Phase Commit Transactions
```js
// roll back transaction if either action fails
async function transfer(account1, account2) {
  await using tx = transactionManager.startTransaction(account1, account2);
  await account1.debit(amount);
  await account2.credit(amount);

  // mark transaction success if we reach this point
  tx.succeeded = true;
} // await transaction commit or rollback
```

### Shared Structs
**main_thread.js**
```js
// main_thread.js
shared struct Data {
  mut;
  cv;
  ready = 0;
  processed = 0;
  // ...
}

const data = Data();
data.mut = Atomics.Mutex();
data.cv = Atomics.ConditionVariable();

// start two workers
startWorker1(data);
startWorker2(data);
```

**worker1.js**
```js
const data = ...;
const { mut, cv } = data;

{
  // lock mutex
  using lck = Atomics.Mutex.lock(mut);

  // NOTE: at this point we currently own the lock

  // load content into data and signal we're ready
  // ...
  Atomics.store(data, "ready", 1);

} // release mutex

// NOTE: at this point we no longer own the lock

// notify worker 2 that it should wake
Atomics.ConditionVariable.notifyOne(cv);

{
  // reacquire lock on mutex
  using lck = Atomics.Mutex.lock(mut);

  // NOTE: at this point we currently own the lock

  // release mutex and wait until condition is met to reacquire it
  Atomics.ConditionVariable.wait(mut, () => Atomics.load(data, "processed") === 1);

  // NOTE: at this point we currently own the lock

  // Do something with the processed data
  // ...

} // release mutex

// NOTE: at this point we no longer own the lock
```

**worker2.js**
```js
const data = ...;
const { mut, cv } = data;

{
  // lock mutex
  using lck = Atomics.Mutex.lock(mut);

  // NOTE: at this point we currently own the lock

  // release mutex and wait until condition is met to reacquire it
  Atomics.ConditionVariable.wait(mut, () => Atomics.load(data, "ready") === 1);

  // NOTE: at this point we currently own the lock

  // read in values from data, perform our processing, then indicate we are done
  // ...
  Atomics.store(data, "processed", 1);

} // release mutex

// NOTE: at this point we no longer own the lock
```

# API

## Additions to `Symbol`

This proposal adds the `dispose` and `asyncDispose` properties to the `Symbol` constructor, whose values are the
`@@dispose` and `@@asyncDispose` internal symbols:

**Well-known Symbols**
| Specification Name | \[\[Description]] | Value and Purpose |
|:-|:-|:-|
| _@@dispose_ | *"Symbol.dispose"* | A method that explicitly disposes of resources held by the object. Called by the semantics of `using` declarations and by `DisposableStack` objects. |
| _@@asyncDispose_ | *"Symbol.asyncDispose"* | A method that asynchronosly explicitly disposes of resources held by the object. Called by the semantics of `await using` declarations and by `AsyncDisposableStack` objects. |

**TypeScript Definition**
```ts
interface SymbolConstructor {
  readonly asyncDispose: unique symbol;
  readonly dispose: unique symbol;
}
```

## The `SuppressedError` Error

If an exception occurs during resource disposal, it is possible that it might suppress an existing exception thrown
from the body, or from the disposal of another resource. Languages like Java allow you to access a suppressed exception
via a [`getSuppressed()`](https://docs.oracle.com/javase/7/docs/api/java/lang/Throwable.html#getSuppressed()) method on
the exception. However, ECMAScript allows you to throw any value, not just `Error`, so there is no convenient place to
attach a suppressed exception. To better surface these suppressed exceptions and support both logging and error
recovery, this proposal seeks to introduce a new `SuppressedError` built-in `Error` subclass which would contain both
the error that was most recently thrown, as well as the error that was suppressed:

```js
class SuppressedError extends Error {
  /**
   * Wraps an error that suppresses another error, and the error that was suppressed.
   * @param {*} error The error that resulted in a suppression.
   * @param {*} suppressed The error that was suppressed.
   * @param {string} message The message for the error.
   * @param {{ cause?: * }} [options] Options for the error.
   */
  constructor(error, suppressed, message, options);

  /**
   * The name of the error (i.e., `"SuppressedError"`).
   * @type {string}
   */
  name = "SuppressedError";

  /**
   * The error that resulted in a suppression.
   * @type {*}
   */
  error;

  /**
   * The error that was suppressed.
   * @type {*}
   */
  suppressed;

  /**
   * The message for the error.
   * @type {*}
   */
  message;
}
```

We've chosen to use `SuppressedError` over `AggregateError` for several reasons:
- `AggregateError` is designed to hold a list of multiple errors, with no correlation between those errors, while
  `SuppressedError` is intended to hold references to two errors with a direct correlation.
- `AggregateError` is intended to ideally hold a flat list of errors. `SuppressedError` is intended to hold a jagged set
  of errors (i.e., `e.suppressed.suppressed.suppressed` if there were successive error suppressions).
- The only error correlation on `AggregateError` is through `cause`, however a `SuppressedError` isn't "caused" by the
  error it suppresses. In addition, `cause` is intended to be optional, while the `error` of a `SuppressedError` must
  always be defined.

## Built-in Disposables

### `%IteratorPrototype%.@@dispose()`

We also propose to add `Symbol.dispose` to the built-in `%IteratorPrototype%` as if it had the following behavior:

```js
%IteratorPrototype%[Symbol.dispose] = function () {
  this.return();
}
```

### `%AsyncIteratorPrototype%.@@asyncDispose()`

We propose to add `Symbol.asyncDispose` to the built-in `%AsyncIteratorPrototype%` as if it had the following behavior:

```js
%AsyncIteratorPrototype%[Symbol.asyncDispose] = async function () {
  await this.return();
}
```

### Other Possibilities

We could also consider adding `Symbol.dispose` to such objects as the return value from `Proxy.revocable()`, but that
is currently out of scope for the current proposal.

## The Common `Disposable` and `AsyncDisposable` Interfaces

### The `Disposable` Interface

An object is _disposable_ if it conforms to the following interface:

| Property | Value | Requirements |
|:-|:-|:-|
| `@@dispose` | A function that performs explicit cleanup. | The function should return `undefined`. |

**TypeScript Definition**
```ts
interface Disposable {
  /**
   * Disposes of resources within this object.
   */
  [Symbol.dispose](): void;
}
```

### The `AsyncDisposable` Interface

An object is _async disposable_ if it conforms to the following interface:

| Property | Value | Requirements |
|:-|:-|:-|
| `@@asyncDispose` | An async function that performs explicit cleanup. | The function should return a `Promise`. |

**TypeScript Definition**
```ts
interface AsyncDisposable {
  /**
   * Disposes of resources within this object.
   */
  [Symbol.asyncDispose](): Promise<void>;
}
```

## The `DisposableStack` and `AsyncDisposableStack` container objects

This proposal adds two global objects that can act as containers to aggregate disposables, guaranteeing that every
disposable resource in the container is disposed when the respective disposal method is called. If any disposable in the
container throws an error during dispose, it would be thrown at the end (possibly wrapped in a `SuppressedError` if
multiple errors were thrown):

```js
class DisposableStack {
  constructor();

  /**
   * Gets a value indicating whether the stack has been disposed.
   * @returns {boolean}
   */
  get disposed();

  /**
   * Alias for `[Symbol.dispose]()`.
   */
  dispose();

  /**
   * Adds a resource to the top of the stack. Has no effect if provided `null` or `undefined`.
   * @template {Disposable | null | undefined} T
   * @param {T} value - A `Disposable` object, `null`, or `undefined`.
   * @returns {T} The provided value.
   */
  use(value);

  /**
   * Adds a non-disposable resource and a disposal callback to the top of the stack.
   * @template T
   * @param {T} value - A resource to be disposed.
   * @param {(value: T) => void} onDispose - A callback invoked to dispose the provided value.
   * @returns {T} The provided value.
   */
  adopt(value, onDispose);

  /**
   * Adds a disposal callback to the top of the stack.
   * @param {() => void} onDispose - A callback to evaluate when this object is disposed.
   * @returns {void}
   */
  defer(onDispose);

  /**
   * Moves all resources currently in this stack into a new `DisposableStack`.
   * @returns {DisposableStack} The new `DisposableStack`.
   */
  move();

  /**
   * Disposes of resources within this object.
   * @returns {void}
   */
  [Symbol.dispose]();

  [Symbol.toStringTag];
}
```

`AsyncDisposableStack` is the async version of `DisposableStack` and is a container used to aggregate async disposables,
guaranteeing that every disposable resource in the container is disposed when the respective disposal method is called.
If any disposable in the container throws an error during dispose, or results in a rejected `Promise`, it would be
thrown at the end (possibly wrapped in a `SuppressedError` if multiple errors were thrown):

These classes provided the following capabilities:
- Aggregation
- Interoperation and customization
- Assist in complex construction

> **NOTE:** `DisposableStack` is inspired by Python's
> [`ExitStack`](https://docs.python.org/3/library/contextlib.html#contextlib.ExitStack).

> **NOTE:** `AsyncDisposableStack` is inspired by Python's
> [`AsyncExitStack`](https://docs.python.org/3/library/contextlib.html#contextlib.AsyncExitStack).

### Aggregation

The `DisposableStack` and `AsyncDisposableStack` classes provid the ability to aggregate multiple disposable resources
into a single container. When the `DisposableStack` container is disposed, each object in the container is also
guaranteed to be disposed (barring early termination of the program). If any resource throws an error during dispose,
it will be collected and rethrown after all resources are disposed. If there were multiple errors, they will be wrapped
in nested `SuppressedError` objects.

For example:

```js
// sync
const stack = new DisposableStack();
const resource1 = stack.use(getResource1());
const resource2 = stack.use(getResource2());
const resource3 = stack.use(getResource3());
stack[Symbol.dispose](); // disposes of resource3, then resource2, then resource1
```

```js
// async
const stack = new AsyncDisposableStack();
const resource1 = stack.use(getResource1());
const resource2 = stack.use(getResource2());
const resource3 = stack.use(getResource3());
await stack[Symbol.asyncDispose](); // dispose and await disposal result of resource3, then resource2, then resource1
```

If all of `resource1`, `resource2` and `resource3` were to throw during disposal, this would produce an exception
similar to the following:

```js
new SuppressedError(
  /*error*/ exception_from_resource3_disposal,
  /*suppressed*/ new SuppressedError(
    /*error*/ exception_from_resource2_disposal,
    /*suppressed*/ exception_from_resource1_disposal
  )
)
```

### Interoperation and Customization

The `DisposableStack` and `AsyncDisposableStack` classes also provide the ability to create a disposable resource from a
simple callback. This callback will be executed when the stack's disposal method is executed.

The ability to create a disposable resource from a callback has several benefits:

- It allows developers to leverage `using`/`await using` while working with existing resources that do not conform to the
  `Symbol.dispose`/`Symbol.asyncDispose` mechanic:
  ```js
  {
    using stack = new DisposableStack();
    const reader = stack.adopt(createReader(), reader => reader.releaseLock());
    ...
  }
  ```
- It grants user the ability to schedule other cleanup work to evaluate at the end of the block similar to Go's
  `defer` statement:
  ```js
  function f() {
    using stack = new DisposableStack();
    console.log("enter");
    stack.defer(() => console.log("exit"));
    ...
  }
  ```

### Assist in Complex Construction

A user-defined disposable class might need to allocate and track multiple nested resources that should be disposed when
the class instance is disposed. However, properly managing the lifetime of these nested resources in the class
constructor can sometimes be difficult. The `move` method of `DisposableStack`/`AsyncDisposableStack` helps to more
easily manage lifetime in these scenarios:

```js
// sync
class PluginHost {
  #disposed = false;
  #disposables;
  #channel;
  #socket;

  constructor() {
    // Create a DisposableStack that is disposed when the constructor exits.
    // If construction succeeds, we move everything out of `stack` and into
    // `#disposables` to be disposed later.
    using stack = new DisposableStack();

    // Create an IPC adapter around process.send/process.on("message").
    // When disposed, it unsubscribes from process.on("message").
    this.#channel = stack.use(new NodeProcessIpcChannelAdapter(process));

    // Create a pseudo-websocket that sends and receives messages over
    // a NodeJS IPC channel.
    this.#socket = stack.use(new NodePluginHostIpcSocket(this.#channel));

    // If we made it here, then there were no errors during construction and
    // we can safely move the disposables out of `stack` and into `#disposables`.
    this.#disposables = stack.move();

    // If construction failed, then `stack` would be disposed before reaching
    // the line above. Event handlers would be removed, allowing `#channel` and
    // `#socket` to be GC'd.
  }

  loadPlugin(file) {
    // A disposable should try to ensure access is consistent with its "disposed" state, though this isn't strictly
    // necessary since some disposables could be reusable (i.e., a Connection with an `open()` method, etc.).
    if (this.#disposed) throw new ReferenceError("Object is disposed.");
    // ...
  }

  [Symbol.dispose]() {
    if (!this.#disposed) {
      this.#disposed = true;
      const disposables = this.#disposables;

      // NOTE: we can free `#socket` and `#channel` here since they will be disposed by the call to
      // `disposables[Symbol.dispose]()`, below. This isn't strictly a requirement for every Disposable, but is
      // good housekeeping since these objects will no longer be useable.
      this.#socket = undefined;
      this.#channel = undefined;
      this.#disposables = undefined;

      // Dispose all resources in `disposables`
      disposables[Symbol.dispose]();
    }
  }
}
```

```js
// async
const privateConstructorSentinel = {};

class AsyncPluginHost {
  #disposed = false;
  #disposables;
  #channel;
  #socket;

  /** @private */
  constructor(arg) {
    if (arg !== privateConstructorSentinel) throw new TypeError("Use AsyncPluginHost.create() instead");
  }
  
  // NOTE: there's no such thing as an async constructor
  static async create() {
    const host = new AsyncPluginHost(privateConstructorSentinel);

    // Create an AsyncDisposableStack that is disposed when the constructor exits.
    // If construction succeeds, we move everything out of `stack` and into
    // `#disposables` to be disposed later.
    await using stack = new AsyncDisposableStack();


    // Create an IPC adapter around process.send/process.on("message").
    // When disposed, it unsubscribes from process.on("message").
    host.#channel = stack.use(new NodeProcessIpcChannelAdapter(process));

    // Create a pseudo-websocket that sends and receives messages over
    // a NodeJS IPC channel.
    host.#socket = stack.use(new NodePluginHostIpcSocket(host.#channel));

    // If we made it here, then there were no errors during construction and
    // we can safely move the disposables out of `stack` and into `#disposables`.
    host.#disposables = stack.move();

    // If construction failed, then `stack` would be asynchronously disposed before reaching
    // the line above. Event handlers would be removed, allowing `#channel` and
    // `#socket` to be GC'd.
    return host;
  }

  loadPlugin(file) {
    // A disposable should try to ensure access is consistent with its "disposed" state, though this isn't strictly
    // necessary since some disposables could be reusable (i.e., a Connection with an `open()` method, etc.).
    if (this.#disposed) throw new ReferenceError("Object is disposed.");
    // ...
  }

  async [Symbol.asyncDispose]() {
    if (!this.#disposed) {
      this.#disposed = true;
      const disposables = this.#disposables;

      // NOTE: we can free `#socket` and `#channel` here since they will be disposed by the call to
      // `disposables[Symbol.asyncDispose]()`, below. This isn't strictly a requirement for every disposable, but is
      // good housekeeping since these objects will no longer be useable.
      this.#socket = undefined;
      this.#channel = undefined;
      this.#disposables = undefined;

      // Dispose all resources in `disposables`
      await disposables[Symbol.asyncDispose]();
    }
  }
}
```

### Subclassing `Disposable` Classes

You can also use a `DisposableStack` to assist with disposal in a subclass constructor whose superclass is disposable:

```js
class DerivedPluginHost extends PluginHost {
  constructor() {
    super();

    // Create a DisposableStack to cover the subclass constructor.
    using stack = new DisposableStack();

    // Defer a callback to dispose resources on the superclass. We use `defer` so that we can invoke the version of
    // `[Symbol.dispose]` on the superclass and not on this or any subclasses.
    stack.defer(() => super[Symbol.dispose]());

    // If any operations throw during subclass construction, the instance will still be disposed, and superclass
    // resources will be freed
    doSomethingThatCouldPotentiallyThrow();

    // As the last step before exiting, empty out the DisposableStack so that we don't dispose ourselves.
    stack.move();
  }
}
```

Here, we can use `stack` to track the result of `super()` (i.e., the `this` value). If any exception occurs during
subclass construction, we can ensure that `[Symbol.dispose]()` is called, freeing resources. If the subclass also needs
to track its own disposable resources, this example is modified slightly:

```js
class DerivedPluginHostWithOwnDisposables extends PluginHost {
  #logger;
  #disposables;

  constructor() {
    super()

    // Create a DisposableStack to cover the subclass constructor.
    using stack = new DisposableStack();

    // Defer a callback to dispose resources on the superclass. We use `defer` so that we can invoke the version of
    // `[Symbol.dispose]` on the superclass and not on this or any subclasses.
    stack.defer(() => super[Symbol.dispose]());

    // Create a logger that uses the file system and add it to our own disposables.
    this.#logger = stack.use(new FileLogger());

    // If any operations throw during subclass construction, the instance will still be disposed, and superclass
    // resources will be freed
    doSomethingThatCouldPotentiallyThrow();

    // Persist our own disposables. If construction fails prior to the call to `stack.move()`, our own disposables
    // will be disposed before they are set, and then the superclass `[Symbol.dispose]` will be invoked.
    this.#disposables = stack.move();
  }

  [Symbol.dispose]() {
    this.#logger = undefined;

    // Dispose of our resources and those of our superclass. We do not need to invoke `super[Symbol.dispose]()` since
    // that is already tracked by the `stack.defer` call in the constructor.
    this.#disposables[Symbol.dispose]();
  }
}
```

In this example, we can simply add new resources to the `stack` and move its contents into the subclass instance's
`this.#disposables`. In the subclass `[Symbol.dispose]()` method we don't need to call `super[Symbol.dispose]()` since
that has already been tracked by the `stack.defer` call in the constructor.

# Relation to `Iterator` and `for..of`

Iterators in ECMAScript also employ a "cleanup" step by way of supplying a `return` method. This means that there is
some similarity between a `using` declaration and a `for..of` statement:

```js
// using
function f() {
  using x = ...;
  // use x
} // x is disposed


// for..of
function makeDisposableScope() {
  const resources = [];
  let state = 0;
  return {
    next() {
      switch (state) {
        case 0:
          state++;
          return {
            done: false,
            value: {
              use(value) {
                resources.unshift(value);
                return value;
              }
            }
          };
        case 1:
          state++;
          for (const value of resources) {
            value?.[Symbol.dispose]();
          }
        default:
          state = -1;
          return { done: true };
      }
    },
    return() {
      switch (state) {
        case 1:
          state++;
          for (const value of resources) {
            value?.[Symbol.dispose]();
          }
        default:
          state = -1;
          return { done: true };
      }
    },
    [Symbol.iterator]() { return this; }
  }
}

function f() {
  for (const { use } of makeDisposableScope()) {
    const x = use(...);
    // use x
  } // x is disposed
}
```

However there are a number drawbacks to using `for..of` as an alternative:

- Exceptions in the body are swallowed by exceptions from disposables.
- `for..of` implies iteration, which can be confusing when reading code.
- Conflating `for..of` and resource management could make it harder to find documentation, examples, StackOverflow
  answers, etc.
- A `for..of` implementation like the one above cannot control the scope of `use`, which can make lifetimes confusing:
  ```js
  for (const { use } of ...) {
    const x = use(...); // ok
    setImmediate(() => {
      const y = use(...); // wrong lifetime
    });
  }
  ```
- Significantly more boilerplate compared to `using`.
- Mandates introduction of a new block scope, even at the top level of a function body.
- Control flow analysis of a `for..of` loop cannot infer definite assignment since a loop could potentially have zero
  elements:
  ```js
  // using
  function f1() {
    /** @type {string | undefined} */
    let x;
    {
      using y = ...;
      x = y.text;
    }
    x.toString(); // x is definitely assigned
  }

  // for..of
  function f2() {
    /** @type {string | undefined} */
    let x;
    for (const { use } of ...) {
      const y = use(...);
      x = y.text;
    }
    x.toString(); // possibly an error in a static analyzer since `x` is not guaranteed to have been assigned.
  }
  ```
- Using `continue` and `break` is more difficult if you need to dispose of an iterated value:
  ```js
  // using
  for (using x of iterable) {
    if (!x.ready) continue;
    if (x.done) break;
    ...
  }

  // for..of
  outer: for (const x of iterable) {
    for (const { use } of ...) {
      use(x);
      if (!x.ready) continue outer;
      if (!x.done) break outer;
      ...
    }
  }
  ```

# Relation to DOM APIs

This proposal does not necessarily require immediate support in the HTML DOM specification, as existing APIs can still
be adapted by using `DisposableStack` or `AsyncDisposableStack`. However, there are a number of APIs that could benefit
from this proposal and should be considered by the relevant standards bodies. The following is by no means a complete
list, and primarily offers suggestions for consideration. The actual implementation is at the discretion of the relevant
standards bodies.

- `AudioContext` &mdash; `@@asyncDispose()` as an alias or [wrapper][] for `close()`.
  - NOTE: `close()` here is asynchronous, but uses the same name as similar synchronous methods on other objects.
- `BroadcastChannel` &mdash; `@@dispose()` as an alias or [wrapper][] for `close()`.
- `EventSource` &mdash; `@@dispose()` as an alias or [wrapper][] for `close()`.
- `FileReader` &mdash; `@@dispose()` as an alias or [wrapper][] for `abort()`.
- `IDbTransaction` &mdash; `@@dispose()` could invoke `abort()` if the transaction is still in the active state:
  ```js
  {
    using tx = db.transaction(storeNames);
    // ...
    if (...) throw new Error();
    // ...
    tx.commit();
  } // implicit tx.abort() if we don't reach the explicit tx.commit()
  ```
- `ImageBitmap` &mdash; `@@dispose()` as an alias or [wrapper][] for `close()`.
- `IntersectionObserver` &mdash; `@@dispose()` as an alias or [wrapper][] for `disconnect()`.
- `MediaKeySession` &mdash; `@@asyncDispose()` as an alias or [wrapper][] for `close()`.
  - NOTE: `close()` here is asynchronous, but uses the same name as similar synchronous methods on other objects.
- `MessagePort` &mdash; `@@dispose()` as an alias or [wrapper][] for `close()`.
- `MutationObserver` &mdash; `@@dispose()` as an alias or [wrapper][] for `disconnect()`.
- `PaymentRequest` &mdash; `@@asyncDispose()` could invoke `abort()` if the payment is still in the active state.
  - NOTE: `abort()` here is asynchronous, but uses the same name as similar synchronous methods on other objects.
- `PerformanceObserver` &mdash; `@@dispose()` as an alias or [wrapper][] for `disconnect()`.
- `PushSubscription` &mdash; `@@asyncDispose()` as an alias or [wrapper][] for `unsubscribe()`.
- `ReadableStream` &mdash; `@@asyncDispose()` as an alias or [wrapper][] for `cancel()`.
- `ReadableStreamDefaultReader` &mdash; Either `@@dispose()` as an alias or [wrapper][] for `releaseLock()`, or
  `@@asyncDispose()` as a [wrapper][] for `cancel()` (but probably not both).
- `RTCPeerConnection` &mdash; `@@dispose()` as an alias or [wrapper][] for `close()`.
- `RTCRtpTransceiver` &mdash; `@@dispose()` as an alias or [wrapper][] for `stop()`.
- `ReadableStreamDefaultController` &mdash; `@@dispose()` as an alias or [wrapper][] for `close()`.
- `ReadableStreamDefaultReader` &mdash; Either `@@dispose()` as an alias or [wrapper][] for `releaseLock()`, or
- `ResizeObserver` &mdash; `@@dispose()` as an alias or [wrapper][] for `disconnect()`.
- `ServiceWorkerRegistration` &mdash; `@@asyncDispose()` as a [wrapper][] for `unregister()`.
- `SourceBuffer` &mdash; `@@dispose()` as a [wrapper][] for `abort()`.
- `TransformStreamDefaultController` &mdash; `@@dispose()` as an alias or [wrapper][] for `terminate()`.
- `WebSocket` &mdash; `@@dispose()` as a [wrapper][] for `close()`.
- `Worker` &mdash; `@@dispose()` as an alias or [wrapper][] for `terminate()`.
- `WritableStream` &mdash; `@@asyncDispose()` as an alias or [wrapper][] for `close()`.
  - NOTE: `close()` here is asynchronous, but uses the same name as similar synchronous methods on other objects.
- `WritableStreamDefaultWriter` &mdash; Either `@@dispose()` as an alias or [wrapper][] for `releaseLock()`, or
  `@@asyncDispose()` as a [wrapper][] for `close()` (but probably not both).
- `XMLHttpRequest` &mdash; `@@dispose()` as an alias or [wrapper][] for `abort()`.

In addition, several new APIs could be considered that leverage this functionality:

- `EventTarget.prototype.addEventListener(type, listener, { subscription: true }) -> Disposable` &mdash; An option
  passed to `addEventListener` could
  return a `Disposable` that removes the event listener when disposed.
- `Performance.prototype.measureBlock(measureName, options) -> Disposable` &mdash; Combines `mark` and `measure` into a
  block-scoped disposable:
  ```js
  function f() {
    using measure = performance.measureBlock("f"); // marks on entry
    // ...
  } // marks and measures on exit
  ```
- `SVGSVGElement` &mdash; A new method producing a [single-use disposer][] for `pauseAnimations()` and `unpauseAnimations()`.
- `ScreenOrientation` &mdash; A new method producing a [single-use disposer][] for `lock()` and `unlock()`.

### Definitions

A _<dfn><a name="wrapper"></a>wrapper</dfn> for `x()`_ is a method that invokes `x()`, but only if the object is in a state
such that calling `x()` will not throw as a result of repeated evaluation.

A _<dfn><a name="adapter"></a>callback-adapting wrapper</dfn>_ is a _wrapper_ that adapts a continuation passing-style method
that accepts a callback into a `Promise`-producing method.

A _<dfn><a name="disposer"></a>single-use disposer</dfn> for `x()` and `y()`_ indicates a newly constructed disposable object
that invokes `x()` when constructed and `y()` when disposed the first time (and does nothing if the object is disposed
more than once).

# Relation to NodeJS APIs

This proposal does not necessarily require immediate support in NodeJS, as existing APIs can still be adapted by using
`DisposableStack` or `AsyncDisposableStack`. However, there are a number of APIs that could benefit from this proposal
and should be considered by the NodeJS maintainers. The following is by no means a complete list, and primarily offers
suggestions for consideration. The actual implementation is at the discretion of the NodeJS maintainers.

- Anything with `ref()` and `unref()` methods &mdash; A new method or API that produces a [single-use disposer][] for
 `ref()` and `unref()`.
- Anything with `cork()` and `uncork()` methods &mdash; A new method or API that produces a [single-use disposer][] for
 `cork()` and `uncork()`.
- `async_hooks.AsyncHook` &mdash; either `@@dispose()` as an alias or [wrapper][] for `disable()`, or a new method that
  produces a [single-use disposer][] for `enable()` and `disable()`.
- `child_process.ChildProcess` &mdash; `@@dispose()` as an alias or [wrapper][] for `kill()`.
- `cluster.Worker` &mdash; `@@dispose()` as an alias or [wrapper][] for `kill()`.
- `crypto.Cipher`, `crypto.Decipher` &mdash; `@@dispose()` as a [wrapper][] for `final()`.
- `crypto.Hash`, `crypto.Hmac` &mdash; `@@dispose()` as a [wrapper][] for `digest()`.
- `dns.Resolver`, `dnsPromises.Resolver` &mdash; `@@dispose()` as an alias or [wrapper][] for `cancel()`.
- `domain.Domain` &mdash; A new method or API that produces a [single-use disposer][] for `enter()` and `exit()`.
- `events.EventEmitter` &mdash; A new method or API that produces a [single-use disposer][] for `on()` and `off()`.
- `fs.promises.FileHandle` &mdash; `@@asyncDispose()` as an alias or [wrapper][] for `close()`.
- `fs.Dir` &mdash; `@@asyncDispose()` as an alias or [wrapper][] for `close()`, `@@dispose()` as an alias or [wrapper][]
  for `closeSync()`.
- `fs.FSWatcher` &mdash; `@@dispose()` as an alias or [wrapper][] for `close()`.
- `http.Agent` &mdash; `@@dispose()` as an alias or [wrapper][] for `destroy()`.
- `http.ClientRequest` &mdash; Either `@@dispose()` or `@@asyncDispose()` as an alias or [wrapper][] for `destroy()`.
- `http.Server` &mdash; `@@asyncDispose()` as a [callback-adapting wrapper][] for `close()`.
- `http.ServerResponse` &mdash; `@@asyncDispose()` as a [callback-adapting wrapper][] for `end()`.
- `http.IncomingMessage` &mdash; Either `@@dispose()` or `@@asyncDispose()` as an alias or [wrapper][] for `destroy()`.
- `http.OutgoingMessage` &mdash; Either `@@dispose()` or `@@asyncDispose()` as an alias or [wrapper][] for `destroy()`.
- `http2.Http2Session` &mdash; `@@asyncDispose()` as a [callback-adapting wrapper][] for `close()`.
- `http2.Http2Stream` &mdash; `@@asyncDispose()` as a [callback-adapting wrapper][] for `close()`.
- `http2.Http2Server` &mdash; `@@asyncDispose()` as a [callback-adapting wrapper][] for `close()`.
- `http2.Http2SecureServer` &mdash; `@@asyncDispose()` as a [callback-adapting wrapper][] for `close()`.
- `http2.Http2ServerRequest` &mdash; Either `@@dispose()` or `@@asyncDispose()` as an alias or [wrapper][] for
  `destroy()`.
- `http2.Http2ServerResponse` &mdash; `@@asyncDispose()` as a [callback-adapting wrapper][] for `end()`.
- `https.Server` &mdash; `@@asyncDispose()` as a [callback-adapting wrapper][] for `close()`.
- `inspector` &mdash; A new API that produces a [single-use disposer][] for `open()` and `close()`.
- `stream.Writable` &mdash; Either `@@dispose()` or `@@asyncDispose()` as an alias or [wrapper][] for `destroy()` or
  `@@asyncDispose` only as a [callback-adapting wrapper][] for `end()` (depending on whether the disposal behavior
  should be to drop immediately or to flush any pending writes).
- `stream.Readable` &mdash; Either `@@dispose()` or `@@asyncDispose()` as an alias or [wrapper][] for `destroy()`.
- ... and many others in `net`, `readline`, `tls`, `udp`, and `worker_threads`.

# Meeting Notes

* [TC39 July 24th, 2018](https://github.com/tc39/notes/blob/main/meetings/2018-07/july-24.md#explicit-resource-management)
  - [Conclusion](https://github.com/tc39/notes/blob/main/meetings/2018-07/july-24.md#conclusionresolution-7)
    - Stage 1 acceptance
* [TC39 July 23rd, 2019](https://github.com/tc39/notes/blob/main/meetings/2019-07/july-23.md#explicit-resource-management)
  - [Conclusion](https://github.com/tc39/notes/blob/main/meetings/2019-07/july-23.md#conclusionresolution-7)
    - Table until Thursday, inconclusive.
* [TC39 July 25th, 2019](https://github.com/tc39/notes/blob/main/meetings/2019-07/july-25.md#explicit-resource-management-for-stage-2-continuation-from-tuesday)
  - [Conclusion](https://github.com/tc39/notes/blob/main/meetings/2019-07/july-25.md#conclusionresolution-7):
    - Investigate Syntax
    - Approved for Stage 2
    - YK (@wycatz) & WH (@waldemarhorwat) will be stage 3 reviewers
* [TC39 October 10th, 2021](https://github.com/tc39/notes/blob/main/meetings/2021-10/oct-27.md#explicit-resource-management-update)
  - [Conclusion](https://github.com/tc39/notes/blob/main/meetings/2021-10/oct-27.md#conclusionresolution-1)
    - Status Update only
    - WH Continuing to review
    - SYG (@syg) added as reviewer
* [TC39 December 1st, 2022](https://github.com/tc39/notes/blob/main/meetings/2022-11/dec-01.md#explicit-resource-management-for-stage-3) <a name="conditional-advancement"></a>
  - [Conclusion](https://github.com/tc39/notes/blob/main/meetings/2022-11/dec-01.md#conclusionresolution-5)
    - `using` declarations, `Symbol.dispose`, and `DisposableStack` advanced to Stage 3, under the following conditions:
      - Resolution of [#103 - Argument order for `adopt()`](https://github.com/tc39/proposal-explicit-resource-management/issues/130)
      - Deferral of `async using` declarations, `Symbol.asyncDispose`, and `AsyncDisposableStack`.
    - async `using` declarations, `Symbol.asyncDispose`, and `AsyncDisposableStack` remain at Stage 2 as an independent
      proposal.
* [TC39 January 31st, 2023](https://github.com/tc39/notes/blob/main/meetings/2023-01/jan-31.md#explicit-resource-management-stage-3-update)
  - [Conclusion](https://github.com/tc39/notes/blob/main/meetings/2023-01/jan-31.md#conclusionresolution-3)
    - Ban `await` as identifier in `using` (#138) was accepted
    - Support `using` at top level of `eval` (#136) was rejected
      - May consider a needs-consensus PR in the future based on implementer/community feedback.
* [TC39 February 1st, 2023](https://github.com/tc39/notes/blob/main/meetings/2023-01/feb-01.md#async-explicit-resource-management)
  - [Conclusion](https://github.com/tc39/notes/blob/main/meetings/2023-01/feb-01.md#conclusionresolution-5)
    - Rename `Symbol.asyncDispose` to `Symbol.disposeAsync` was rejected
    - Conditional advancement to Stage 3 at March 2023 plenary pending outcome of investigation into `async using` vs.
      `using await` syntax.
* [TC39 March 21st, 2023](https://github.com/tc39/notes/blob/main/meetings/2023-03/mar-21.md#async-explicit-resource-management)
  - [Conclusion](https://github.com/tc39/notes/blob/main/meetings/2023-03/mar-21.md#conclusion-8)
    - Committee resolves to adopt `await using` pending investigation of potential cover grammar.
* [TC39 March 23rd, 2023](https://github.com/tc39/notes/blob/main/meetings/2023-03/mar-23.md#async-explicit-resource-management-again)
  - [Conclusion](https://github.com/tc39/notes/blob/main/meetings/2023-03/mar-23.md#conclusion-5)
    - Stage 3, conditionally on final review of cover grammar by Waldemar Horwat.
    - Consensus on normative change to remove `await` identifier restriction for `using` declarations.

# TODO

The following is a high-level list of tasks to progress through each stage of the [TC39 proposal process](https://tc39.github.io/process-document/):

### Stage 1 Entrance Criteria

* [x] Identified a "[champion][Champion]" who will advance the addition.
* [x] [Prose][Prose] outlining the problem or need and the general shape of a solution.
* [x] Illustrative [examples][Examples] of usage.
* [x] High-level [API][API].

### Stage 2 Entrance Criteria

* [x] [Initial specification text][Specification].
* [ ] [Transpiler support][Transpiler] (_Optional_).

### Stage 3 Entrance Criteria

* [x] [Complete specification text][Specification].
* [x] Designated reviewers have signed off on the current spec text:
  * [x] [Waldemar Horwat][Stage3Reviewer1] has [signed off][Stage3Reviewer1SignOff]
  * [x] [Shu-yu Guo][Stage3Reviewer2] has [signed off][Stage3Reviewer2SignOff]
* [x] The [ECMAScript editor][Stage3Editor] has [signed off][Stage3EditorSignOff] on the current spec text.

### Stage 4 Entrance Criteria

* [ ] [Test262](https://github.com/tc39/test262) acceptance tests have been written for mainline usage scenarios and [merged][Test262PullRequest].
* [ ] Two compatible implementations which pass the acceptance tests: [\[1\]][Implementation1], [\[2\]][Implementation2].
* [x] A [pull request][Ecma262PullRequest] has been sent to tc39/ecma262 with the integrated spec text.
* [ ] The ECMAScript editor has signed off on the [pull request][Ecma262PullRequest].

## Implementations

- Built-ins from this proposal are available in [`core-js`](https://github.com/zloirock/core-js#explicit-resource-management)

<!-- # References -->

<!-- Links to other specifications, etc. -->


<!-- * [Title](url) -->


<!-- # Prior Discussion -->

<!-- Links to prior discussion topics on https://esdiscuss.org -->


<!-- * [Subject](https://esdiscuss.org) -->


<!-- The following are shared links used throughout the README: -->

[Champion]: #status
[Prose]: #motivations
[Examples]: #examples
[API]: #api
[Specification]: https://arai-a.github.io/ecma262-compare/?pr=3000
[Transpiler]: #todo
[Stage3Reviewer1]: https://github.com/tc39/proposal-explicit-resource-management/issues/71
[Stage3Reviewer1SignOff]: https://github.com/tc39/proposal-explicit-resource-management/issues/71#issuecomment-1325842256
[Stage3Reviewer2]: https://github.com/tc39/proposal-explicit-resource-management/issues/93
[Stage3Reviewer2SignOff]: #todo
[Stage3Editor]: https://github.com/tc39/proposal-explicit-resource-management/issues/72
[Stage3EditorSignOff]: #todo
[Test262PullRequest]: #todo
[Implementation1]: #todo
[Implementation2]: #todo
[Ecma262PullRequest]: https://github.com/tc39/ecma262/pull/3000
[wrapper]: #wrapper
[callback-adapting wrapper]: #adapter
[single-use disposer]: #disposer

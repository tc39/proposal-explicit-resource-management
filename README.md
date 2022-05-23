# ECMAScript Explicit Resource Management

This proposal intends to address a common pattern in software development regarding
the lifetime and management of various resources (memory, I/O, etc.). This pattern
generally includes the allocation of a resource and the ability to explicitly
release critical resources.

For example, ECMAScript Generator Functions expose this pattern through the
`return` method, as a means to explicitly evaluate `finally` blocks to ensure
user-defined cleanup logic is preserved:

```js
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

As such, we propose the adoption of a syntax to simplify this common pattern:

```js
function * g() {
  using const handle = acquireFileHandle(); // block-scoped critical resource

  // or, if `handle` binding is unused:
  using const void = acquireFileHandle(); // block-scoped critical resource
} // cleanup

{
  using const obj = g(); // block-scoped declaration
  const r = obj.next();
} // calls finally blocks in `g`
```

In addition, we propose the addition of two disposable container objects to assist
with managing multiple resources:

- `DisposableStack` &mdash; A stack-based container of disposable resources.
- `AsyncDisposableStack` &mdash; A stack-based container of asynchronously disposable resources.

## Status

**Stage:** 2
**Champion:** Ron Buckton (@rbuckton)
**Last Presented:** February, 2020 ([slides](https://1drv.ms/p/s!AjgWTO11Fk-TkeB6DLlm_TQxuD-sPQ?e=SwMLMY), [notes](https://github.com/tc39/notes/blob/master/meetings/2020-02/february-5.md#updates-on-explicit-resource-management))

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
  using const a = ..., b = ...;
  ...
  ```
- Non-blocking memory/IO applications:
  ```js
  import { ReaderWriterLock } from "...";
  const lock = new ReaderWriterLock();

  export async function readData() {
    // wait for outstanding writer and take a read lock
    using const void = await lock.read();
    ... // any number of readers
    await ...;
    ... // still in read lock after `await`
  } // release the read lock

  export async function writeData(data) {
    // wait for all readers and take a write lock
    using const void = await lock.write();
    ... // only one writer
    await ...;
    ... // still in write lock after `await`
  } // release the write lock
  ```

# Prior Art

<!-- Links to similar concepts in existing languages, prior proposals, etc. -->

- C#:
  - [`using` statement](https://docs.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/using-statement)
  - [`using` declaration](https://docs.microsoft.com/en-us/dotnet/csharp/language-reference/proposals/csharp-8.0/using#using-declaration)
- Java: [`try`-with-resources statement](https://docs.oracle.com/javase/tutorial/essential/exceptions/tryResourceClose.html)
- Python: [`with` statement](https://docs.python.org/3/reference/compound_stmts.html#the-with-statement)

# Definitions

- Resource &mdash; An object with a specific lifetime, at the end of which either a lifetime-sensitive operation should be performed or a non-gargbage-collected reference (such as a file handle, socket, etc.) should be closed or freed.
- Resource Management &mdash; A process whereby "resources" are released, triggering any lifetime-sensitive operations or freeing any related non-garbage-collected references.
- Implicit Resource Management &mdash; Indicates a system whereby the lifetime of a "resource" is managed implicitly by the runtime as part of garbage collection, such as:
  - `WeakMap` keys
  - `WeakSet` values
  - `WeakRef` values
  - `FinalizationRegistry` entries
- Explicit Resource Management &mdash; Indicates a system whereby the lifetime of a "resource" is managed explicitly by the user either imperatively (by directly calling a method like `Symbol.dispose`) or declaratively (through a block-scoped declaration like `using const`).

# Syntax

## `using const` Declarations

```js
// for a synchronously-disposed resource (block scoped):
using const x = expr1;                              // resource w/ local binding
using const void = expr;                            // resource w/o local binding
using const y = expr2, void = expr3, z = expr4;     // multiple resources

// for an asynchronously-disposed resource (block scoped):
using await const x = expr1;                          // resource w/ local binding
using await const void = expr;                        // resource w/o local binding
using await const y = expr2, void = expr3, z = expr3; // multiple resources
```

# Grammar

<!-- Grammar for the proposal. Please use grammarkdown (github.com/rbuckton/grammarkdown#readme)
     syntax in fenced code blocks as grammarkdown is the grammar format used by ecmarkup. -->

```grammarkdown
LexicalDeclaration[In, Yield, Await] :
  LetOrConst BindingList[?In, ?Yield, ?Await, ~Using] `;`
  UsingConst[?Await] BindingList[?In, ?Yield, ?Await, +Using] `;`

UsingConst[Await] :
  `using` [no LineTerminator here] `const`
  [+Await] `using` [no LineTerminator here] `await` [no LineTerminator here] `const`

BindingList[In, Yield, Await, Using] :
  LexicalBinding[?In, ?Yield, ?Await, ?Using]
  BindingList[?In, ?Yield, ?Await, ?Using] `,` LexicalBinding[?In, ?Yield, ?Await, ?Using]

LexicalBinding[In, Yield, Await, Using] :
  BindingIdentifier[?Yield, ?Await] Initializer[?In, ?Yield, ?Await]?
  [~Using] BindingPattern[?Yield, ?Await] Initializer[?In, ?Yield, ?Await]
  [+Using] `void` Initializer[?In, ?Yield, ?Await]

ForDeclaration[Yield, Await] :
  LetOrConst ForBinding[?Yield, ?Await, ~Using]
  UsingConst[?Await] ForBinding[?Yield, ?Await, +Using]

ForBinding[Yield, Await, Using] :
  BindingIdentifier[?Yield, ?Await]
  [~Using] BindingPattern[?Yield, ?Await]
```

# Semantics

## `using const` Declarations

### `using const` with Explicit Local Bindings

```grammarkdown
LexicalDeclaration :
  `using` `const` BindingList `;`

LexicalBinding :
    BindingIdentifier Initializer
```

When `using const` is parsed with _BindingIdentifier_ _Initializer_, the bindings created in the declaration
are tracked for disposal at the end of the containing _Block_, _Script_, or _Module_:

```js
{
  ...
  using const x = expr1;
  ...
}
```

The above example has similar runtime semantics as the following transposed
representation:

```js
{
  const $$try = { stack: [], exception: undefined };
  try {
    ...

    const x = expr1;
    if (x !== null && x !== undefined) {
      const $$dispose = x[Symbol.dispose];
      if (typeof $$dispose !== "function") {
        throw new TypeError();
      }
      $$try.stack.push({ value: x, dispose: $$dispose });
    }

    ...
  }
  catch ($$error) {
    $$try.exception = { cause: $$error };
  }
  finally {
    const $$errors = [];
    while ($$try.stack.length) {
      const { value: $$expr, dispose: $$dispose } = $$try.stack.pop();
      try {
        $$dispose.call($$expr);
      }
      catch ($$error) {
        $$errors.push($$error);
      }
    }
    if ($$errors.length > 0) {
      throw new AggregateError($$errors, undefined, $$try.exception);
    }
    if ($$try.exception) {
      throw $$try.exception.cause;
    }
  }
}
```

If exceptions are thrown both in the block following the `using const` declaration and in the call to
`[Symbol.dispose]()`, all exceptions are reported.

### `using const` with Existing Resources

```grammarkdown
LexicalDeclaration :
    `using` `const` BindingList `;`
    `using` `await` `const` BindingList `;`

LexicalBinding :
    `void` Initializer
```

When `using const` is parsed with `void` _Initializer_, an implicit block-scoped binding is
created for the result of the expression. When the _Block_ (or _Script_/_Module_ at the top level)
containing the `using const` statement is exited, whether by an abrupt or normal completion,
`[Symbol.dispose]()` is called on the implicit binding as long as it is neither `null` nor `undefined`.
If an error is thrown in both the containing _Block_/_Script_/_Module_ and the call to `[Symbol.dispose]()`,
an `AggregateError` containing both errors will be thrown instead.

```js
{
  ...
  using const void = expr; // in Block scope
  ...
}
```

The above example has similar runtime semantics as the following transposed
representation:

```js
{
  const $$try = { stack: [], exception: undefined };
  try {
    ...

    const $$expr = expr; // evaluate `expr`
    if ($$expr !== null && $$expr !== undefined) {
      const $$dispose = $$expr[Symbol.dispose];
      if (typeof $$dispose !== "function") throw new TypeError();
      $$try.stack.push({ value: $$expr, dispose: $$dispose });
    }

    ...
  }
  catch ($$error) {
    $$try.exception = { cause: $$error };
  }
  finally {
    const $$errors = [];
    while ($$try.stack.length) {
      const { value: $$expr, dispose: $$dispose } = $$try.stack.pop();
      try {
        $$dispose.call($$expr);
      }
      catch ($$error) {
        $$errors.push($$error);
      }
    }
    if ($$errors.length > 0) {
      throw new AggregateError($$errors, undefined, $$try.exception);
    }
    if ($$try.exception) {
      throw $$try.exception.cause;
    }
  }
}
```

The local block-scoped binding ensures that if `expr` above is reassigned, we still correctly close
the resource we are explicitly tracking.

### `using const` with Multiple Resources

A `using const` declaration can mix multiple explicit (i.e., `using const x = expr`) and implicit (i.e.,
`using const void = expr`) bindings in the same declaration:

```js
{
  ...
  using const x = expr1, void = expr2, y = expr3;
  ...
}
```

These bindings are again used to perform resource disposal when the _Block_, _Script_, or _Module_
exits, however in this case `[Symbol.dispose]()` is invoked in the reverse order of their
declaration. This is _approximately_ equivalent to the following:

```js
{
  ...
  using const x = expr1;
  using const void = expr2;
  using const y = expr2;
  ...
}
```

Both of the above cases would have similar runtime semantics as the following transposed
representation:

```js
{
  const $$try = { stack: [], exception: undefined };
  try {
    ...

    const x = expr1;
    if (x !== null && x !== undefined) {
      const $$dispose = x[Symbol.dispose];
      if (typeof $$dispose !== "function") throw new TypeError();
      $$try.stack.push({ value: x, dispose: $$dispose });
    }

    const $$expr = expr2; // evaluate `expr2`
    if ($$expr !== null && $$expr !== undefined) {
      const $$dispose = $$expr[Symbol.dispose];
      if (typeof $$dispose !== "function") throw new TypeError();
      $$try.stack.push({ value: $$expr, dispose: $$dispose });
    }

    const y = expr3;
    if (y !== null && y !== undefined) {
      const $$dispose = y[Symbol.dispose];
      if (typeof $$dispose !== "function") throw new TypeError();
      $$try.stack.push({ value: y, dispose: $$dispose });
    }

    ...
  }
  catch ($$error) {
    $$try.exception = { cause: $$error };
  }
  finally {
    const $$errors = [];
    while ($$try.stack.length) {
      const { value: $$expr, dispose: $$dispose } = $$try.stack.pop();
      try {
        $$dispose.call($$expr);
      }
      catch ($$error) {
        $$errors.push($$error);
      }
    }
    if ($$errors.length > 0) {
      throw new AggregateError($$errors, undefined, $$try.exception);
    }
    if ($$try.exception) {
      throw $$try.exception.cause;
    }
  }
}
```

Since we must always ensure that we properly release resources, we must ensure that any abrupt
completion that might occur during binding initialization results in evaluation of the cleanup
step. When there are multiple declarations in the list, we track each resource in the order they
are declared. As a result, we must release these resources in reverse order.

### `using const` on `null` or `undefined` Values

This proposal has opted to ignore `null` and `undefined` values provided to the `using const`
declaration. This is similar to the behavior of `using` in C#, which also allows `null`. One
primary reason for this behavior is to simplify a common case where a resource might be optional,
without requiring duplication of work or needless allocations:

```js
if (isResourceAvailable()) {
  using const resource = getResource();
  ... // (1) above
  resource.doSomething()
  ... // (2) above
}
else {
  // duplicate code path above
  ... // (1) above
  ... // (2) above
}
```

Compared to:

```js
using const resource = isResourceAvailable() ? getResource() : undefined;
... // (1) do some work with or without resource
resource?.doSomething();
... // (2) do some other work with or without resource
```

### `using const` on Values Without `[Symbol.dispose]`

If a resource does not have a callable `[Symbol.dispose]` member (or `[Symbol.asyncDispose]` in the
case of a `using await const`), a `TypeError` would be thrown **immediately** when the resource is tracked.

### `using await const` in _AsyncFunction_, _AsyncGeneratorFunction_, or _Module_

In an _AsyncFunction_ or an _AsyncGeneratorFunction_, or the top-level of a _Module_, when we evaluate a
`using await const` declaration we first look for a `[Symbol.asyncDispose]` method before looking for a
`[Symbol.dispose]` method. At the end of the containing _Block_ or _Module_ if the method
returns a value other than `undefined`, we Await the value before exiting:

```js
{
  ...
  using await const x = expr;
  ...
}
```

Is semantically equivalent to the following transposed representation:


```js
{
  const $$try = { stack: [], exception: undefined };
  try {
    ...

    const x = expr;
    if (x !== null && x !== undefined) {
      let $$dispose = x[Symbol.asyncDispose];
      if ($$dispose === undefined) {
        $$dispose = x[Symbol.dispose];
      }
      if (typeof $$dispose !== "function") throw new TypeError();
      $$try.stack.push({ value: x, dispose: $$dispose });
    }

    ...
  }
  catch ($$error) {
    $$try.exception = { cause: $$error };
  }
  finally {
    const $$errors = [];
    while ($$try.stack.length) {
      const { value: $$expr, dispose: $$dispose } = $$try.stack.pop();
      try {
        const $$result = $$dispose.call($$expr);
        if ($$result !== undefined) {
          await $$result;
        }
      }
      catch ($$error) {
        $$errors.push($$error);
      }
    }
    if ($$errors.length > 0) {
      throw new AggregateError($$errors, undefined, $$try.exception);
    }
    if ($$try.exception) {
      throw $$try.exception.cause;
    }
  }
}
```

### `using const` in `for-of` and `for-await-of` Loops

A `using const` or `using await const` declaration can occur in the _ForDeclaration_ of a `for-of` or `for-await-of` loop:

```js
for (using const x of iterateResources()) {
  // use x
}
```

In this case, the value bound to `x` in each iteration will be disposed at the end of each iteration. This will not dispose resources that are not iterated, such as if iteration is terminated early due to `return`, `break`, or `throw`.

Neither `using const` nor `using await const` can be used in a `for-in` loop.

# Examples

The following show examples of using this proposal with various APIs, assuming those APIs adopted this proposal.

### WHATWG Streams API
```js
{
  using const reader = stream.getReader();
  const { value, done } = reader.read();
} // reader is disposed
```

### NodeJS FileHandle
```js
{
  using const f1 = await fs.promises.open(s1, constants.O_RDONLY),
              f2 = await fs.promises.open(s2, constants.O_WRONLY);
  const buffer = Buffer.alloc(4092);
  const { bytesRead } = await f1.read(buffer);
  await f2.write(buffer, 0, bytesRead);
} // both handles are closed
```

### Transactional Consistency (ACID/3PC)
```js
// roll back transaction if either action fails
{
  using await const tx = transactionManager.startTransaction(account1, account2);
  await account1.debit(amount);
  await account2.credit(amount);

  // mark transaction success
  tx.succeeded = true;
} // transaction is committed
```

### Logging and tracing
```js
// audit privileged function call entry and exit
function privilegedActivity() {
  using const void = auditLog.startActivity("privilegedActivity"); // log activity start
  ...
} // log activity end
```

### Async Coordination
```js
import { Semaphore } from "...";
const sem = new Semaphore(1); // allow one participant at a time

export async function tryUpdate(record) {
  using const void = await sem.wait(); // asynchronously block until we are the sole participant
  ...
} // synchronously release semaphore and notify the next participant
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
  using const void = Atomics.Mutex.lock(mut);

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
  using const void = Atomics.Mutex.lock(mut);

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
  using const void = Atomics.Mutex.lock(mut);

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

This proposal adds the properties `dispose` and `asyncDispose` to the `Symbol` constructor whose
values are the `@@dispose` and `@@asyncDispose` internal symbols, respectively:

**Well-known Symbols**
| Specification Name | \[\[Description]] | Value and Purpose |
|:-|:-|:-|
| _@@dispose_ | *"Symbol.dispose"* | A method that explicitly disposes of resources held by the object. Called by the semantics of the `using const` statements. |
| _@@asyncDispose_ | *"Symbol.asyncDispose"* | A method that asynchronosly explicitly disposes of resources held by the object. Called by the semantics of the `using await const` statement. |

**TypeScript Definition**
```ts
interface SymbolConstructor {
  readonly dispose: unique symbol;
  readonly asyncDispose: unique symbol;
}
```

## Built-in Disposables

### `%IteratorPrototype%.@@dispose()`

We also propose to add `@@dispose` to the built-in `%IteratorPrototype%` as if it had the following behavior:

```js
%IteratorPrototype%[Symbol.dispose] = function () {
  this.return();
}
```

### `%AsyncIteratorPrototype%.@@asyncDispose()`

We propose to add `@@asyncDispose` to the built-in `%AsyncIteratorPrototype%` as if it had the following behavior:

```js
%AsyncIteratorPrototype%[Symbol.asyncDispose] = async function () {
  await this.return();
}
```

### Other Possibilities

We could also consider adding `@@dispose` to such objects as the return value from `Proxy.revocable()`, but that
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

## `DisposableStack` and `AsyncDisposableStack` container objects

This proposal adds two global objects that can as containers to aggregate disposables, guaranteeing
that every disposable resource in the container is disposed when the respective disposal method is
called. If any disposable in the container throws an error, they would be collected and an
`AggregateError` would be thrown at the end:

```js
class DisposableStack {
  constructor();

  /**
   * Gets a bound function that when called invokes `Symbol.dispose` on this object.
   * @returns {() => void} A function that when called disposes of any resources currently in this stack.
   */
  get dispose();

  /**
   * Adds a resource to the top of the stack.
   * @template {Disposable | (() => void) | null | undefined} T
   * @param {T} value - A `Disposable` object, or a callback to evaluate
   * when this object is disposed.
   * @returns {T} The provided value.
   */
  use(value);
  /**
   * Adds a resource to the top of the stack.
   * @template T
   * @param {T} value - A resource to be disposed.
   * @param {(value: T) => void} onDispose - A callback invoked to dispose the provided value.
   * @returns {T} The provided value.
   */
  use(value, onDispose);

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
  static get [Symbol.species]();
}

class AsyncDisposableStack {
  constructor();

  /**
   * Gets a bound function that when called invokes `Symbol.disposeAsync` on this object.
   * @returns {() => void} A function that when called disposes of any resources currently in this stack.
   */
  get disposeAsync();

  /**
   * Adds a resource to the top of the stack.
   * @template {AsyncDisposable | Disposable | (() => void | Promise<void>) | null | undefined} T
   * @param {T} value - An `AsyncDisposable` or `Disposable` object, or a callback to evaluate
   * when this object is disposed.
   * @returns {T} The provided value.
   */
  use(value);
  /**
   * Adds a resource to the top of the stack.
   * @template T
   * @param {T} value - A resource to be disposed.
   * @param {(value: T) => void | Promise<void>} onDisposeAsync - A callback invoked to dispose the provided value.
   * @returns {T} The provided value.
   */
  use(value, onDisposeAsync);

  /**
   * Moves all resources currently in this stack into a new `AsyncDisposableStack`.
   * @returns {AsyncDisposableStack} The new `AsyncDisposableStack`.
   */
  move();

  /**
   * Asynchronously disposes of resources within this object.
   * @returns {Promise<void>}
   */
  [Symbol.asyncDispose]();

  [Symbol.toStringTag];
  static get [Symbol.species]();
}
```

These classes provided the following capabilities:
- Aggregation
- Interoperation and customization
- Assist in complex construction

NOTE: `DisposableStack` and `AsyncDisposableStack` are inspired by Python's 
[`ExitStack`](https://docs.python.org/3/library/contextlib.html#contextlib.ExitStack) and 
[`AsyncExitStack`](https://docs.python.org/3/library/contextlib.html#contextlib.AsyncExitStack).

### Aggregation

The `DisposableStack` and `AsyncDisposableStack` classes provide the ability to aggregate multiple disposable resources into a
single container. When the `DisposableStack` container is disposed, each object in the container is also guaranteed to be
disposed (barring early termination of the program). Any exceptions thrown as resources in the container are disposed
will be collected and rethrown as an `AggregateError`.

For example:

```js
const stack = new DisposableStack();
stack.use(getResource1());
stack.use(getResource2());
stack[Symbol.dispose](); // disposes of resource2, then resource1
```

### Interoperation and Customization

The `DisposableStack` and `AsyncDisposableStack` classes also provide the ability to create a disposable resource from a simple
callback. This callback will be executed when the stack's disposal method is executed.

The ability to create a disposable resource from a callback has several benefits:

- It allows developers to leverage `using const` while working with existing resources that do not conform to the
  `Symbol.dispose` mechanic:
  ```js
  {
    using const stack = new DisposableStack();
    const reader = ...;
    stack.use(() => reader.releaseLock());
    ...
  }
  ```
- It grants user the ability to schedule other cleanup work to evaluate at the end of the block similar to Go's
  `defer` statement:
  ```js
  function f() {
    using const stack = new DisposableStack();
    console.log("enter");
    stack.use(() => console.log("exit"));
    ...
  }
  ```

### Assist in Complex Construction

A user-defined disposable class might need to allocate and track multiple nested resources that should be disposed when
the class instance is disposed. However, properly managing the lifetime of these nested resources in the class constructor
can sometimes be difficult. The `move` method of `DisposableStack`/`AsyncDisposableStack` helps to more easily manage 
lifetime in these scenarios:

```js
class PluginHost {
  #disposables;
  #channel;
  #socket;

  constructor() {
    // Create a DisposableStack that is disposed when the constructor exits.
    // If construction succeeds, we move everything out of `stack` and into
    // `#disposables` to be disposed later.
    using const stack = new DisposableStack();

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

  [Symbol.dispose]() {
    this.#disposables[Symbol.dispose]();
  }
}
```

# Relation to `Iterator` and `for..of`

Iterators in ECMAScript also employ a "cleanup" step by way of supplying a `return` method. This means that there is some similarity between a
`using const` declaration and a `for..of` statement:

```js
// using const
function f() {
  using const x = ...;
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
- Conflating `for..of` and resource management could make it harder to find documentation, examples, StackOverflow answers, etc.
- A `for..of` implementation like the one above cannot control the scope of `use`, which can make lifetimes confusing:
  ```js
  for (const { use } of ...) {
    const x = use(...); // ok
    setImmediate(() => {
      const y = use(...); // wrong lifetime
    });
  }
  ```
- Significantly more boilerplate compared to `using const`.
- Mandates introduction of a new block scope, even at the top level of a function body.
- Control flow analysis of a `for..of` loop cannot infer definite assignment since a loop could potentially have zero elements:
  ```js
  // using const
  function f1() {
    /** @type {string | undefined} */
    let x;
    {
      using const y = ...;
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

# Relation to DOM APIs

This proposal does not necessarily require immediate support in the HTML DOM specification, as existing APIs can still be adapted by
using `DisposableStack`. However, there are a number of APIs that could benefit from this proposal and should be considered by the
relevant standards bodies. The following is by no means a complete list, and primarily offers suggestions for consideration. The actual
implementation is at the discretion of the relevant standards bodies.

- `AudioContext` &mdash; `@@asyncDispose()` as an alias for `close()`.
  - NOTE: `close()` here is asynchronous, but uses the same name as similar synchronous methods on other objects.
- `BroadcastChannel` &mdash; `@@dispose()` as an alias for `close()`.
- `EventSource` &mdash; `@@dispose()` as an alias for `close()`.
- `FileReader` &mdash; `@@dispose()` as an alias for `abort()`.
- `IDbTransaction` &mdash; `@@dispose()` could invoke `abort()` if the transaction is still in the active state:
  ```js
  {
    using const tx = db.transaction(storeNames);
    // ...
    if (...) throw new Error();
    // ...
    tx.commit();
  } // implicit tx.abort() if we don't reach the explicit tx.commit()
  ```
- `ImageBitmap` &mdash; `@@dispose()` as an alias for `close()`.
- `IntersectionObserver` &mdash; `@@dispose()` as an alias for `disconnect()`.
- `MediaKeySession` &mdash; `@@asyncDispose()` as an alias for `close()`.
  - NOTE: `close()` here is asynchronous, but uses the same name as similar synchronous methods on other objects.
- `MessagePort` &mdash; `@@dispose()` as an alias for `close()`.
- `MutationObserver` &mdash; `@@dispose()` as an alias for `disconnect()`.
- `PaymentRequest` &mdash; `@@asyncDispose()` as an alias for `abort()`.
  - NOTE: `abort()` here is asynchronous, but uses the same name as similar synchronous methods on other objects.
- `PerformanceObserver` &mdash; `@@dispose()` as an alias for `disconnect()`.
- `PushSubscription` &mdash; `@@asyncDispose()` as an alias for `unsubscribe()`.
- `RTCPeerConnection` &mdash; `@@dispose()` as an alias for `close()`.
- `RTCRtpTransceiver` &mdash; `@@dispose()` as an alias for `stop()`.
- `ReadableStream` &mdash; `@@asyncDispose()` as an alias for `cancel()`.
- `ReadableStreamDefaultController` &mdash; `@@dispose()` as an alias for `close()`.
- `ReadableStreamDefaultReader` &mdash; Either `@@dispose()` as an alias for `releaseLock()`, or `@@asyncDispose()` as a wrapper for `cancel()` (but probably not both).
- `ResizeObserver` &mdash; `@@dispose()` as an alias for `disconnect()`.
- `ServiceWorkerRegistration` &mdash; `@@asyncDispose()` as a wrapper for `unregister()`.
- `SourceBuffer` &mdash; `@@dispose()` as a wrapper for `abort()`.
- `TransformStreamDefaultController` &mdash; `@@dispose()` as an alias for `terminate()`.
- `WebSocket` &mdash; `@@dispose()` as a wrapper for `close()`.
- `Worker` &mdash; `@@dispose()` as an alias for `terminate()`.
- `WritableStream` &mdash; `@@asyncDispose()` as an alias for `close()`.
  - NOTE: `close()` here is asynchronous, but uses the same name as similar synchronous methods on other objects.
- `WritableStreamDefaultWriter` &mdash; Either `@@dispose()` as an alias for `releaseLock()`, or `@@asyncDispose()` as a wrapper for `close()` (but probably not both).
- `XMLHttpRequest` &mdash; `@@dispose()` as an alias for `abort()`.

In addition, several new APIs could be considered that leverage this functionality:

- `EventTarget.prototype.addEventListener(type, listener, { subscription: true }) -> Disposable` &mdash; An option passed to `addEventListener` could
  return a `Disposable` that removes the event listener when disposed.
- `Performance.prototype.measureBlock(measureName, options) -> Disposable` &mdash; Combines `mark` and `measure` into a block-scoped disposable:
  ```js
  function f() {
    using const void = performance.measureBlock("f"); // marks on entry
    // ...
  } // marks and measures on exit
  ```
- A wrapper for `pauseAnimations()` and `unpauseAnimations()` in `SVGSVGElement`.
- A wrapper for `lock()` and `unlock()` in `ScreenOrientation`.

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
* [ ] Designated reviewers have [signed off][Stage3ReviewerSignOff] on the current spec text.
* [ ] The ECMAScript editor has [signed off][Stage3EditorSignOff] on the current spec text.

### Stage 4 Entrance Criteria

* [ ] [Test262](https://github.com/tc39/test262) acceptance tests have been written for mainline usage scenarios and [merged][Test262PullRequest].
* [ ] Two compatible implementations which pass the acceptance tests: [\[1\]][Implementation1], [\[2\]][Implementation2].
* [ ] A [pull request][Ecma262PullRequest] has been sent to tc39/ecma262 with the integrated spec text.
* [ ] The ECMAScript editor has signed off on the [pull request][Ecma262PullRequest].



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
[Specification]: https://tc39.es/proposal-explicit-resource-management
[Transpiler]: #todo
[Stage3ReviewerSignOff]: #todo
[Stage3EditorSignOff]: #todo
[Test262PullRequest]: #todo
[Implementation1]: #todo
[Implementation2]: #todo
[Ecma262PullRequest]: #todo

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
  using value acquireFileHandle(); // block-scoped critical resource
} // cleanup

{
  using const obj = g(); // block-scoped declaration
  const r = obj.next();
} // calls finally blocks in `g`
```

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
    using value await lock.read();
    ... // any number of readers
    await ...; 
    ... // still in read lock after `await`
  } // release the read lock
  
  export async function writeData(data) {
    // wait for all readers and take a write lock
    using value await lock.write();
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

# Syntax

## `using value` Statements and `using const` Declarations

```js
// for a synchronously-disposed resource (block scoped):
using value expr;                         // no local binding
using const x = expr1;                    // local binding
using const y = expr2, z = expr3;         // multiple bindings

// for an asynchronously-disposed resource (block scoped):
using await value expr;                   // no local binding
using await const x = expr1;              // local binding
using await const y = expr2, z = expr3;   // multiple bindings
```

# Grammar

<!-- Grammar for the proposal. Please use grammarkdown (github.com/rbuckton/grammarkdown#readme) 
     syntax in fenced code blocks as grammarkdown is the grammar format used by ecmarkup. -->

```grammarkdown
Statement[Yield, Await, Return] :
  ...
  UsingValueStatement[?Yield, ?Await]

UsingValueStatement[Yield, Await] :
  `using` [no LineTerminator here] `value` AssignmentExpression[+In, ?Yield, ?Await] `;`
  [+Await] `using` [no LineTerminator here] `await` [no LineTerminator here] `value` AssignmentExpression[+In, ?Yield, +Await] `;`

LexicalDeclaration[In, Yield, Await] :
  LetOrConst BindingList[?In, ?Yield, ?Await, ~Using] `;`
  `using` [no LineTerminator here] `const` BindingList[?In, ?Yield, ?Await, +Using] `;`
  [+Await] `using` [no LineTerminator here] `await` [no LineTerminator here] `const` BindingList[?In, ?Yield, +Await, +Using] `;`

BindingList[In, Yield, Await, Using] :
  LexicalBinding[?In, ?Yield, ?Await, ?Using]
  BindingList[?In, ?Yield, ?Await, ?Using] `,` LexicalBinding[?In, ?Yield, ?Await, ?Using]

LexicalBinding[In, Yield, Await, Using] :
  BindingIdentifier[?Yield, ?Await] Initializer[?In, ?Yield, ?Await]?
  [~Using] BindingPattern[?Yield, ?Await] Initializer[?In, ?Yield, ?Await]
```

# Semantics

## `using value` Statements and `using const` Declarations

### `using value` with Existing Resources

```grammarkdown
UsingValueStatement : 
    `using` `value` Expression `;`
    `using` `await` `value` Expression `;`
```

When `using value` is parsed with an _Expression_, an implicit block-scoped binding is created for the 
result of the expression. When the _Block_ (or _Script_/_Module_ at the top level) containing the 
`using value` statement is exited, whether by an abrupt or normal completion, `[Symbol.dispose]()` is 
called on the local binding as long as it is neither `null` nor `undefined`. If an error is thrown in 
both the containing _Block_/_Script_/_Module_ and the call to `[Symbol.dispose]()`, an
`AggregateError` containing both errors will be thrown instead.

```js
{
  ...
  using value expr; // in Block scope
  ...
}
```

The above example has similar runtime semantics as the following transposed 
representation:

```js
{ 
  const $$try = { stack: [], errors: [] };
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
    $$try.errors.push($$error);
  }
  finally {
    while ($$try.stack.length) {
      const { value: $$expr, dispose: $$dispose } = $$try.stack.pop();
      try {
        $$dispose.call($$expr);
      }
      catch ($$error) {
        $$try.errors.push($$error);
      }
    }
    if ($$try.errors.length > 1) {
      throw new AggregateError($$try.errors);
    }
    if ($$try.errors.length === 1) {
      throw $$try.errors[0];
    }
  }
}
```

The local block-scoped binding ensures that if `expr` above is reassigned, we still correctly close 
the resource we are explicitly tracking.

### `using const` with Explicit Local Bindings

```grammarkdown
LexicalDeclaration :
  `using` `const` BindingList `;`
```

When `using const` is parsed we track the bindings created in the declaration for disposal at the end of
the containing _Block_, _Script_, or _Module_:

```js
{
  ...
  using const x = expr1, y = expr2;
  ...
}
```

These implicit bindings are again used to perform resource disposal when the _Block_, _Script_, or _Module_ 
exits, however in this case `[Symbol.dispose]()` is called on the implicit bindings in the reverse order of their
declaration. This is _approximately_ equivalent to the following:

```js
{
  using const x = expr1;
  {
    using const y = expr2;
    ...
  }
}
```

Both of the above cases would have similar runtime semantics as the following transposed
representation:

```js
{
  const $$try = { stack: [], errors: [] };
  try {
    ...

    const x = expr1;
    if (x !== null && x !== undefined) {
      const $$dispose = x[Symbol.dispose];
      if (typeof $$dispose !== "function") throw new TypeError();
      $$try.stack.push({ value: x, dispose: $$dispose });
    }

    const y = expr2;
    if (y !== null && y !== undefined) {
      const $$dispose = y[Symbol.dispose];
      if (typeof $$dispose !== "function") throw new TypeError();
      $$try.stack.push({ value: y, dispose: $$dispose });
    }

    ...
  }
  catch ($$error) {
    $$try.errors.push($$error);
  }
  finally {
    while ($$try.stack.length) {
      const { value: $$expr, dispose: $$dispose } = $$try.stack.pop();
      try {
        $$dispose.call($$expr);
      }
      catch ($$error) {
        $$try.errors.push($$error);
      }
    }
    if ($$try.errors.length > 1) {
      throw new AggregateError($$try.errors);
    }
    if ($$try.errors.length === 1) {
      throw $$try.errors[0];
    }
  }
}
```

Since we must always ensure that we properly release resources, we must ensure that any abrupt 
completion that might occur during binding initialization results in evaluation of the cleanup 
step. When there are multiple declarations in the list, we track each resource in the order they 
are declared. As a result, we must release these resources in reverse order.


### `using value` and `using const` on `null` or `undefined` Values

This proposal has opted to ignore `null` and `undefined` values provided to the `using value` statement
and `using const` declaration. This is similar to the behavior of `using` in C#, which also allows `null`.
One primary reason for this behavior is to simplify a common case where a resource might be optional, 
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

### `using value` and `using const` on Values Without `[Symbol.dispose]`

If a resource does not have a callable `[Symbol.dispose]` member (or `[Symbol.asyncDispose]` in the 
case of a `using await ...`), a `TypeError` would be thrown **immediately** when the resource is tracked.

### `using await value` and `using await const` in _AsyncFunction_, _AsyncGeneratorFunction_, or _Module_

In an _AsyncFunction_ or an _AsyncGeneratorFunction_, or the top-level of a _Module_, when we evaluate a 
`using await value` statement or `using await const` declaration we first look for a `[Symbol.asyncDispose]` 
method before looking for a `[Symbol.dispose]` method. At the end of the containing block or _Module_,
if the method returns a value other than `undefined`, we Await the value before exiting:

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
  const $$try = { stack: [], errors: [] };
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
    $$try.errors.push($$error);
  }
  finally {
    while ($$try.stack.length) {
      const { value: $$expr, dispose: $$dispose } = $$try.stack.pop();
      try {
        const $$result = $$dispose.call($$expr);
        if ($$result !== undefined) {
          await $$result;
        }
      }
      catch ($$error) {
        $$try.errors.push($$error);
      }
    }
    if ($$try.errors.length > 1) {
      throw new AggregateError($$try.errors);
    }
    if ($$try.errors.length === 1) {
      throw $$try.errors[0];
    }
  }
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

# Examples

The following show examples of using this proposal with various APIs, assuming those APIs adopted this proposal.

**WHATWG Streams API**
```js
{
  using const reader = stream.getReader();
  const { value, done } = reader.read();
}
```

**NodeJS FileHandle**
```js
{
  using const f1 = fs.promises.open(s1, constants.O_RDONLY),
              f2 = fs.promises.open(s2, constants.O_WRONLY);
  const buffer = Buffer.alloc(4092);
  const { bytesRead } = await f1.read(buffer);
  await f2.write(buffer, 0, bytesRead);
} // both handles are closed
```

**Transactional Consistency (ACID)**
```js
// roll back transaction if either action fails
{
  using const tx = transactionManager.startTransaction(account1, account2);
  await account1.debit(amount);
  await account2.credit(amount);

  // mark transaction success
  tx.succeeded = true;
} // transaction is committed
```

**Logging and tracing**
```js
// audit privileged function call entry and exit
function privilegedActivity() {
  using value auditLog.startActivity("privilegedActivity"); // log activity start
  ...
} // log activity end
```

**Async Coordination**
```js
import { Semaphore } from "...";
const sem = new Semaphore(1); // allow one participant at a time

export async function tryUpdate(record) {
  using value await sem.wait(); // asynchronously block until we are the sole participant
  ...
} // synchronously release semaphore and notify the next participant
```

# API

## Additions to `Symbol`

This proposal adds the properties `dispose` and `asyncDispose` to the `Symbol` constructor whose 
values are the `@@dispose` and `@@asyncDispose` internal symbols, respectively:

**Well-known Symbols**
| Specification Name | \[\[Description]] | Value and Purpose |
|:-|:-|:-|
| _@@dispose_ | *"Symbol.dispose"* | A method that explicitly disposes of resources held by the object. Called by the semantics of the `using const` and `using value` statements. |
| _@@asyncDispose_ | *"Symbol.asyncDispose"* | A method that asynchronosly explicitly disposes of resources held by the object. Called by the semantics of the `using await const` and `using await value` statements. |

**TypeScript Definition**
```ts
interface SymbolConstructor {
  readonly dispose: symbol;
  readonly asyncDispose: symbol;
}
```

In addition, the methods `[Symbol.dispose]` and `[Symbol.asyncDispose]` methods would be added to 
%GeneratorPrototype% and %AsyncGeneratorPrototype%, respectively. Each method, when called, calls 
the `return` method on those prototypes.

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
| `@@asyncDispose` | An async function that performs explicit cleanup. | The function must return a `Promise`. |

**TypeScript Definition**
```ts
interface AsyncDisposable {
  /**
   * Disposes of resources within this object.
   */
  [Symbol.asyncDispose](): Promise<void>;
}
```

## `Disposable` and `AsyncDisposable` container objects

This proposal adds two global objects that can as containers to aggregate disposables, guaranteeing 
that every disposable resource in the container is disposed when the respective disposal method is 
called. If any disposable in the container throws an error, they would be collected and an 
`AggregateError` would be thrown at the end:

```js
class Disposable {
  /**
   * @param {Iterable<Disposable>} disposables - An iterable containing objects to be disposed 
   * when this object is disposed.
   * @returns {Disposable}
   */
  static from(disposables);

  /**
   * @param {() => void} onDispose - A callback to execute when this object is disposed.
   */
  constructor(onDispose);

  /**
   * Disposes of resources within this object.
   */
  [Symbol.dispose]();
}

class AsyncDisposable {
  /**
   * @param {Iterable<Disposable | AsyncDisposable>} disposables - An iterable containing objects 
   * to be disposed when this object is disposed.
   */
  static from(disposables);

  /**
   * @param {() => void | Promise<void>} onAsyncDispose - A callback to execute when this object is
   * disposed.
   */
  constructor(onAsyncDispose);

  /**
   * Asynchronously disposes of resources within this object.
   * @returns {Promise<void>}
   */
  [Symbol.asyncDispose]();
}
```

The `Disposable` and `AsyncDisposable` classes each provide two capabilities:
- Aggregation
- Interoperation and Customization

### Aggregation

The `Disposable` and `AsyncDisposable` classes provide the ability to aggregate multiple disposable resources into a 
single container. When the `Disposable` container is disposed, each object in the container is also guaranteed to be 
disposed (barring early termination of the program). Any exceptions thrown as resources in the container are disposed
will be collected and rethrown as an `AggregateError`.

### Interoperation and Customization

The `Disposable` and `AsyncDisposable` classes also provide the ability to create a disposable resource from a simple 
callback. This callback will be executed when the resource's `Symbol.dispose` method (or `Symbol.asyncDispose` method, for an `AsyncDisposable`) is executed.

The ability to create a disposable resource from a callback has several benefits:

- It allows developers to leverage `using const`/`using value` while working with existing resources that do not conform to the 
  `Symbol.dispose` mechanic:
  ```js
  {
    const reader = ...;
    using value new Disposable(() => reader.releaseLock());
    ...
  }
  ```
- It grants user the ability to schedule other cleanup work to evaluate at the end of the block similar to Go's 
  `defer` statement:
  ```js
  function f() {
    console.log("enter");
    using value new Disposable(() => console.log("exit"));
    ...
  }
  ```

# Meeting Notes

* [TC39 July 24th, 2018](https://tc39.es/tc39-notes/2018-07_july-24.html#explicit-resource-management)
  - [Conclusion](https://tc39.es/tc39-notes/2018-07_july-24.html#conclusionresolution-explicit-resource-management)
    - Stage 1 acceptance
* [TC39 July 23rd, 2019](https://tc39.es/tc39-notes/2019-07_july-23.html#explicit-resource-management)
  - [Conclusion](https://tc39.es/tc39-notes/2019-07_july-23.html#conclusionresolution-explicit-resource-management)
    - Table until Thursday, inconclusive.
* [TC39 July 25th, 2019](https://tc39.es/tc39-notes/2019-07_july-25.html#explicit-resource-management-for-stage-2-continuation-from-tuesdayhttpsgithubcomtc39tc39-notesblobmastermeetings2019-07july-23mdexplicit-resource-management)
  - [Conclusion](https://tc39.es/tc39-notes/2019-07_july-25.html#conclusionresolution-explicit-resource-management-for-stage-2-continuation-from-tuesdayhttpsgithubcomtc39tc39-notesblobmastermeetings2019-07july-23mdexplicit-resource-management):
    - Investigate Syntax
    - Approved for Stage 2
    - YK (@wycatz) & WH (@waldemarhorwat) will be stage 3 reviewers

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

* [ ] [Complete specification text][Specification].  
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

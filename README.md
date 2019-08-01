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
  try using (const handle = acquireFileHandle()) { // critical resource
    ...
  } // cleanup
}

try using (const obj = g()) {
  const r = obj.next();
  ...
} // calls finally blocks in `g`
```

## Status

**Stage:** 2  
**Champion:** Ron Buckton (@rbuckton)

_For more information see the [TC39 proposal process](https://tc39.es/process-document/)._

## Authors

- Ron Buckton (@rbuckton)

# Motivations

This proposal is motivated by a number of cases:

- Inconsistent patterns for resource management:
  - ECMAScript Iterators: `iterator.return()`
  - WHATWG Stream Readers: `reader.releaseLock()`
  - NodeJS FileHandles: `handle.close()`
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
  try using (const a = ..., b = ...) { 
    ...
  }
  ```
- Non memory/IO applications:
  ```js
  import { ReaderWriterLock } from "prex";
  const lock = new ReaderWriterLock(); 
  
  export async function readData() {
    // wait for outstanding writer and take a read lock
    try using (await lock.read()) { 
      ... // any number of readers
      await ...; 
      ... // still in read lock after `await`
    } // release the read lock
  }
  
  export async function writeData(data) {
    // wait for all readers and take a write lock
    try using (await lock.write()) { 
      ... // only one writer
      await ...;
      ... // still in write lock after `await`
    } // release the write lock
  }
  ```

# Prior Art

<!-- Links to similar concepts in existing languages, prior proposals, etc. -->

- C#: [`using` statement](https://docs.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/using-statement)  
- Java: [`try`-with-resources statement](https://docs.oracle.com/javase/tutorial/essential/exceptions/tryResourceClose.html)  
- Python: [`with` statement](https://docs.python.org/3/reference/compound_stmts.html#the-with-statement) 

# Syntax

```js
// for a synchronously-disposed resource:

// 'try' with expression resource
try using (obj) {
  ...
}

// 'try' with local binding
try using (const x = expr1) {
  ...
}

// 'try' with multiple local bindings
try using (const x = expr1, y = expr2) {
  ...
}

// for an asynchronously disposed resource in an async function:

// 'try' with expression resource
try using await (obj) {
  ...
}

// 'try' with local binding
try using await (const x = expr1) {
  ...
}

// 'try' with multiple local bindings
try using await (const x = expr1, y = expr2) {
  ...
}

```

# Grammar

<!-- Grammar for the proposal. Please use grammarkdown (github.com/rbuckton/grammarkdown#readme) 
     syntax in fenced code blocks as grammarkdown is the grammar format used by ecmarkup. -->

```grammarkdown
TryUsingDeclaration[Yield, Await] :
    `const` BindingList[+In, ?Yield, ?Await]

TryStatement[Yield, Await, Return] :
    ...
    `try` `using` `(` [lookahead ≠ `let [`] Expression[+In, ?Yield, ?Await] `)` Block[?Yield, ?Await, ?Return] Catch[?Yield, ?Await, ?Return]? Finally[?Yield, ?Await, ?Return]?
    `try` `using` `(` TryUsingDeclaration[?Yield, ?Await] `)` Block[?Yield, ?Await, ?Return] Catch[?Yield, ?Await, ?Return]? Finally[?Yield, ?Await, ?Return]?
    [+Await] `try` `using` `await` `(` [lookahead ≠ `let [`] Expression[+In, ?Yield, ?Await] `)` Block[?Yield, ?Await, ?Return] Catch[?Yield, ?Await, ?Return]? Finally[?Yield, ?Await, ?Return]?
    [+Await] `try` `using` `await` `(` TryUsingDeclaration[?Yield, ?Await] `)` Block[?Yield, ?Await, ?Return] Catch[?Yield, ?Await, ?Return]? Finally[?Yield, ?Await, ?Return]?
```

# Semantics

## `try`-`using` with existing resources

```grammarkdown
TryStatement : 
    `try` `using` `(` Expression `)` Block Catch? Finally?
    `try` `using` `await` `(` Expression `)` Block Catch? Finally?
```

When `try`-`using` is parsed with an _Expression_, an implicit block-scoped binding is created for the 
result of the expression. When the `try`-`using` block is exited, whether by an abrupt or normal 
completion, `[Symbol.dispose]()` is called on the local binding as long as it is neither `null` 
nor `undefined`. If an error is thrown in both _Block_ and the call to `[Symbol.dispose]()`, an
`AggregateError` containing both errors will be thrown instead.

```js
try using (expr) {
  ...
}
```

The above example has similar runtime semantics as the following transposed 
representation:

```js
{ 
  const $$try = { stack: [], errors: [] };
  try {
    const $$expr = expr;
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

## `try`-`using` with explicit local bindings

```grammarkdown
TryUsingDeclaration :
    `const` BindingList

TryStatement : 
    `try` `using` `(` TryUsingDeclaration `)` Block Catch? Finally?
```

When `try`-`using` is parsed with a _TryUsingDeclaration_ we track the bindings created in the declaration for disposal:

```js
try using (const x = expr1, y = expr2) {
  ...
}
```

These implicit bindings are again used to perform resource disposal when the _Block_ exits, however
in this case `[Symbol.dispose]()` is called on the implicit bindings in the reverse order of their
declaration. This is approximately equivalent to the following:

```js
try using (const x = expr1) {
  try using (const y = expr2) {
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

## `try`-`using` with binding patterns

The `try`-`using` statement tracks disposable resources for each named binding, in the order the bindings
are evaluated:

```js
try using (const { w, z: { x, y } } = expr) {
} // w, x and y are disposed
```

If, instead, it is `expr` that should be disposed, the above could be rewritten as follows:

```js
try using (const _ = expr) {
  const { w, z: { x, y } } = _;
}
```

This behavior was chosen due to the fact it becomes much more complicated to properly track and 
dispose of `w`, `x`, and `y` if we were to dispose of the initializer (`expr`) instead:

```js
{
  const _ = expr;
  let _z; // capture `expr.z` so as not to evaluate twice...
  try using (const w = _.w, x = (_z = _.z).x, y = _z.y) {

  }
}
```

This differs from how destructuring would work in the same scenario, as the completion value for a 
destructuring assignment is always the right-hand value:

```js
// destructuring behavior
let z, x, y;
z = { x, y } = expr;
z === expr; // true

// try-using behavior
let x, y;
try using ({ x, y } = expr) {
} // `expr` is disposed
```

Note that there is a possible refactoring hazard as you might transition between various forms of 
semantically equivalent code. For example, consider the following changes as they might occur over 
time:

```js
// before:
const obj = expr;
try using (obj) {
  const x = obj.x;
  const y = obj.y;
  ...
} // `obj` is disposed


// after refactor into binding pattern:
const obj = expr;
try using (obj) {
  const { x, y } = obj; // `obj` is otherwise unused
  ...
} // `obj` is disposed


// after inline `obj` declaration into `try` statement:
try using (const obj = expr) {
  const { x, y } = obj; // `obj` is otherwise unused
  ...
} // `obj` is disposed


// after refactor away single use of `obj`:
try using (const { x, y } = expr) {
  ...
} // `x` and `y` are disposed!
```

For this reason, we advise refactoring tools to disallow a refactoring that would change the behavior.

## `try`-`using` on `null` or `undefined` values

This proposal has opted to ignore `null` and `undefined` values provided to the `try`-`using` statement. 
This is similar to the behavior of `using` in C# that also allows `null`. One primary reason for this
behavior is to simplify a common case where a resource might be optional, without requiring duplication 
of work or needless allocations:

```js
if (isResourceAvailable()) {
  try using (const resource = getResource()) {
    ... // (1) above
    resource.doSomething()
    ... // (2) above
  }
}
else {
  // duplicate code path above
  ... // (1) above
  ... // (2) above
}
```

Compared to:

```js
try using (const resource = isResourceAvailable() ? getResource() : undefined) {
  ... // (1) do some work with or without resource
  if (resource) resource.doSomething();
  ... // (2) do some other work with or without resource
}
```

## `try`-`using` on values without `[Symbol.dispose]`

If a resource does not have a callable `[Symbol.dispose]` member, a `TypeError` would be thrown 
**immediately** when the resource is tracked.

## `try`-`using` with Catch or Finally

When resources are added to a `try`-`using` block, a _Catch_ or _Finally_ clause may follow. In these cases, the 
_Catch_ and _Finally_ clauses are triggered *after* `[Symbol.dispose]()` is called. This is consistent with
the fact that block-scoped bindings for resources would be unreachable outside of `try`-`using`'s _Block_:

```js
try using (getResource()) { // or `try using (const x = getResource())`
  ...
}
catch {
  // resource has already been disposed
}
finally {
  // resource has already been disposed
}
```

The above example has the similar runtime semantics as the following transposed 
representation:

```js
try {
  const $$try = { stack: [], errors: [] };
  try {
    const $$expr = getResource();
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
catch {
  // resource has already been disposed
}
finally {
  // resource has already been disposed
}
```

## `try using await` in AsyncFunction or AsyncGeneratorFunction

In an _AsyncFunction_ or an _AsyncGeneratorFunction_, when we evaluate a `try`-`using` block we first look 
for a `[Symbol.asyncDispose]` method before looking for a `[Symbol.dispose]` method. At the end of the block,
if the method returns a value other than `undefined`, we Await the value before exiting the block:

```js
try using await (const x = expr) {
  ...
}
```

Is semantically equivalent to the following transposed representation:


```js
{
  const $$try = { stack: [], errors: [] };
  try {
    const $$expr = getResource();
    if ($$expr !== null && $$expr !== undefined) {
      let $$dispose = $$expr[Symbol.asyncDispose];
      if ($$dispose === undefined) {
        $$dispose = $$expr[Symbol.dispose];
      }
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

# Examples

**WHATWG Streams API**
```js
try using (const reader = stream.getReader()) {
  const { value, done } = reader.read();
  ...
}
```

**NodeJS FileHandle**
```js
try using (const f1 = fs.promises.open(f1, constants.O_RDONLY), 
           f2 = fs.promises.open(f2, constants.O_WRONLY)) {
  const buffer = Buffer.alloc(4092);
  const { bytesRead } = await f1.read(buffer);
  await f2.write(buffer, 0, bytesRead);
}
```

**Transactional Consistency (ACID)**
```js
// roll back transaction if either action fails
try using (const tx = transactionManager.startTransaction(account1, account2)) {
  await account1.debit(amount);
  await account2.credit(amount);

  // mark transaction success
  tx.succeeded = true;
}
```

**Other uses**
```js
// audit privileged function call entry and exit
function privilegedActivity() {
  try using (auditLog.startActivity("privilegedActivity")) {
    ...
  }
}
```

# API

This proposal adds the properties `dispose` and `asyncDispose` to the `Symbol` constructor whose 
values are the @@dispose and @@asyncDispose internal symbols, respectively:

```ts
interface SymbolConstructor {
  readonly dispose: symbol;
  readonly asyncDispose: symbol;
}
```

In addition, the methods `[Symbol.dispose]` and `[Symbol.asyncDispose]` methods would be added to 
%GeneratorPrototype% and %AsyncGeneratorPrototype%, respectively. Each method, when called, calls 
the `return` method on those prototypes.

This proposal also adds the `AggregateError` class for cases where exceptions are thrown both in the
`try` _Block_ and from the call to @@dispose (or @@asyncDispose):

```ts
declare class AggregateError extends Error {
  errors: unknown[];
  constructor(errors: Iterable<unknown>, message?: string);
}
```

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

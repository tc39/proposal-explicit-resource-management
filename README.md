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
  try (const handle = acquireFileHandle()) { // critical resource
    ...
  } // cleanup
}

try (const obj = g()) {
  const r = obj.next();
  ...
} // calls finally blocks in `g`
```

* [Stage 0 Presentation](https://docs.google.com/presentation/d/1OmkXFMizf5iYME9ClERZ3C1dwUAhh7-r2YMD-rTzY-Y/edit?usp=sharing)

## Status

**Stage:** 1  
**Champion:** Ron Buckton (@rbuckton)

_For more information see the [TC39 proposal process](https://tc39.github.io/process-document/)._

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
  try (const a = ..., b = ...) { 
    ...
  }
  ```
- Non memory/IO applications:
  ```js
  import { ReaderWriterLock } from "prex";
  const lock = new ReaderWriterLock(); 
  
  export async function readData() {
    // wait for outstanding writer and take a read lock
    try (await lock.read()) { 
      ... // any number of readers
      await ...; 
      ... // still in read lock after `await`
    } // release the read lock
  }
  
  export async function writeData(data) {
    // wait for all readers and take a write lock
    try (await lock.write()) { 
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
// 'try' with expression resource
try (obj) {
  ...
}

// 'try' with local binding
try (const x = expr1) {
  ...
}

// 'try' with multiple local bindings
try (const x = expr1, y = expr2) {
  ...
}
```

# Grammar

<!-- Grammar for the proposal. Please use grammarkdown (github.com/rbuckton/grammarkdown#readme) 
     syntax in fenced code blocks as grammarkdown is the grammar format used by ecmarkup. -->

```grammarkdown
TryWithResourcesDeclaration[Yield, Await] :
    `const` BindingList[+In, ?Yield, ?Await]

TryStatement[Yield, Await, Return] :
    ...
    `try` `(` [lookahead ∉ { `let [` }] Expression[+In, ?Yield, ?Await] `)` Block[?Yield, ?Await, ?Return] 
        Catch[?Yield, ?Await, ?Return]? Finally[?Yield, ?Await, ?Return]?
    `try` `(` TryWithResourcesDeclaration[?Yield, ?Await] `)` Block[?Yield, ?Await, ?Return]
        Catch[?Yield, ?Await, ?Return]? Finally[?Yield, ?Await, ?Return]?
```

# Semantics

## `try` with existing resources

```grammarkdown
TryStatement : 
    `try` `(` Expression `)` Block Catch? Finally?
```

When `try` is parsed with an _Expression_, an implicit block-scoped binding is created for the 
result of the expression. When the `try` block is exited, whether by an abrupt or normal 
completion, `[Symbol.dispose]()` is called on the local binding as long as it is neither `null` 
nor `undefined`. If an error is thrown in both _Block_ and the call to `[Symbol.dispose]()`, an
`AggregateError` containing both errors will be thrown instead.

```js
try (expr) {
  ...
}
```

The above example has the similar runtime semantics as the following transposed 
representation:

```js
{ 
  const $$try = { value: expr, hasError: false, error: undefined };
  try {
    ...
  }
  catch ($$error) {
    $$try.hasError = true;
    $$try.error = $$error;
    throw $$error;
  }
  finally {
    try {
      if ($$try.value !== null && $$try.value !== undefined) {
        $$try.value[Symbol.dispose]();
      }
    }
    catch ($$error) {
      if ($$try.hasError) {
        throw new AggregateError([$$try.error, $$error]);
      }
      throw $$error;
    }
  }
}
```

The local block-scoped binding ensures that if `expr` above is reassigned, we still correctly close 
the resource we are explicitly tracking.

## `try` with explicit local bindings

```grammarkdown
TryStatement: 
    `try` `(` TryWithResourcesDeclaration `)` Block Catch? Finally?
```

When `try` is parsed with a _TryWithResourcesDeclaration_ we create block-scoped bindings for the initializers of each _LexicalBinding_:

```js
try (const x = expr1, y = expr2) {
  ...
}
```

These implicit bindings are again used to perform resource disposal when the _Block_ exits, however
in this case `[Symbol.dispose]()` is called on the implicit bindings in the reverse order of their
declaration. This is equivalent to the following:

```js
try (const x = expr1) {
  try (const y = expr2) {
    ...
  }
}
```

Both of the above cases would have similar runtime semantics as the following transposed
representation:

```js
{
  const $$try1 = { value: expr1, hasError: false, error: undefined };
  try {
    const x = $$try1.value;
    {
      const $$try2 = { value: expr2, hasError: false, error: undefined };
      try {
        const y = $$try1.value;
        ...
      }
      catch ($$error) {
        $$try2.hasError = true;
        $$try2.error = $$error;
        throw $$error;
      }
      finally {
        try {
          if ($$try2.value !== null && $$try2.value !== undefined) {
            $$try2.value[Symbol.dispose]();
          }
        }
        catch ($$error) {
          if ($$try2.hasError) {
            throw new AggregateError([$$try2.error, $$error]);
          }
          throw $$error;
        }
      }
    }
  }
  catch ($$error) {
    $$try1.hasError = true;
    $$try1.error = $$error;
    throw $$error;
  }
  finally {
    try {
      if ($$try1.value !== null && $$try1.value !== undefined) {
        $$try1.value[Symbol.dispose]();
      }
    }
    catch ($$error) {
      if ($$try1.hasError) {
        throw new AggregateError([$$try1.error, $$error]);
      }
      throw $$error;
    }
  }
}
```

Since we must always ensure that we properly release resources, we must ensure that any abrupt 
completion that might occur during binding initialization results in evaluation of the cleanup 
step. This also means that when there are multiple declarations in the list we must create a 
new `try/finally`-like protected region for each declaration. As a result, we must release 
resources in reverse order.

## `try` with binding patterns

The `try` statement always creates implicit local bindings for the _Initializer_ of the 
_LexicalBinding_. For binding patterns this means that we store the value 
of `expr` in the example below, rather than `y`:

```js
try (const { x, y } = expr) {
}
```

This aligns with how destructuring would work in the same scenario, as the completion value for a 
destructuring assignment is always the right-hand value:

```js
let x, y;
try ({ x, y } = expr) {
}
```

This behavior also avoids possible refactoring hazards as you might switch between various forms of 
semantically equivalent code. For example, consider the following changes as they might occur over 
time:

```js
// before:
const obj = expr;
try (obj) {
  const x = obj.x;
  const y = obj.y;
  ...
}


// after refactor into binding pattern:
const obj = expr;
try (obj) {
  const { x, y } = obj; // `obj` is otherwise unused
  ...
}


// after inline `obj` declaration into `try` statement:
try (const obj = expr) {
  const { x, y } = obj; // `obj` is otherwise unused
  ...
}


// after refactor away single use of `obj`:
try (const { x, y } = expr) {
  ...
}
```

In the above example, in all four cases the value of `expr` is what is disposed.

The same result could also be achieved through other refactorings in which each step also results 
in semantically equivalent code:

```js
// before:
let obj = expr, x, y;
try (obj) {
  x = obj.x;
  y = obj.y;
  ...
}


// after refactor into assignment pattern:
let obj = expr, x, y;
try (obj) {
  ({ x, y } = obj);
  ...
}


// after move assignment pattern into head of `try`:
let obj = expr, x, y;
try ({ x, y } = obj) {
  ...
}


// after refactor away single use of `obj`:
let x, y;
try ({ x, y } = expr) {
  ...
}
```

As with the first set of refactorings, in all four cases it is the value of `expr` that is 
disposed.

## `try` on `null` or `undefined` values

This proposal has opted to ignore `null` and `undefined` values provided to the `try` statement. 
This is similar to the behavior of `using` in C# that also allow `null`. One primary 
reason for this behavior is to simplify a common case where a resource might be optional, without 
requiring duplication of work or needless allocations:

```js
if (isResourceAvailable()) {
  try (const resource = getResource()) {
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
try (const resource = isResourceAvailable() ? getResource() : undefined) {
  ... // (1) do some work with or without resource
  if (resource) resource.doSomething();
  ... // (2) do some other work with or without resource
}
```

## `try` on values without `[Symbol.dispose]`

If a resource does not have a callable `[Symbol.dispose]` member, a `TypeError` would be thrown 
**at the end** of the _Block_ when the member would be invoked.

## `try` with resources and Catch or Finally

When resources are added to a `try` block, a _Catch_ or _Finally_ clause may follow. In these cases, the 
_Catch_ and _Finally_ clauses are triggered *after* `[Symbol.dispose]()` is called. This is consistent with
the fact that block-scoped bindings for resources would be unreachable outside of `try`'s _Block_:

```js
try (const resource = getResource()) {
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
  const $$try = { value: getResource(), hasError: false, error: undefined };
  try {
    const resource = $$try.value;
    ...
  }
  catch ($$error) {
    $$try.hasError = true;
    $$try.error = $$error;
    throw $$error;
  }
  finally {
    try {
      if ($$try.value !== null && $$try.value !== undefined) {
        $$try.value[Symbol.dispose]();
      }
    }
    catch ($$error) {
      if ($$try.hasError) {
        throw new AggregateError([$$try.error, $$error]);
      }
      throw $$error;
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


## `try` in AsyncFunction or AsyncGeneratorFunction

In an _AsyncFunction_ or an _AsyncGeneratorFunction_, at the end of a `try` block we first look 
for a `[Symbol.asyncDispose]` method before looking for a `[Symbol.dispose]` method. If we found a 
`[Symbol.asyncDispose]` method, we Await the result of calling it.

# Examples

**WHATWG Streams API**
```js
try (const reader = stream.getReader()) {
  const { value, done } = reader.read();
  ...
}
```

**NodeJS FileHandle**
```js
try (const f1 = fs.promises.open(f1, constants.O_RDONLY), 
           f2 = fs.promises.open(f2, constants.O_WRONLY)) {
  const buffer = Buffer.alloc(4092);
  const { bytesRead } = await f1.read(buffer);
  await f2.write(buffer, 0, bytesRead);
}
```

**Transactional Consistency (ACID)**
```js
// roll back transaction if either action fails
try (const tx = transactionManager.startTransaction(account1, account2)) {
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
  try (auditLog.startActivity("privilegedActivity")) {
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

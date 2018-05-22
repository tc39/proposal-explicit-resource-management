# ECMAScript explicit resource management

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
  using (const handle = acquireFileHandle()) { // critical resource
    ...
  } // cleanup
}

using (const obj = g()) {
  const r = obj.next();
  ...
} // calls finally blocks in `g`
```

* [Stage 0 Presentation](https://docs.google.com/presentation/d/1OmkXFMizf5iYME9ClERZ3C1dwUAhh7-r2YMD-rTzY-Y/edit?usp=sharing)

## Status

**Stage:** 0  
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
  using (const a = ..., b = ...) { 
    ...
  }
  ```
- Non memory/IO applications:
  ```js
  import { ReaderWriterLock } from "prex";
  const lock = new ReaderWriterLock(); 
  
  export async function readData() {
    // wait for outstanding writer and take a read lock
    using (await lock.read()) { 
      ... // any number of readers
      await ...; 
      ... // still in read lock after `await`
    } // release the read lock
  }
  
  export async function writeData(data) {
    // wait for all readers and take a write lock
    using (await lock.write()) { 
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
// using expression
using (obj) {
  ...
}

// using with local binding
using (const x = expr1) {
  ...
}

// using with multiple local bindings
using (const x = expr1, y = expr2) {
  ...
}
```

# Grammar

<!-- Grammar for the proposal. Please use grammarkdown (github.com/rbuckton/grammarkdown#readme) 
     syntax in fenced code blocks as grammarkdown is the grammar format used by ecmarkup. -->

```grammarkdown
UsingStatement[Yield, Await, Return] :
    // NOTE: This will require a cover grammar to handle ambiguity between a call to a 
    // function named `using` and a UsingStatement head.
    `using` `(` [lookahead ∉ { `let [` }] Expression[+In, ?Yield, ?Await] `)` [no LineTerminator here] Block[?Yield, ?Await, ?Return]
    `using` `(` `var` VariableDeclarationList[+In, ?Yield, ?Await] `)` [no LineTerminator here] Block[?Yield, ?Await, ?Return]
    `using` `(` LetOrConst BindingList[+In, ?Yield, ?Await] `)` [no LineTerminator here] Block[?Yield, ?Await, ?Return]
```

**Notes:**

- We define `using` as requiring a `[no LineTerminator here]` restriction to avoid backwards 
  compatibility issues due to ASI, as `using` is not a reserved word.
- In addition `using` requires a _Block_ rather than allowing _Statement_, as it has more in common
  with `try`, `catch`, or `finally` than statements with a similar grammar.
- To avoid ambiguity with _CallExpression_, a cover grammar would be needed.
- We may opt to instead augment _TryStatement_ syntax in a fashion similar to Java's 
  `try`-with-resources, e.g. `try (expr) {}` or `try (let x = expr) {}`, however the oddity of the 
  implied `finally` might be a source of confusion for users.
- We allow `var` declarations for consistency with other control-flow statements
  that support binding declarations in a parenthesized head, such as `for`, 
  `for..in`, and `for..of`.

# Semantics

## `using` existing resources

```grammarkdown
UsingStatement : 
  `using` `(` Expression `)` Block
```

When `using` is parsed with an _Expression_, an implicit block-scoped binding is created for the 
result of the expression. When the `using` block is exited, whether by an abrupt or normal 
completion, `[Symbol.dispose]()` is called on the local binding as long as it is neither `null` 
nor `undefined`.

```js
using (expr) {
  ...
}
```

The above example has the same approximate runtime semantics as the following transposed 
representation:

```js
{ 
  const $$temp = expr;
  try {
    ...
  }
  finally {
    if ($$temp !== null && $$temp !== undefined) $$temp[Symbol.dispose]();
  }
}
```

The local block-scoped binding ensures that if `expr` above is reassigned, we still correctly close 
the resource we are explicitly tracking.

## `using` with explicit local bindings

```grammarkdown
UsingStatement: 
  `using` `(` `var` VariableDeclarationList `)` Block
  `using` `(` LexicalDeclaration `)` Block
```

When `using` is parsed with either a _VariableDeclarationList_ or a _LexicalDeclaration_, we again 
create implicit block-scoped bindings for the initializers of each _VariableDeclaration_ or 
_LexicalBinding_:

```js
using (let x = expr1, y = expr2) {
  ...
}
```

These implicit bindings are again used to perform resource disposal when the _Block_ exits, however
in this case `[Symbol.dispose]()` is called on the implicit bindings in the reverse order of their
declaration. This is equivalent to the following:

```js
using (let x = expr1) {
  using (let y = expr2) {
    ...
  }
}
```

Both of the above cases would have the same runtime semantics as the following transposed
representation:

```js
{
  const $$temp1 = expr1;
  try {
    let x = $$temp1;
    {
      const $$temp2 = expr2;
      try {
        let y = $$temp2;
        ...
      }
      finally {
        if ($$temp2 !== null && $$temp2 !== undefined) $$temp2[Symbol.dispose]();
      }
    }
  }
  finally {
    if ($$temp1 !== null && $$temp1 !== undefined) $$temp1[Symbol.dispose]();
  }
}
```

Since we must always ensure that we properly release resources, we must ensure that any abrupt 
completion that might occur during binding initialization results in evaluation of the cleanup 
step. This also means that when there are multiple declarations in the list we must create a 
new `try/finally`-like protected region for each declaration. As a result, we must release 
resources in reverse order.

## `using` with binding patterns

The `using` statement always creates implicit local bindings for the _Initializer_ of the 
_VariableDeclaration_ or _LexicalBinding_. For binding patterns this means that we store the value 
of `expr` in the example below, rather than `y`:

```js
using (let { x, y } = expr) {
}
```

This aligns with how destructuring would work in the same scenario, as the completion value for a 
destructuring assignment is always the right-hand value:

```js
let x, y;
using ({ x, y } = expr) {
}
```

This behavior also avoids possible refactoring hazards as you might switch between various forms of 
semantically equivalent code. For example, consider the following changes as they might occur over 
time:

```js
// before:
let obj = expr, x, y;
using (obj) {
  x = obj.x;
  y = obj.y;
  ...
}


// after refactor into binding pattern:
let obj = expr;
using (obj) {
  let { x, y } = obj; // `obj` is otherwise unused
  ...
}


// after inline `obj` declaration into `using` statement:
using (let obj = expr) {
  let { x, y } = obj; // `obj` is otherwise unused
  ...
}


// after refactor away single use of `obj`:
using (let { x, y } = expr) {
  ...
}
```

In the above example, in all four cases the value of `expr` is what is disposed.

The same result could also be achieved through other refactorings in which each step also results 
in semantically equivalent code:

```js
// before:
let obj = expr, x, y;
using (obj) {
  x = obj.x;
  y = obj.y;
  ...
}


// after refactor into assignment pattern:
let obj = expr, x, y;
using (obj) {
  ({ x, y } = obj);
  ...
}


// after move assignment pattern into head of `using`:
let obj = expr, x, y;
using ({ x, y } = obj) {
  ...
}


// after refactor away single use of `obj`:
let x, y;
using ({ x, y } = expr) {
  ...
}
```

As with the first set of refactorings, in all four cases it is the value of `expr` that is 
disposed.

## `using` on `null` or `undefined` values

This proposal has opted to ignore `null` and `undefined` values provided to the `using` statement. 
This is similar to the behavior of `using` in languages like C# that also allow `null`. One primary 
reason for this behavior is to simplify a common case where a resource might be optional, without 
requiring duplication of work:

```js
using (const resource = isResourceAvailable() ? getResource() : undefined) {
  ... // (1) do some work with or without resource
  if (resource) resource.doSomething();
  ... // (2) do some other work with or without resource
}
```

Compared to:
```js
if (isResourceAvailable()) {
  using (const resource = getResource()) {
    ... // (1) above
    resource.doSomething()
    ... // (2) above
  }
}
else {
  ... // (1) above
  ... // (2) above
}
```

## `using` on values without `[Symbol.dispose]`

If a resource does not have a callable `[Symbol.dispose]` member, a `TypeError` would be thrown 
**at the end** of the _Block_ when the member would be invoked.

## `using` in AsyncFunction or AsyncGeneratorFunction

In an _AsyncFunction_ or an _AsyncGeneratorFunction_, at the end of a `using` block we first look 
for a `[Symbol.asyncDispose]` method before looking for a `[Symbol.dispose]` method. If we found a 
`[Symbol.asyncDispose]` method, we Await the result of calling it.

# Examples

**WHATWG Streams API**
```js
using (const reader = stream.getReader()) {
  const { value, done } = reader.read();
  ...
}
```

**NodeJS FileHandle**
```js
using (const f1 = fs.promises.open(f1, constants.O_RDONLY), 
             f2 = fs.promises.open(f2, constants.O_WRONLY)) {
  const buffer = Buffer.alloc(4092);
  const { bytesRead } = await f1.read(buffer);
  await f2.write(buffer, 0, bytesRead);
}
```

**Transactional Consistency (ACID)**
```js
// roll back transaction if either action fails
using (const tx = transactionManager.startTransaction(account1, account2)) {
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
  using (auditLog.startActivity("privilegedActivity")) {
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

# TODO


The following is a high-level list of tasks to progress through each stage of the [TC39 proposal process](https://tc39.github.io/process-document/):

### Stage 1 Entrance Criteria

* [x] Identified a "[champion][Champion]" who will advance the addition.  
* [x] [Prose][Prose] outlining the problem or need and the general shape of a solution.  
* [x] Illustrative [examples][Examples] of usage.  
* [x] High-level [API][API].  

### Stage 2 Entrance Criteria

* [ ] [Initial specification text][Specification].  
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
[Specification]: https://rbuckton.github.io/proposal-using
[Transpiler]: #todo
[Stage3ReviewerSignOff]: #todo
[Stage3EditorSignOff]: #todo
[Test262PullRequest]: #todo
[Implementation1]: #todo
[Implementation2]: #todo
[Ecma262PullRequest]: #todo
<!--
Welcome to your new proposal repository. This document will serve as the introduction and 
 strawman for your proposal.

The repository is broken down into the following layout:

  /README.md        # intro/strawman (this file)
  /LICENSE          # ECMA compatible license (BSD-3 Clause)
  /src              # ecmarkup sources for the specification
  /docs             # ecmarkup output

To build the specification, run:

  npm run compile

To preview the specification, run:

  npm run start

It is recommended that you configure GitHub Pages in your GitHub repository to point to the
'/docs' directory after you push these changes to 'master'. That way the specification text
will be updated automatically when you publish.

-->

# ECMAScript explicit resource management

<!-- Replace this with a summary or introduction for your proposal -->

## Status

**Stage:** 0  
**Champion:** _None identified_

_For more information see the [TC39 proposal process](https://tc39.github.io/process-document/)._

<!-- ## Authors -->

<!-- * Name (@name) -->

<!-- # Motivations -->

<!-- Motivations and use cases for the proposal --->

# Prior Art

<!-- Links to similar concepts in existing languages, prior proposals, etc. -->

* C#: [`using` statement](https://docs.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/using-statement)  
* Java: [`try`-with-resources statement](https://docs.oracle.com/javase/tutorial/essential/exceptions/tryResourceClose.html)

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
    `using` `(` [lookahead ∉ { `let [` }] Expression[+In, ?Yield, ?Await] `)` Block[?Yield, ?Await, ?Return]
    `using` `(` `var` VariableDeclarationList[+In, ?Yield, ?Await] `)` Block[?Yield, ?Await, ?Return]
    `using` `(` LexicalDeclaration[+In, ?Yield, ?Await] `)` Block[?Yield, ?Await, ?Return]
```

**Notes:**

- We define `using` as requiring _Block_ rather than _Statement_ to avoid backwards compatibility issues due to ASI, since `using` is not a reserved word.
- We may opt to instead augment _TryStatement_ syntax in a fashion similar to Java's `try`-with-resources, e.g. `try (expr) {}` or `try (let x = expr) {}`, however the oddity of the implied `finally` might be a source of confusion for users. 

# Semantics

## `using` for existing resources

```grammarkdown
UsingStatement : 
  `using` `(` Expression `)` Block
```

When `using` is parsed with an _Expression_, an implicit block-scoped binding is created for the result of the expression. When the `using` block is exited, whether by an abrupt or normal completion, `[Symbol.dispose]()` is called on the local binding as long as it is neither `null` nor `undefined`.

```js
using (expr) {
  ...
}
```

The above example has the same approximate runtime semantics as the following transposed representation:

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

The local block-scoped binding ensures that if `expr` above is reassigned, we still correctly close the resource we are explicitly tracking.

## `using` with explicit local bindings

```grammarkdown
UsingStatement: 
  `using` `(` `var` VariableDeclarationList `)` Block
  `using` `(` LexicalDeclaration `)` Block
```

When `using` is parsed with either a _VariableDeclarationList_ or a _LexicalDeclaration_, we again create implicit block-scoped bindings for the initializers of each _VariableDeclaration_ or _LexicalBinding_. 

```js
using (let x = expr1, y = expr2) {
  ...
}
```

These implicit bindings are again used to perform resource disposal when the _Block_ exits, however in this case `[Symbol.dispose]()` is called on the implicit bindings in the reverse order of their declaration. This is equivalent to the following:

```js
using (let x = expr1) {
  using (let y = expr2) {
    ...
  }
}
```

Both of the above cases would have the same runtime semantics as the following transposed representation:

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

Since we must always ensure that we properly release resources, we must ensure that any abrupt completion that might occur during binding initialization results in evaluation of the cleanup step. This also means that when there are multiple declarations in the list we must create a new `try/finally`-like protected region for each declaration. As a result, we must release resources in reverse order.

### `using` with binding patterns

The `using` statement always creates implicit local bindings for the _Initializer_ of the _VariableDeclaration_ or _LexicalBinding_. For binding patterns this means that we store the value of `expr` in the example below, rather than `y`:

```js
using (let { y } = expr) {
}
```

This aligns with how destructuring would work in the same scenario, as the completion value for a destructuring assignment is always the right-hand value:

```js
let y;
using ({ y } = expr) {
}
```

## `using` on `null` or `undefined` values

This proposal has opted to ignore `null` and `undefined` values provided to the `using` statement. This is primarily to align with the behavior of `using` in languages like C# that also allow `null`.

## `using` on values without `[Symbol.dispose]`

If a resource does not have a callable `[Symbol.dispose]` member, a `TypeError` would be thrown **at the end** of the _Block_ when the member would be invoked.

<!-- # Examples -->

<!-- Examples of the proposal -->


<!--
```js
```
-->


# API

```ts
interface SymbolConstructor {
  readonly dispose: symbol;
}
```

# TODO


The following is a high-level list of tasks to progress through each stage of the [TC39 proposal process](https://tc39.github.io/process-document/):

### Stage 1 Entrance Criteria

* [ ] Identified a "[champion][Champion]" who will advance the addition.  
* [ ] [Prose][Prose] outlining the problem or need and the general shape of a solution.  
* [ ] Illustrative [examples][Examples] of usage.  
* [ ] High-level [API][API].  

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
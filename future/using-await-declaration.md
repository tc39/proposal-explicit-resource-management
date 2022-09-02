# `using await` Declarations for ECMAScript

A `using await` declaration is a variation of the [`using` declaration](../README.md) that is designed to work with
Async Disposable objects, which allow async logic to be evaluated and awaited during disposal. A `using await`
declaration is only permitted in an `[+Await]` context such as the top level of a _Module_ or inside the body of an
async function.

# Example

```js
class Logger {
  write(message) { ... }
  ...
  #disposed = false;
  async [Symbol.asyncDispose]() {
    if (!this.#disposed) {
      this.#disposed = true;
      await this.#flush(); // flush any pending log file writes asynchronously.
      this.#close(); // close file handle.
    }
  }
}

async function main() {
  using await logger = new Logger(); // create logger, async dispose at end of block
  logger.write("started");
  ...
  logger.write("done");

  // implicit `await logger[Symbol.asyncDispose]()` when block exits regardless as to
  // whether by `return`, `throw`, `break`, or `continue`.
}
```

# Status

**Status:** Out of scope

The `using await` declaration has been postponed and deemed out of scope for the original proposal. This is primarily
due to concerns about introducing an implicit `await` without a clear marker at the start or end of the containing
block.

# Alternatives

This could also potentially be addressed by the [`using await` statement](./using-await-statement.md).

# Postponement Implications

Postponing `using await` declarations without also introducing `using await` statements means that we lose the ability
to declaratively register disposal of resources that require async cleanup steps. This affects use cases such as
three-phase commit (3PC) transactions and some async file I/O (i.e., async flush). These still can be accomplished
imperatively via `await obj[Symbol.asyncDispose]()`, but the lack of a syntactic declaration reduces their utility.

# Explainer Snapshot

The following sections were originally part of the [explainer](../README.md).

> # Syntax
>
> ## `using` Declarations
>
> ```js
> // for an asynchronously-disposed resource (block scoped):
> using await x = expr1;                          // resource w/ local binding
> using await void = expr;                        // resource w/o local binding
> using await y = expr2, void = expr3, z = expr3; // multiple resources
> ```
>
> # Grammar
>
> ```grammarkdown
> UsingDeclaration[In, Yield, Await] :
>     ...
>     [+Await] `using` [no LineTerminator here] `await` BindingList[?In, ?Yield, +Await, +Using] `;`
> ```
>
> # Semantics
>
> ## `using` Declarations
>
> ### `using await` Declarations and Values Without `[Symbol.asyncDispose]`
>
> If a resource does not have either a callable `[Symbol.asyncDispose]` member or a callable  `[Symbol.dispose]` member,
> a `TypeError` would be thrown **immediately** when the resource is tracked.
>
> ### `using await` Declarations in _AsyncFunction_, _AsyncGeneratorFunction_, or _Module_
>
> In an _AsyncFunction_, _AsyncGeneratorFunction_, _AsyncArrowFunction_, or the top-level of a _Module_, when we
> evaluate a `using await` declaration we first look for a `[Symbol.asyncDispose]` method before looking for a
> `[Symbol.dispose]` method. At the end of the containing function body, _Block_, or _Module_, if the method returns a
> value other than `undefined`, we **Await** the value before exiting:
>
> ```js
> async function f() {
>   ... // (1)
>   using await x = expr;
>   ... // (2)
> }
> ```
>
> Is semantically equivalent to the following transposed representation:
>
>
> ```js
> async function f() {
>   const $$try = { stack: [], exception: undefined };
>   try {
>     ... // (1)
>
>     const x = expr;
>     if (x !== null && x !== undefined) {
>       let $$dispose = x[Symbol.asyncDispose];
>       if ($$dispose === undefined) {
>         $$dispose = x[Symbol.dispose];
>       }
>       if (typeof $$dispose !== "function") {
>         throw new TypeError();
>       }
>       $$try.stack.push({ value: x, dispose: $$dispose });
>     }
>
>     ... // (2)
>   }
>   catch ($$error) {
>     $$try.exception = { cause: $$error };
>   }
>   finally {
>     const $$errors = [];
>     while ($$try.stack.length) {
>       const { value: $$expr, dispose: $$dispose } = $$try.stack.pop();
>       try {
>         const $$result = $$dispose.call($$expr);
>         if ($$result !== undefined) {
>           await $$result;
>         }
>       }
>       catch ($$error) {
>         $$errors.push($$error);
>       }
>     }
>     if ($$errors.length > 0) {
>       throw new AggregateError($$errors, undefined, $$try.exception);
>     }
>     if ($$try.exception) {
>       throw $$try.exception.cause;
>     }
>   }
> }
> ```
>
> # Examples
>
> The following show examples of using this proposal with various APIs, assuming those APIs adopted this proposal.
>
> ### Transactional Consistency (ACID/3PC)
> ```js
> // roll back transaction if either action fails
> {
>   using await tx = transactionManager.startTransaction(account1, account2);
>   await account1.debit(amount);
>   await account2.credit(amount);
> 
>   // mark transaction success
>   tx.succeeded = true;
> } // transaction is committed
> ```

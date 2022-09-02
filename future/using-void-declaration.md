# `using void` Declarations for ECMAScript

A `using void` declaration is a bindingless variant of the RAII-style [`using` declaration](../README.md). With this
form, a `void` keyword may be substituted in place of a _BindingIdentifier_. In this case, a user-accessible
block-scoped binding is not created for the result of the expression, but that result may still participate in
disposal at the end of the block.

The `using void` variant was also present in the [`using` statement](./using-statement.md),
[`using await` statement](./using-await-statement.md), and [`using await` declaration](./using-await-declaration.md)
proposals, which are now also out of scope.

# Example

```js
// block-scoped resource, no binding
{
    using void = expr1; // 'expr1' is evaluated and result is captured until the end of the block.
    ...
} // result is disposed


// multiple bindingless resources
{
    using void = expr1, void = expr2;
    ...
} // result of expr2 is disposed, then result of expr1 is disposed


// mixing bindings and bindingless forms
{
    using x = expr1, void = expr2, y = expr3;

} // y is disposed, then result of expr2 is disposed, then x is disposed


// in a 'using' statement
using (void = expr1) { ... }


// in a 'using await' statement
using await (void = expr1) { ... }


// in a `using await` declaration
{
    using await void = expr1;
    ...
} // result of expr1 is asynchronously disposed
```

# Status

**Status:** Out of scope

The `using void` declaration has been postponed and deemed out of scope for the original proposal. This was cut
primarily to reduce the scope of the intial proposal, though we believe a bindingless form would still be invaluable
for many use cases such as locking, logging, etc.:

```js
// locking a resource
function useResource() {
  // NOTE: `mutex.lock()` blocks the thread until it can take a lock, returning a lock handle object with a
  // `[Symbol.dispose]` method that releases the lock at the end of the block.

  using void = mutex.lock(); // binding would be unused, potentially causing linters to complain.

  res.doSomething();

} // The lock handle object is disposed.


// activity logging
class Activity {
    #name;
    #start;
    #disposed = false;
    constructor(name) {
        this.#name = name;
        this.#start = Date.now();
        console.log(`Activity '${name}' started.`);
    }

    [Symbol.dispose]() {
        if (!this.#disposed) {
            this.#disposd = true;
            const end = Date.now();
            console.log(`Activity '${name}' ended. Took ${end - start} ms.`);
        }
    }
}

function operation1() {
    using void = new Activity("operation1");
    operation2();
}

function operation2() {
    using void = new Activity("operation2");
    console.log("some long running operation...");
}

operation1();
// Logs:
//   Activity 'operation1' started.
//   Activity 'operation2' started.
//   some long running operation...
//   Activity 'operation2' ended. Took ? ms.
//   Activity 'operation1' ended. Took ? ms.
```

# Alternatives

There is no currently proposed alternative that avoids introducing an unnecessary binding. In these cases, its likely
that users will do something like:

```js
using _ = expr;
```

or

```js
using dummy = expr; // eslint-disable-line no-unused-vars
```

# Postponement Implications

The `using void` declaration is more of a "nice to have" feature to avoid needing to name otherwise unreferenced
resources, where the side-effects of the `[Symbol.dispose]` method invoked at the end of the block are desired, or
when the desire is to leverage an effect similar to Go's `defer`.

# More Information

An early draft of the spec text supporting `using void` declarations can be found in #86.

# Explainer Snapshot

The following sections were originally part of the [explainer](../README.md).

> # Semantics
>
> ## `using` Declarations
>
> ### `using` Declarations with Existing Resources
>
> ```grammarkdown
> UsingDeclaration :
>     `using` BindingList `;`
>     `using` `await` BindingList `;`
>
> LexicalBinding :
>     `void` Initializer
> ```
>
> When a `using` declaration is parsed with `void` _Initializer_, an implicit block-scoped binding is created for the
> result of the expression. When the _Block_ or _Module_ immediately containing the `using` declaration is exited,
> whether by an abrupt or normal completion, `[Symbol.dispose]()` is called on the implicit binding as long as it is
> neither `null` nor `undefined`. If an error is thrown in both the containing _Block_/_Module_ and the call to
> `[Symbol.dispose]()`, an `AggregateError` containing both errors will be thrown instead.
>
> ```js
> {
>   ... // (1)
>   using void = expr; // in Block scope
>   ... // (2)
> }
> ```
>
> The above example has similar runtime semantics as the following transposed representation:
>
> ```js
> {
>   const $$try = { stack: [], exception: undefined };
>   try {
>     ... // (1)
>
>     const $$expr = expr; // evaluate `expr`
>     if ($$expr !== null && $$expr !== undefined) {
>       const $$dispose = $$expr[Symbol.dispose];
>       if (typeof $$dispose !== "function") {
>         throw new TypeError();
>       }
>       $$try.stack.push({ value: $$expr, dispose: $$dispose });
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
>         $$dispose.call($$expr);
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
> The local block-scoped binding ensures that if `expr` above is reassigned, we still correctly close the resource we are
> explicitly tracking.

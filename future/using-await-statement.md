# `using await` Statements for ECMAScript

A `using await` statement is a variation of the [`using` statement](./using-statement.md) that is designed to work with
Async Disposable objects, which allow async logic to be evaluated and awaited during disposal. A `using await`
statement is only permitted in an `[+Await]` context such as the top level of a _Module_ or inside the body of an
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
  using await (logger = new Logger()) { // create logger, async dispose at end of block
    logger.write("started");
    ...
    logger.write("done");

    // implicit `await logger[Symbol.asyncDispose]()` when block exits regardless as to
    // whether by `return`, `throw`, `break`, or `continue`.
  }
}
```

# Status

**Status:** Out of scope

The `using await` statement has been postponed and deemed out of scope for the original proposal. This was cut primarily
to reduce the scope of the intial proposal, but also due to the inconsistency between the RAII-style
[`using` declaration](../README.md) and the block-style of the `using await` statement that exists now that the
block-style [`using` statement](./using-statement.md) is also out of scope.

# Alternatives

This could also potentially be addressed by the [`using await` declaration](./using-await-declaration.md).

# Postponement Implications

Postponing `using await` statements without also introducing `using await` declarations means that we lose the ability
to declaratively register disposal of resources that require async cleanup steps. This affects use cases such as
three-phase commit (3PC) transactions and some async file I/O (i.e., async flush). These still can be accomplished
imperatively via `await obj[Symbol.asyncDispose]()`, but the lack of a syntactic declaration reduces their utility.

# More Information

An early draft of the spec text for `using await` statements can be found in #86.

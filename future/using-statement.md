# `using` Statements for ECMAScript

A `using` statement is a block-style variation of the RAII-style [`using` declaration](../README.md).

# Example

```js
// introducing a binding
using (res = expr) { // evaluate 'expr' and bind to 'res', which is disposed at the end of the block
  ...

} // 'res' is disposed (calls 'res[Symbol.dispose]()')


// multiple bindings
using (res1 = expr1, res2 = expr2) {
    ...
} // res2 is disposed, then res1 is disposed


// no binding
using (void = expr1) { // evaluate 'expr1' and store result in implicit variable

} // implicit variable is disposed
```

# Status

**Status:** Out of scope

The `using` statement has been postponed and deemed out of scope for the original proposal. This was cut primarily
to reduce the scope of the intial proposal and to focus on the highly preferred RAII-style.

# Alternatives

This could also potentially be addressed by the [`using await` declaration](./using-await-declaration.md).

# Postponement Implications

Though the `using` statement provided a bridge between RAII-style [`using` declarations](../README.md) and the
block-style [`using await` statement](./using-await-statement.md). Postponing the `using` statement may decrease the
likelihood that the `using await` statement could advance in a version of ECMAScript that already had `using`
declarations.

# History

The initial draft of this proposal used the `using` statement syntax, as well as the following alternatives, before the
proposal settled on the RAII-style `using` declaration form:

```js
// initial draft
using (const res = expr) { ... }

// Java try-with-resources variant
try (const res = expr) { ... }
try (const res = expr) { ... } finally { }

// other variations
try using (const res = expr) { ... }
try using (const res = expr) { ... } finally { }

// final version
using (res = expr) { ... }
```

# More Information

An early draft of the spec text for `using` statements can be found in #86.

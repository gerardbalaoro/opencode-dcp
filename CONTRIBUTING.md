# Contributing to DCP

Thank you for your interest in contributing to Dynamic Context Pruning (DCP)!

## License and Contributions

This project uses the **GNU Affero General Public License v3.0 (AGPL-3.0)**.

### Contribution Agreement

By submitting a Pull Request to this project, you agree that:

1.  Your contributions are licensed under the **AGPL-3.0**.
2.  You grant the project maintainer(s) a non-exclusive, perpetual, irrevocable, worldwide, royalty-free, transferable license to use, modify, and re-license your contributions under any terms they choose, including commercial or proprietary licenses.

This arrangement ensures the project remains Open Source while providing a path for commercial sustainability.

## Getting Started

1.  Fork the repository.
2.  Create a feature branch.
3.  Implement your changes and add tests if applicable (please NO AI SLOP).
4.  Ensure all tests pass and the code is formatted.
5.  Submit a Pull Request.

We look forward to your contributions!

## Development

Use Node.js 24 and Bun 1.3.14 for local development. The Bun version is pinned in
`package.json`.

From the repository root, install dependencies and run the checks with:

```sh
bun install --frozen-lockfile
bun run lint
bun run format:check
bun run typecheck
bun run test
bun run check:package
```

The test command uses Node.js's test runner, so keep Node.js 24 available even
when running project scripts through Bun.

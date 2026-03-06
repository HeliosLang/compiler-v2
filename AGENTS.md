# Agent Guidance

## Package Manager

- Use `pnpm` for all dependency and script commands in this repository.
- Do not use `npm`.

## Common Commands

- Install dependencies: `pnpm install`
- Run scripts: `pnpm run <script>`
- Typecheck: `pnpm test`
- Lint: `pnpm run eslint .`
- Test: `pnpm test`

## Command Mapping

- If the user asks to "run type checker", run: `pnpm test`

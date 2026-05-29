# Contributing

1. Fork the repo and create a branch: `git checkout -b feat/my-feature`
2. Write tests first (TDD): `npm test`
3. Lint: `npm run lint`
4. Commit with conventional commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`
5. Open a PR against `main`; CI must be green

## Environment

Copy `.env.example` to `.env` and fill in your keys.
Copy `user-config.example.json` to `user-config.json`.
Always set `DRY_RUN=true` when developing.

## Safety

Never commit secrets. Never write tests that submit on-chain transactions.
All tests must be fully offline (mocked RPC, mocked DLMM SDK, mocked APIs).

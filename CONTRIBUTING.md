# Contributing to Astali

Thank you for wanting to help! Astali is a small project made by one person, so every bug report, idea and fix
really counts.

## Reporting a bug

[Open an issue](../../issues/new) and tell me:

- what you did, what you expected, and what happened instead
- your Astali version (**Settings → About**) and your operating system
- a screenshot, if it shows the problem

Please leave out anything private from your boards.

## Suggesting an idea

Ideas are welcome as issues too. Say what you're trying to do and why. The use case helps me more than a finished
design. Astali stays free, local-first and simple, so some ideas may not fit, and that's fine.

## Sending a change

1. **Open an issue first** for anything bigger than a small fix, so we can agree on the approach before you spend
   time on it.
2. Fork the repository, make your change on a branch, and open a pull request that links the issue.

### How pull requests are merged

This repository is a nightly snapshot of where I develop Astali. Because of that, I can't merge pull requests with
the GitHub button. When I accept yours, I apply your commits to the development code with you as their author. They
then arrive here with the next nightly update, and I close your pull request with a note saying so. You'll also be
thanked in the [changelog](CHANGELOG.md).

## Working on the code

Setup and build commands are in the [README](README.md#development). Before opening a pull request:

- `npm run build` passes (it type-checks the frontend)
- `cargo test` passes in `src-tauri`
- you've tried the change in the running app (`npm run tauri dev`)

A few conventions:

- **Match the surrounding code.** Same naming, same comment style. `npm run format` formats everything (Prettier for
  the frontend, `cargo fmt` for Rust), and `npm run format:check` tells you if anything is left.
- **Keep it small.** One change per pull request is easier to review and quicker to land.
- **Add a changelog entry** under `[Unreleased]` in `CHANGELOG.md`: one or two sentences about what users get, not how
  it works.
- **Think about every platform.** Astali runs on Windows, macOS and Linux, so watch out for paths, shortcuts and
  file-name case.

## Be kind

Be patient and friendly with everyone here. We're all learning, and that's the point of Astali.

## License

By contributing, you agree that your contribution is released under the [MIT License](LICENSE), like the rest of
Astali.

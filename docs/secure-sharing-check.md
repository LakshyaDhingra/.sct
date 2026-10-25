# Secure sharing check

This record closes the Phase 2 sharing checkpoint in issue #20.
The check date was 2026-10-24.

## Two-Mac result

The project owner used two real Mac desktop apps.
The owner confirmed that the apps showed a verified recipient and completed secret sharing.

The check used the app UI. It did not use the .sct CLI, MCP, an agent, or an approval flow.

## Security evidence

The existing test suite supplied the repeatable security checks:

- A recipient decrypted the transfer and returned a correlated signed receipt.
- A third identity could not decrypt another recipient's payload or receipt.
- Wrong keys, forged senders, changed routing fields, changed ciphertext, and changed signatures failed.
- Expired delivery and access deadlines failed.
- Duplicate delivery returned the saved receipt and did not import the secret again.
- Restart recovery kept the original destination and did not duplicate an import.
- Offline vault operations used encrypted files and macOS Keychain.
- Expired grant cleanup removed the vault entry and its Keychain key.

The full suite passed 38 tests.

An isolated Maincloud database supplied the relay authorization checks.
Anonymous SQL reads failed for the private `device`, `message`, `delivery`, and `receipt` tables.
An anonymous subscription to the private `message` table also failed.

The relay derives each sender from the connection identity.
The `acknowledge` reducer selects a delivery with the message ID and caller identity.
The pair reducers permit status changes only for the pair members.
The client views filter rows with the caller identity.

The envelope and vault tests searched stored bytes and renderer data for test values.
They found no plaintext secret or private key in those outputs.

## Application checks

- `bun run test`: 38 passed.
- `bun run check`: passed.
- Electron Playwright: 3 passed.
- React Doctor: no issues. The score service was unavailable.

The local full build reached the native AirDrop helper.
That helper did not compile because the installed Swift compiler and macOS SDK versions differ.
The TypeScript, SDK, main, preload, renderer, demo, and Electron test builds passed.

## Expiry limits

- A delivery deadline must be in the next seven days.
- Relay maintenance runs each minute.
- The relay retains delivery records for 30 days after the delivery deadline.
- The relay retains encrypted expiry notices for 30 days.
- The sender selects the local access deadline.
- The app checks local access at import and before each use.
- The app runs local cleanup at startup, each minute, and after system resume.


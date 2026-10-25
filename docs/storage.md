# Vault storage

## Projects

A project is a name and an existing folder. .sct does not read, move, or change the contents of the folder.
.sct saves projects in `projects.json` in the Electron `userData` folder. On macOS, this folder is usually `~/Library/Application Support/.sct`.

- Each project name must be unique. The comparison ignores letter case.
- Each folder can belong to one project only. .sct also rejects a symbolic link to a saved folder.
- To delete a project, type its name. The deletion also deletes the vault folder and the Keychain keys of the project.

## Secrets

A secret name contains letters, digits, and underscores. It cannot start with a digit. Each name is unique in its project.
A value can be empty. A value cannot contain a null character, because process environments cannot contain null characters.
The renderer clears the value field after each request. It never receives a stored value.

A secret that arrives through the relay keeps its grant. See [relay delivery](relay.md#relay-delivery).
After the access deadline, .sct refuses every read of that secret, including `sct run`.
.sct does not share an injection-only secret again through AirDrop or the relay.

## Files and keys

When .sct starts, it makes the vault folder `~/.sct`. Each project has one file: `.sct/[project-name]/secrets.sct`.

- The file contains encrypted secret names and encrypted values. Each value has its own key.
- macOS Keychain keeps the file key and the value keys under the `.sct` service.
- To read a value, .sct needs the file and the Keychain keys.

To move the vault folder, select **Storage**, then select **Change location…**.
.sct saves the new location in `settings.json` in the `userData` folder. The Keychain keys do not move.
Keep the vault outside source folders.

If Keychain rejects a deletion, .sct restores the encrypted entry. You can then try again.
If a project deletion fails, .sct keeps the project and its remaining entries for another attempt.

## Internal reads

Main-process code reads one value with `Vault.withSecret({ projectId, id }, use)`.
No preload operation and no IPC handler gives access to this read.

- The method decrypts only the selected value.
- After the callback, the method clears the plaintext Buffer and its copy of the value key. It also does this when the callback fails.
- The callback can encrypt the Buffer and return ciphertext. The callback must not keep or return plaintext.
- Clearing a Buffer cannot clear copies that the callback makes, for example strings.
- Do not call another vault operation from the callback. All vault operations use the same serial queue.

# Vault storage

## Projects

A project is a name and an existing folder. .sct does not read, move, or change the folder's contents.
.sct saves projects in `projects.json` in Electron's `userData` folder, normally `~/Library/Application Support/.sct`.

- Project names must be unique. The comparison ignores letter case.
- A folder can belong to one project only. .sct also rejects a symbolic link to a saved folder.
- To delete a project, type its name. Deletion removes its vault folder and its Keychain keys.

## Secrets

Secret names use letters, digits, and underscores, and cannot start with a digit. Each name is unique in its project.
Values can be empty. Null characters are not valid because process environments cannot contain them.
The renderer clears the value field after each request and never receives a stored value.

## Files and keys

At startup, .sct creates the vault folder `~/.sct`. Each project has one file: `.sct/[project-name]/secrets.sct`.

- The file contains encrypted secret names and encrypted values. Each value has its own key.
- macOS Keychain keeps the file key and the value keys under the `.sct` service.
- To read a value, .sct needs both the file and the Keychain keys.

Select **Storage**, then **Change location…**, to move the vault folder. The location is saved in `settings.json` in the `userData` folder.
Keep the vault outside source folders. The Keychain keys do not move.

If Keychain rejects a deletion, .sct restores the encrypted entry so that you can try again.
A failed project deletion keeps the project and its remaining entries for another attempt.

## Internal reads

Main-process code reads one value with `Vault.withSecret({ projectId, id }, use)`.
No preload operation or IPC handler exposes this read.

- The method decrypts only the selected value. It clears the plaintext Buffer and its copy of the value key after the callback, also after a failure.
- The callback can encrypt the Buffer and return ciphertext. It must not keep or return plaintext.
- Clearing a Buffer cannot clear copies that the callback makes, for example strings.
- Do not call another vault operation from the callback. All vault operations use the same serial queue.

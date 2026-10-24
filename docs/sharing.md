# Sharing between Macs

.sct sends encrypted copies of secrets to a verified Mac through AirDrop.
The flow needs no relay, agent, or network connection other than AirDrop.
Build the signed app with `bun run package:mac` so that macOS opens `.sct-transfer` files in .sct. The development window registers no file type.

## Verify a device once

Open **Sharing** on both Macs. The first visit creates a sharing identity in macOS Keychain.

1. On the **Verify devices** tab, select **Send my card to…** and choose the other Mac in the picker.
   The device card contains public keys only.
2. Ask the other person to send their card back.
3. Select **Import .sct-device file…** and choose their card. The file picker opens in Downloads.
4. Compare the full pairing code on both Macs through a trusted conversation.
5. Select **Confirm recipient** only if both codes match. Do this on both Macs.

Verify the device again if either Mac's keys change.
The **Send secrets** tab stays unavailable until one device is verified.

## Send

1. Open **Send secrets**, or select **Share secrets** on a project page. The project stays selected.
2. Choose a verified recipient and the secrets.
3. Select **Send to…** and choose the same Mac in the picker.

.sct encrypts the package for that device before it writes the transfer file.
`native/airdrop.swift` opens only the AirDrop picker, not the full macOS share menu.
macOS reports the same result for a sent file and for **Cancel**, so the sender sees no delivery confirmation.

## Receive

1. Accept the AirDrop file. macOS saves it in Downloads.
2. The signed app opens `.sct-transfer` files. You can also open the **Receive secrets** tab and select **Choose received file…**.
3. Choose a local destination project and select **Import secrets**.

The sender's project name and folder do not select the destination.
.sct saves the copies in the destination project's vault file with new Keychain keys.
If a secret name already exists in the destination, the import fails before any secret changes.

## Rules

- A package expires after 24 hours. It holds at most 1000 secrets and 8 MiB.
- Before import, .sct checks the verified sender, the signature, the recipient, the timestamps, and the message ID.
- Receipt records and encrypted vault markers prevent a second import of the same package, also after a restart or an interrupted import.
  An interrupted import stays bound to its first destination project.
- An import makes a permanent local copy. Package expiry does not revoke an imported secret.
- .sct keeps outbound ciphertext in its app data until the app quits. After a crash, the next start removes expired packages.
  Import or **Dismiss transfer** removes the pending copy in the app data.
  The AirDrop file stays in Downloads. You can delete it after import.
- Secret values and private keys never enter transfer files, logs, or renderer responses.
  Values exist in main-process memory during encryption and import. JavaScript cannot clear strings from memory.
- The Sharing screen animates encryption, transport, and decryption. Reduced-motion settings stop the animations.
  The animated glyphs are decoration, not ciphertext.

Relay sharing is separate work. See [relay setup](relay.md) and the [implementation order](architecture.md#implementation-order).

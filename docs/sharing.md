# Sharing between Macs

.sct sends encrypted copies of secrets to a verified Mac through AirDrop.
The flow needs no relay, no agent, and no network connection other than AirDrop.

Build the signed app with `bun run package:mac`. Then macOS opens `.sct-transfer` files in .sct.
The development window registers no file type.

## Verify a device one time

When you open **Sharing** for the first time, .sct creates a sharing identity in macOS Keychain.
Do these steps on both Macs:

1. Open **Sharing**, then open the **Verify devices** tab.
2. Select **Send my card to…**.
3. In the picker, choose the other Mac. The device card contains public keys only.
4. Ask the other person to send their card to you.
5. Select **Import .sct-device file…**. The file picker opens in Downloads.
6. Choose their card.
7. Compare the full pairing code on both Macs. Use a trusted conversation, for example in person or on a call.
8. If both codes are the same, select **Confirm recipient**. If the codes are different, select **Cancel verification**.

If the keys of one Mac change, verify that device again.
The **Send secrets** tab stays unavailable until you verify one device.

## Send

1. Open the **Send secrets** tab. You can also select **Share secrets** on a project page. Then .sct keeps that project selected.
2. Choose a verified recipient.
3. Choose the secrets.
4. Select **Send to…**.
5. In the picker, choose the same Mac.

.sct encrypts the package for that device before it writes the transfer file.
The helper `native/airdrop.swift` opens only the AirDrop picker. It does not open the full macOS share menu.
macOS reports the same result for a sent file and for **Cancel**. Thus the sender gets no delivery confirmation.

## Receive

1. Accept the AirDrop file. macOS saves it in Downloads.
2. Open the file. The signed app opens `.sct-transfer` files.
   As an alternative, open the **Receive secrets** tab and select **Choose received file…**.
3. Choose a local destination project.
4. Select **Import secrets**.

The sender's project name and folder do not select the destination.
.sct saves the copies in the vault file of the destination project. Each copy gets a new Keychain key.
If a secret name already exists in the destination, the import fails before any secret changes.

## Rules

- A package expires after 24 hours. A package holds a maximum of 1000 secrets and 8 MiB.
- Before an import, .sct checks the verified sender, the signature, the recipient, the timestamps, and the message ID.
- Receipt records and encrypted vault markers prevent a second import of the same package.
  This protection also applies after a restart or after an interrupted import.
  An interrupted import stays bound to its first destination project.
- An import makes a permanent local copy. Package expiry does not revoke an imported secret.
- .sct keeps outbound ciphertext in its app data until the app stops.
  After a crash, .sct deletes expired packages when it starts again.
- An import or **Dismiss transfer** deletes the pending copy in the app data.
  The AirDrop file stays in Downloads. You can delete it after the import.
- Secret values and private keys never go into transfer files, logs, or renderer responses.
  Values exist in main-process memory during encryption and import. JavaScript cannot clear strings from memory.
- The Sharing screen animates encryption, transport, and decryption. Reduced-motion settings stop the animations.
  The animated glyphs are decoration. They do not show ciphertext.

Relay sharing is separate work. See [relay setup](relay.md) and the [implementation order](architecture.md#implementation-order).

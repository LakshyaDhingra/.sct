# Local macOS signing

The signed build uses the `.sct Development` identity from your macOS Keychain.
The bundle identifier is `com.omavashia2005.sct`.
Keep both values unchanged between builds.

## Create the local identity once

1. Open **Keychain Access** through Spotlight.
2. Select **Keychain Access → Certificate Assistant → Create a Certificate…** in the macOS menu bar.
3. Enter `.sct Development` as the certificate name.
4. Select **Self Signed Root** as the identity type.
5. Select **Code Signing** as the certificate type.
6. Create the certificate in your **login** Keychain.
7. Open the certificate from **My Certificates**.
8. Expand **Trust**.
9. Set **Code Signing** to **Always Trust**.
10. Close the certificate window. Approve the macOS authentication prompt.

The certificate must appear with its private key under **My Certificates**.
Keep the private key in Keychain. Do not export it into the repository or commit it.
Each developer creates a local identity on their own Mac.

Check that macOS recognizes the identity:

```sh
security find-identity -v -p codesigning
```

The output must contain exactly one valid identity named `.sct Development`.
The packaging command rejects missing or duplicate identities. It does not fall back to unsigned or ad-hoc signing.

## Build and sign

Run from the repository root:

```sh
bun run package:mac
```

The command compiles the application, packages its generated files, and signs the app and nested Electron binaries.
It selects the certificate by its fingerprint after checking its name and code-signing validity.
This code-signing check replaces the signing library's general certificate lookup, which rejects certificates trusted only for code signing.
The command then checks the complete signature and the expected bundle identifier and certificate.
No private key enters the build directory or application bundle.

On Apple Silicon, the output is `dist/sct-darwin-arm64/sct.app`.
On Intel Macs, the output is `dist/sct-darwin-x64/sct.app`.
The application window uses `.sct`. The filename is `sct.app` so Finder displays the application normally.
Git ignores `dist/` and `out/`.

macOS may request permission for `codesign` to use the private key.
Approve that request through macOS. Do not enter your Keychain password into a project file or command argument.

Open the signed app on Apple Silicon:

```sh
open dist/sct-darwin-arm64/sct.app
```

Use the `sct-darwin-x64` directory on an Intel Mac.
`bun run dev` and `bun start` use the development Electron runner. They do not create the signed application bundle.

## Check a rebuild

1. Run `bun run package:mac`.
2. Record the certificate fingerprint from its output.
3. Run `bun run package:mac` again.
4. Check that both builds pass signature verification and report the same fingerprint.

For an additional inspection on Apple Silicon:

```sh
codesign --verify --deep --strict --verbose=2 dist/sct-darwin-arm64/sct.app
codesign --display --verbose=4 dist/sct-darwin-arm64/sct.app
codesign --display --requirements - dist/sct-darwin-arm64/sct.app
```

The identifier must be `com.omavashia2005.sct`. The authority must be `.sct Development`.
The designated requirement must remain the same after a rebuild.

## Scope

This identity signs local development builds. It does not establish Apple trust for public distribution or provide notarization.
Hardened Runtime stays enabled. The build grants `com.apple.security.cs.disable-library-validation` because the local certificate has no Apple Team ID.
Without this entitlement, macOS rejects Electron's bundled framework at launch.
This entitlement also permits libraries without a matching Team ID. Use this signing configuration for local development only.
The build still signs and verifies the app and its nested binaries.
Ticket #2 separately checks actual Keychain access after a signed rebuild on both demo Macs.
CI continues to check the application without a developer's private signing key.

See [Apple's certificate instructions](https://support.apple.com/guide/keychain-access/create-self-signed-certificates-kyca8916/mac)
and [Electron's signing guide](https://www.electronjs.org/docs/latest/tutorial/code-signing).

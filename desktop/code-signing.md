# Signed Apple Silicon test builds

The signed build uses the same five repository secrets as Tagcast and ibfetch:
`CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`.
The certificate is a password-protected Developer ID Application `.p12`, encoded
as base64, including its private key. The Apple password must be app-specific.
Never put these values in source, settings, command arguments or logs.

The **Signed Apple Silicon test** workflow builds on a GitHub-hosted arm64 Mac.
Its first run is selected explicitly by a trusted push whose commit message starts
with `Build signed macOS Apple Silicon test `. Only `main` and
`scene-director-3.9` in this repository, pushed by its owner, are allowed. It also
supports manual dispatch after registration. It does not run on pull-request events.
The workflow uploads verified files to a private draft release; publishing it is
a separate step. Existing releases and downloads are never replaced. Release
assets avoid the account's Actions artifact-storage quota. The job has repository
write permission for this final upload; dependency checkout does not retain Git
credentials and only the upload step receives the GitHub token as an environment value.

Dependencies, source checks and Python freezing run without signing credentials.
Only the sign/notarize step receives the five secrets; final verification receives
the team identifier alone and strips all Apple/CSC variables from child tests/apps.
The signed configuration requires hardened Developer ID signatures, only the JIT
entitlement, accepted Apple notarization and a stapled ticket. Failure never falls
back to an ad-hoc build. The ordinary local build remains available separately.

The verifier checks every nested Mach-O signature, the matching team, Gatekeeper,
portable HTTPS roots, bundled licenses, exact frontend assets, the private bundled
service and an isolated native window launch. It repeats validation after extracting
the final ZIP. Only then are a SHA-256 file and an archive-bound signing report written.
The report contains verification results and the source commit, no credentials.

Local equivalent, with the five signing variables supplied securely:

```sh
python3 -m venv desktop/.venv
desktop/.venv/bin/python -m pip install -r desktop/requirements-build.txt
npm ci --prefix desktop --ignore-scripts
node desktop/node_modules/electron/install.js
npm run prepare:mac --prefix desktop
npm run sign:mac --prefix desktop
desktop/.venv/bin/python desktop/verify_mac.py --app "desktop/dist/3.9.0-beta.2/signed/mac-arm64/Scene Director.app"
```

References: [Apple notarization](https://developer.apple.com/documentation/technotes/tn3147-migrating-to-the-latest-notarization-tool),
[Electron signing and notarization](https://www.electron.build/v26/docs/features/code-signing/notarization/).

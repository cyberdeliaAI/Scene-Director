# Native releases and Mac signing

The `Native builds` workflow builds Windows x64, Linux x64, macOS Intel and macOS Apple Silicon on matching hosted runners. It runs only for the repository owner on the trusted `main` and `scene-director-3.9` branches, through an explicit manual run or a commit beginning `Build native Scene Director `. There are no pull-request or untrusted-fork signing triggers.

## Apple credentials

Repository Actions secrets: `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`. Their values are confined to the Mac signing step. Installation, source tests, freezing, packing on other platforms and runtime checks receive no signing credentials. Certificate identity is selected from the imported Developer ID; no ad-hoc fallback is allowed for releases.

The signing config requires hardened runtime and Apple notarization, with only Electron's JIT entitlement. Debugging, unsigned executable memory and disabled library validation are not enabled. The hosted Mac runner's UDP/443 workaround affects only that disposable runner, retaining HTTPS and all verification.

For a local signed build, after installing the locked build dependencies and supplying the five Apple environment values securely:

```sh
npm run prepare:native --prefix desktop
npm run sign:mac --prefix desktop
python3 desktop/verify_native.py
```

Build separately on native Intel and Apple Silicon runtimes. The original and extracted apps are checked for matching version and architecture, reviewed UI assets, redistribution licenses, portable HTTPS certificates, nested Developer ID signatures, matching team, hardened runtime, a stapled ticket and Gatekeeper acceptance. Frozen-service integration and a real isolated native-window launch must pass, including renderer isolation and clean server shutdown.

## Draft delivery and publication

To avoid Actions artifact storage limits, each verified target uploads its archive, checksum and report directly to a single draft release. Repository write permission is restricted to the trusted jobs; checkout credentials are not persisted. The upload step alone receives the repository token. No signing credentials are embedded in the archive, reports or app.

`release_native.py` refuses published releases, drafts for another commit, mismatched assets and incomplete proof. A final job requires exactly all four platform groups, verifies their GitHub asset digests against their native reports, and adds `SHA256SUMS` and `verification.json`. Publication is a separate step after the complete build passes. A failed or partial build remains a draft.

Windows and Linux downloads are not code-signed. No automatic updater, prompt generation or model connection is run by the release check. Older source history remains in Git; obsolete test downloads may be removed after a verified replacement is available.

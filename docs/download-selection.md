# Choosing a download

The website's download panel lets you choose an operating system and processor type. Choose **x64** for 64-bit Intel/AMD, **ARM64** for 64-bit ARM, or the macOS **Universal** package for either Apple Silicon or Intel. The processor help beside the controls explains where to find Windows system information and how to interpret Linux `uname -m`.

The main button selects a package only from the displayed published release and matching platform/architecture. It prefers the EXE installer on Windows, AppImage on Linux, and DMG on macOS; alternative formats remain in the complete catalog. Every package keeps its own download URL, size and SHA-256 digest, grouped under its platform and architecture. Unrecognized or unspecified CPU labels remain visible under **Other architectures**, with the original label and download metadata; they are not automatic recommendations.

If the release has no matching package, the panel says so and links to that release. It never substitutes x64 for an ARM64 selection or constructs a nonexistent download URL. Published v1.0.0 has x64 Linux/Windows and macOS Universal packages; ARM64 installers appear only after a future release publishes them. A draft is never a public download.

## Detection and manual choices

macOS can select Universal without identifying the CPU. Windows/Linux use `navigator.userAgentData.getHighEntropyValues()` when available, requesting only architecture and bitness. The response must identify the same supported desktop platform, use 64-bit bitness, and report the standard `x86` or `arm` architecture bucket. Missing, denied, timed-out, unrecognized or 32-bit results leave the processor choice open. Mobile/ChromeOS and iPads using a desktop Mac identity do not automatically receive a desktop package.

CPU names in `navigator.userAgent` and `navigator.platform` are deliberately ignored: [Chromium freezes Windows/Linux tokens to x64 values](https://www.chromium.org/updates/ua-reduction/), including on other processors. [Client Hints](https://wicg.github.io/ua-client-hints/) expose separate architecture/bitness fields but can be withheld. No additional fingerprinting fallback is used. These are suggestions, and users can always choose another computer's platform/processor. A late hints response never overwrites a manual choice.

Architecture detection starts alongside the release fetch and has its own one-second deadline; a slow catalog fetch does not restart that deadline. The controls and catalog render as soon as the release arrives and remain usable during detection. Automatic screen-reader download status is announced after detection settles; manual choices are announced immediately. Missing hints do not prevent downloads after an explicit choice. Failure to load the release catalog retains the GitHub Releases link. Choices and hints stay in page memory; they are not stored or transmitted by this code. The site fetches its relative `release.json`, preserving fork/subpath hosting.

## Verification

Unit/JSDOM tests cover both supported CPU families, unknown/denied/hanging hints, misleading UA strings, mobile/ChromeOS, macOS Universal, manual overrides, late responses, older x64-only catalogs, unavailable packages, and every URL/hash in a generated ten-installer catalog. Browser QA uses the real published v1.0.0 metadata and a separately labeled local synthetic ARM64 fixture; preview fixtures are never deployed as release data.

Before publishing ARM64, follow the [release checklist](release-checklist.md): verify a real signed candidate, native install/GUI/MCP/upgrade behavior, all download choices and all ten final installer URLs/hashes in the canonical deployed feed. Website source tests and synthetic catalogs do not establish native platform acceptance.

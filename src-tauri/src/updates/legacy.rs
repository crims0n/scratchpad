// SPDX-License-Identifier: GPL-3.0-or-later

// Frozen v0.8.2 manifest parser from 9e4340c. Tests must prove that the
// publisher can advertise 1.0 to already-installed clients without updating
// their parser. Keep this independent of the current selection logic.
use semver::Version;
use serde::Deserialize;

const RELEASE_PREFIX: &str = "https://github.com/crims0n/scratchpad/releases/tag/";
const MAX_RESPONSE_BYTES: usize = 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Release {
    pub(super) version: String,
    channel: String,
    tag: String,
    pub(super) url: String,
    notes: String,
    pub(super) prerelease: bool,
}

#[derive(Deserialize)]
struct Channels {
    #[serde(deserialize_with = "Option::deserialize")]
    stable: Option<Release>,
    #[serde(deserialize_with = "Option::deserialize")]
    beta: Option<Release>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    schema_version: u32,
    repository: String,
    channels: Channels,
}

fn trusted_release_url(url: &str) -> bool {
    let Some(tag) = url.strip_prefix(RELEASE_PREFIX) else {
        return false;
    };
    let tag = tag.replace("%2B", "+");
    let version = tag
        .strip_prefix("scratchpad-beta-v")
        .or_else(|| tag.strip_prefix('v'))
        .unwrap_or(&tag);
    tag.len() <= 200 && Version::parse(version).is_ok()
}

pub(super) fn select_update(
    bytes: &[u8],
    installed: &str,
    channel: &str,
) -> Result<Option<Release>, String> {
    let invalid = || "Invalid release information".to_string();
    if bytes.len() > MAX_RESPONSE_BYTES {
        return Err(invalid());
    }
    let manifest: Manifest = serde_json::from_slice(bytes).map_err(|_| invalid())?;
    if manifest.schema_version != 1 || manifest.repository != "crims0n/scratchpad" {
        return Err(invalid());
    }
    let release = match channel {
        "beta" => manifest.channels.beta,
        "stable" => manifest.channels.stable,
        _ => return Err(invalid()),
    };
    let Some(release) = release else {
        return Ok(None);
    };
    let version = Version::parse(&release.version).map_err(|_| invalid())?;
    let tag_version = release
        .tag
        .strip_prefix("scratchpad-beta-v")
        .or_else(|| release.tag.strip_prefix('v'))
        .unwrap_or(&release.tag);
    let url_tag = release
        .url
        .strip_prefix(RELEASE_PREFIX)
        .unwrap_or_default()
        .replace("%2B", "+");
    if release.channel != channel
        || release.prerelease != (channel == "beta")
        || (channel == "stable"
            && (!version.pre.is_empty() || release.tag.starts_with("scratchpad-beta-v")))
        || tag_version != release.version
        || url_tag != release.tag
        || !trusted_release_url(&release.url)
        || release.notes.len() > 256 * 1024
    {
        return Err(invalid());
    }
    let installed = Version::parse(installed).map_err(|_| invalid())?;
    // Build metadata does not affect SemVer precedence.
    Ok((version.cmp_precedence(&installed).is_gt()).then_some(release))
}

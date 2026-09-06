// SPDX-License-Identifier: GPL-3.0-or-later

use semver::Version;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri_plugin_opener::OpenerExt;

const ENDPOINT: &str = "https://crims0n.github.io/scratchpad/release.json";
const RELEASE_PREFIX: &str = "https://github.com/crims0n/scratchpad/releases/tag/";
const MAX_RESPONSE_BYTES: usize = 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateInfo {
    installed_version: String,
    channel: &'static str,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Release {
    version: String,
    channel: String,
    tag: String,
    url: String,
    notes: String,
    prerelease: bool,
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

fn channel_for_identifier(identifier: &str) -> &'static str {
    if identifier.ends_with(".beta") {
        "beta"
    } else {
        "stable"
    }
}

#[tauri::command]
pub(crate) fn get_update_info(app: tauri::AppHandle) -> UpdateInfo {
    UpdateInfo {
        installed_version: app.package_info().version.to_string(),
        channel: channel_for_identifier(&app.config().identifier),
    }
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

fn select_update(bytes: &[u8], installed: &str, channel: &str) -> Result<Option<Release>, String> {
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

#[tauri::command]
pub(crate) async fn check_for_updates(app: tauri::AppHandle) -> Result<Option<Release>, String> {
    let info = get_update_info(app);
    let client = reqwest::Client::builder()
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(10))
        .user_agent("Scratchpad-update-check")
        .build()
        .map_err(|_| "Unable to initialize update check".to_string())?;
    let mut response = client
        .get(ENDPOINT)
        .send()
        .await
        .map_err(|_| "Unable to reach GitHub Pages".to_string())?;
    if !response.status().is_success() {
        return Err("Release information is unavailable".into());
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
    {
        return Err("Release information is too large".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Unable to read release information".to_string())?
    {
        if bytes.len() + chunk.len() > MAX_RESPONSE_BYTES {
            return Err("Release information is too large".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    select_update(&bytes, &info.installed_version, info.channel)
}

#[tauri::command]
pub(crate) fn open_update_release(app: tauri::AppHandle, url: String) -> Result<(), String> {
    if !trusted_release_url(&url) {
        return Err("Invalid Scratchpad release link".into());
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn manifest(version: &str, channel: &str) -> serde_json::Value {
        let tag = if channel == "beta" {
            format!("scratchpad-beta-v{version}")
        } else {
            format!("v{version}")
        };
        let mut value = json!({"schemaVersion": 1, "repository": "crims0n/scratchpad", "channels": {"stable": null, "beta": null}});
        value["channels"][channel] = json!({"version": version, "tag": tag, "channel": channel, "prerelease": channel == "beta", "url": format!("{RELEASE_PREFIX}{tag}"), "notes": "What changed"});
        value
    }

    fn select(
        value: &serde_json::Value,
        installed: &str,
        channel: &str,
    ) -> Result<Option<Release>, String> {
        select_update(&serde_json::to_vec(value).unwrap(), installed, channel)
    }

    #[test]
    fn only_offers_newer_versions_in_the_installed_channel() {
        assert_eq!(
            channel_for_identifier("io.github.crims0n.scratchpad.beta"),
            "beta"
        );
        assert_eq!(
            channel_for_identifier("io.github.crims0n.scratchpad"),
            "stable"
        );
        let value = manifest("0.10.0", "beta");
        assert!(select(&value, "0.9.0", "beta").unwrap().is_some());
        assert!(select(&value, "0.10.0", "beta").unwrap().is_none());
        assert!(select(&value, "0.11.0", "beta").unwrap().is_none());
        assert!(select(&value, "0.9.0", "stable").unwrap().is_none());
        assert!(
            select(&manifest("1.0.0-beta.10", "beta"), "1.0.0-beta.2", "beta")
                .unwrap()
                .is_some()
        );
        assert!(select(
            &manifest("1.0.0+build2", "stable"),
            "1.0.0+build1",
            "stable"
        )
        .unwrap()
        .is_none());
    }

    #[test]
    fn rejects_malformed_or_untrusted_responses() {
        assert!(select_update(b"not JSON", "1.0.0", "stable").is_err());
        assert!(select_update(&vec![b' '; MAX_RESPONSE_BYTES + 1], "1.0.0", "stable").is_err());
        for (field, bad) in [
            ("url", json!("https://evil.example/release")),
            ("channel", json!("beta")),
            ("version", json!("oops")),
            ("tag", json!("v9.0.0")),
            ("prerelease", json!(true)),
            ("notes", json!(null)),
        ] {
            let mut value = manifest("2.0.0", "stable");
            value["channels"]["stable"][field] = bad;
            assert!(select(&value, "1.0.0", "stable").is_err(), "{field}");
        }
        assert!(select(
            &json!({"schemaVersion":1, "repository":"crims0n/scratchpad"}),
            "1.0.0",
            "stable"
        )
        .is_err());
        assert!(select(
            &json!({"schemaVersion":1, "repository":"crims0n/scratchpad", "channels":{}}),
            "1.0.0",
            "stable"
        )
        .is_err());
        for url in [
            "http://github.com/crims0n/scratchpad/releases/tag/v1",
            "https://github.com.evil/crims0n/scratchpad/releases/tag/v1",
            "https://github.com/crims0n/scratchpad/releases/tag/../other",
            "https://github.com/crims0n/scratchpad/releases/tag/v1?redirect=evil",
        ] {
            assert!(!trusted_release_url(url));
        }
    }
}

// SPDX-License-Identifier: GPL-3.0-or-later

use serde::Serialize;

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateInfo {
    installed_version: String,
    update_checks: bool,
}

// The App Store delivers updates, so this build has no update check or release
// link. About still shows the version, and the frontend hides its update UI.
#[tauri::command]
pub(crate) fn get_update_info(app: tauri::AppHandle) -> UpdateInfo {
    update_info(app.package_info())
}

fn update_info(package: &tauri::PackageInfo) -> UpdateInfo {
    UpdateInfo {
        installed_version: package.version.to_string(),
        update_checks: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_store_update_info_reports_the_version_with_checks_disabled() {
        let app = tauri::test::mock_app();
        let expected = app.package_info().version.to_string();
        let info = serde_json::to_value(update_info(app.package_info())).unwrap();
        assert_eq!(
            info,
            serde_json::json!({ "installedVersion": expected, "updateChecks": false })
        );
    }
}

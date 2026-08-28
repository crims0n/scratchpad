// SPDX-License-Identifier: GPL-3.0-or-later

import {
  PLATFORM_NAMES,
  detectPlatform,
  formatBytes,
  formatPublishedDate,
  groupAssets,
  isValidManifest,
  selectPrimaryAsset
} from "./release-ui.js";

const RELEASES_URL = "https://github.com/crims0n/scratchpad/releases";
const elements = {
  releaseBadge: document.getElementById("release-badge"),
  releaseDate: document.getElementById("release-date"),
  primaryDownload: document.getElementById("primary-download"),
  primaryDetail: document.getElementById("primary-detail"),
  platformHint: document.getElementById("platform-hint"),
  downloads: document.getElementById("platform-downloads"),
  notes: document.getElementById("release-notes"),
  downloadStatus: document.getElementById("download-status")
};

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function renderAsset(asset) {
  const card = createElement("article", "download-card");
  const heading = createElement("div", "download-card-heading");
  const description = createElement("div");
  description.append(
    createElement("strong", "download-format", asset.format),
    createElement("span", "download-meta", `${asset.architecture} · ${formatBytes(asset.size)}`)
  );

  const link = createElement("a", "download-link", "Download");
  link.href = asset.url;
  link.setAttribute("download", "");
  heading.append(description, link);
  card.appendChild(heading);

  const checksum = createElement("div", "checksum-row");
  checksum.appendChild(createElement("span", "checksum-label", "SHA-256"));
  const code = createElement(
    "code",
    "checksum",
    asset.sha256 || "Checksum unavailable"
  );
  code.title = asset.sha256 || "Checksum unavailable";
  checksum.appendChild(code);
  card.appendChild(checksum);
  return card;
}

function renderManifest(manifest) {
  const { release } = manifest;
  const platform = detectPlatform({
    userAgentDataPlatform: navigator.userAgentData?.platform,
    platform: navigator.platform,
    userAgent: navigator.userAgent
  });
  const primaryAsset = selectPrimaryAsset(release.assets, platform);
  const releaseLabel = `${release.prerelease ? "Beta " : ""}v${release.version}`;

  elements.releaseBadge.textContent = releaseLabel;
  elements.releaseDate.textContent = formatPublishedDate(release.publishedAt);
  elements.releaseDate.dateTime = release.publishedAt;

  if (primaryAsset) {
    elements.primaryDownload.href = primaryAsset.url;
    elements.primaryDownload.textContent = `Download for ${PLATFORM_NAMES[platform]}`;
    elements.primaryDownload.setAttribute("download", "");
    elements.primaryDetail.textContent = `${primaryAsset.format} · ${primaryAsset.architecture} · ${formatBytes(primaryAsset.size)}`;
    elements.platformHint.textContent = `${PLATFORM_NAMES[platform]} detected. Other packages are available below.`;
  } else {
    elements.primaryDownload.href = release.url;
    elements.primaryDownload.textContent = "View latest release";
    elements.primaryDetail.textContent = releaseLabel;
    elements.platformHint.textContent = "Choose your platform from the complete download list below.";
  }

  elements.downloads.replaceChildren();
  groupAssets(release.assets).forEach(({ platform: groupPlatform, assets }) => {
    const section = createElement("section", "platform-group");
    section.appendChild(createElement("h3", "platform-title", PLATFORM_NAMES[groupPlatform]));
    assets.forEach((asset) => section.appendChild(renderAsset(asset)));
    elements.downloads.appendChild(section);
  });

  const notes = release.notes.split(/\n\s*\n/)[0]?.replace(/^#+\s*/, "").trim();
  elements.notes.textContent = notes || `${releaseLabel} is available for testing.`;
  elements.downloadStatus.textContent = `Downloads loaded from ${releaseLabel}.`;
}

async function loadRelease() {
  try {
    const response = await fetch("./release.json", { cache: "no-cache" });
    if (!response.ok) throw new Error(`Release manifest returned ${response.status}`);
    const manifest = await response.json();
    if (!isValidManifest(manifest)) throw new Error("Release manifest is invalid");
    renderManifest(manifest);
  } catch (error) {
    console.error("Could not load release manifest", error);
    elements.releaseBadge.textContent = "Latest beta";
    elements.releaseDate.textContent = "";
    elements.primaryDownload.href = RELEASES_URL;
    elements.primaryDownload.textContent = "View GitHub Releases";
    elements.primaryDetail.textContent = "Downloads for macOS, Windows, and Linux";
    elements.platformHint.textContent = "The download catalog is temporarily unavailable.";
    elements.downloadStatus.textContent = "Release details could not be loaded. Use the GitHub Releases link.";
    elements.downloads.replaceChildren();
    elements.notes.textContent = "Visit GitHub Releases for the newest packages and release notes.";
  }
}

loadRelease();

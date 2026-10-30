// SPDX-License-Identifier: GPL-3.0-or-later

import {
  PLATFORM_NAMES,
  ARCHITECTURE_NAMES,
  normalizeArchitecture,
  detectArchitecture,
  detectPlatform,
  formatBytes,
  formatPublishedDate,
  groupAssets,
  isValidManifest,
  selectPrimaryAsset
} from "./release-ui.js";

const RELEASES_URL = "https://github.com/crims0n/scratchpad/releases";
export function initializeDownloads({ document, navigator, fetchImpl = fetch, detectionTimeoutMs = 1000 }) {
  const elements = {
    platformChoice: document.getElementById("download-platform"),
    architectureChoice: document.getElementById("download-architecture"),
    choices: document.getElementById("download-choices"),
    releaseBadge: document.getElementById("release-badge"),
    releaseDate: document.getElementById("release-date"),
    primaryDownload: document.getElementById("primary-download"),
    primaryDetail: document.getElementById("primary-detail"),
    platformHint: document.getElementById("platform-hint"),
    downloads: document.getElementById("platform-downloads"),
    notes: document.getElementById("release-notes"),
    downloadStatus: document.getElementById("download-status"),
    transitionLabel: document.getElementById("transition-label"),
    featureReleaseNote: document.getElementById("feature-release-note"),
    transitionDetail: document.getElementById("transition-detail")
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
      createElement("span", "download-meta", `${ARCHITECTURE_NAMES[normalizeArchitecture(asset.architecture)] || asset.architecture} · ${formatBytes(asset.size)}`)
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

  const detectedPlatform = detectPlatform({
    userAgentDataPlatform: navigator.userAgentData?.platform,
    mobile: navigator.userAgentData?.mobile,
    platform: navigator.platform,
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints
  });
  let selection = { platform: detectedPlatform, architecture: detectedPlatform === "macos" ? "universal" : "unknown" };
  let manualChoice = false;
  let currentRelease;

  function renderArchitectureChoices() {
    const options = selection.platform === "macos" ? ["universal"] : ["x64", "arm64"];
    const select = elements.architectureChoice;
    select.replaceChildren();
    if (selection.platform !== "macos") {
      const placeholder = createElement("option", "", "Choose processor type");
      placeholder.value = "unknown";
      select.append(placeholder);
    }
    for (const architecture of options) {
      const label = architecture === "universal" ? "Universal" : architecture === "x64" ? "x64 (Intel / AMD)" : "ARM64";
      const option = createElement("option", "", label);
      option.value = architecture;
      select.append(option);
    }
    select.value = selection.architecture;
    select.disabled = !Object.hasOwn(PLATFORM_NAMES, selection.platform) || selection.platform === "macos";
  }

  function renderSelection() {
    const release = currentRelease;
    if (!release) return;
    const { platform, architecture } = selection;
    const primaryAsset = selectPrimaryAsset(release.assets, platform, architecture);
    elements.primaryDownload.removeAttribute("download");
    if (primaryAsset) {
      elements.primaryDownload.href = primaryAsset.url;
      elements.primaryDownload.textContent = `Download for ${PLATFORM_NAMES[platform]}`;
      elements.primaryDownload.setAttribute("download", "");
      elements.primaryDetail.textContent = `${primaryAsset.format} · ${ARCHITECTURE_NAMES[normalizeArchitecture(primaryAsset.architecture)]} · ${formatBytes(primaryAsset.size)}`;
      elements.platformHint.textContent = "You can change the operating system and processor type above. All published packages are below.";
    } else if (!Object.hasOwn(PLATFORM_NAMES, platform)) {
      elements.primaryDownload.href = "#download-platform";
      elements.primaryDownload.textContent = "Choose operating system";
      elements.primaryDetail.textContent = "Select the computer you want to install Scratchpad on.";
      elements.platformHint.textContent = "Your browser could not identify a supported desktop platform. You can still choose a package.";
    } else if (architecture === "unknown") {
      elements.primaryDownload.href = "#download-architecture";
      elements.primaryDownload.textContent = "Choose processor type";
      elements.primaryDetail.textContent = `${PLATFORM_NAMES[platform]} · choose x64 or ARM64`;
      elements.platformHint.textContent = "Your browser did not identify a supported processor type. Choose it above to get a matching package.";
    } else {
      elements.primaryDownload.href = release.url;
      elements.primaryDownload.textContent = "View release packages";
      elements.primaryDetail.textContent = `No ${ARCHITECTURE_NAMES[architecture]} package for ${PLATFORM_NAMES[platform]} in v${release.version}.`;
      elements.platformHint.textContent = "Only published packages are listed below. Choose another platform or processor type to download for a different computer.";
    }
    for (const group of elements.downloads.querySelectorAll("[data-architecture]")) {
      group.classList.toggle("is-selected", group.dataset.platform === platform && group.dataset.architecture === architecture);
    }
    elements.downloadStatus.textContent = `v${release.version}. ${elements.primaryDetail.textContent}`;
  }

  elements.platformChoice.addEventListener("change", () => {
    manualChoice = true;
    selection = { platform: elements.platformChoice.value,
      architecture: elements.platformChoice.value === "macos" ? "universal" : "unknown" };
    renderArchitectureChoices();
    renderSelection();
  });
  elements.architectureChoice.addEventListener("change", () => {
    manualChoice = true;
    selection.architecture = normalizeArchitecture(elements.architectureChoice.value);
    renderSelection();
  });
  elements.primaryDownload.addEventListener("click", event => {
    if (elements.primaryDownload.getAttribute("href") === "#download-platform") {
      event.preventDefault(); elements.platformChoice.focus();
    } else if (elements.primaryDownload.getAttribute("href") === "#download-architecture") {
      event.preventDefault(); elements.architectureChoice.focus();
    }
  });

  function renderManifest(manifest) {
    const { release } = manifest;
    currentRelease = release;
    const releaseLabel = `${release.prerelease ? "Beta " : ""}v${release.version}`;

    elements.releaseBadge.textContent = releaseLabel;
    elements.releaseDate.textContent = formatPublishedDate(release.publishedAt);
    elements.releaseDate.dateTime = release.publishedAt;
    if (release.prerelease === false && Number(release.version.split(".")[0]) >= 1) {
      elements.transitionLabel.textContent = "Upgrading from beta?";
      elements.transitionDetail.textContent = " before installing the stable release.";
      elements.featureReleaseNote.textContent = "These features are included in Scratchpad 1.0 and later. Choose a package from the download catalog below.";
    } else {
      elements.featureReleaseNote.textContent = `This guide describes Scratchpad 1.0. The download catalog currently offers ${releaseLabel}.`;
    }

    elements.choices.hidden = false;
    elements.platformChoice.value = Object.hasOwn(PLATFORM_NAMES, selection.platform) ? selection.platform : "unknown";
    renderArchitectureChoices();

    elements.downloads.replaceChildren();
    groupAssets(release.assets).forEach(({ platform: groupPlatform, architectures }) => {
      const section = createElement("section", "platform-group");
      section.appendChild(createElement("h3", "platform-title", PLATFORM_NAMES[groupPlatform]));
      for (const { architecture, assets } of architectures) {
        const group = createElement("div", "architecture-group");
        group.dataset.platform = groupPlatform;
        group.dataset.architecture = architecture;
        group.append(createElement("h4", "architecture-title", ARCHITECTURE_NAMES[architecture]));
        assets.forEach(asset => group.append(renderAsset(asset)));
        section.append(group);
      }
      elements.downloads.appendChild(section);
    });

    const notes = release.notes.split(/\n\s*\n/)[0]?.replace(/^#+\s*/, "").trim();
    elements.notes.textContent = notes || `${releaseLabel} is available.`;
    renderSelection();
  }

  async function loadRelease() {
    try {
      const response = await fetchImpl("./release.json", { cache: "no-cache" });
      if (!response.ok) throw new Error(`Release manifest returned ${response.status}`);
      const manifest = await response.json();
      if (!isValidManifest(manifest)) throw new Error("Release manifest is invalid");
      renderManifest(manifest);
      const architecture = await detectArchitecture(navigator, detectedPlatform, { timeoutMs: detectionTimeoutMs });
      // A late/denied hints response must never replace a deliberate choice.
      if (!manualChoice && selection.platform === detectedPlatform) {
        selection.architecture = architecture;
        renderArchitectureChoices();
        renderSelection();
      }
    } catch (error) {
      console.error("Could not load release manifest", error);
      elements.choices.hidden = true;
      elements.primaryDownload.removeAttribute("download");
      elements.releaseBadge.textContent = "Latest release";
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

  return loadRelease();
}

if (typeof document !== "undefined") void initializeDownloads({ document, navigator });

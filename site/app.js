// SPDX-License-Identifier: GPL-3.0-or-later

import {
  PLATFORM_NAMES,
  ARCHITECTURE_NAMES,
  normalizeArchitecture,
  detectArchitecture,
  defaultArchitecture,
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
      createElement("span", "download-meta", `${ARCHITECTURE_NAMES[normalizeArchitecture(asset.architecture)] || asset.architecture || "Architecture unspecified"} · ${formatBytes(asset.size)}`)
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
  let selection = { platform: detectedPlatform, architecture: defaultArchitecture(detectedPlatform) };
  let manualChoice = false;
  let currentRelease;
  let detectionFinished = false;
  let focusTarget = null;

  function renderArchitectureChoices() {
    const defaultChoice = defaultArchitecture(selection.platform);
    const options = defaultChoice === "unknown" ? ["x64", "arm64"] : [defaultChoice];
    const select = elements.architectureChoice;
    select.replaceChildren();
    if (defaultChoice === "unknown") {
      const placeholder = createElement("option", "", "Choose processor type");
      placeholder.value = "unknown";
      select.append(placeholder);
    }
    for (const architecture of options) {
      const option = createElement("option", "", ARCHITECTURE_NAMES[architecture]);
      option.value = architecture;
      select.append(option);
    }
    select.value = selection.architecture;
    select.disabled = !Object.hasOwn(PLATFORM_NAMES, selection.platform) || options.length === 1;
  }

  function renderSelection() {
    const release = currentRelease;
    if (!release) return;
    const { platform, architecture } = selection;
    const primaryAsset = selectPrimaryAsset(release.assets, platform, architecture);
    focusTarget = null;
    elements.primaryDownload.removeAttribute("download");
    if (primaryAsset) {
      elements.primaryDownload.href = primaryAsset.url;
      elements.primaryDownload.textContent = `Download for ${PLATFORM_NAMES[platform]}`;
      elements.primaryDownload.setAttribute("download", "");
      elements.primaryDetail.textContent = `${primaryAsset.format} · ${ARCHITECTURE_NAMES[normalizeArchitecture(primaryAsset.architecture)]} · ${formatBytes(primaryAsset.size)}`;
      elements.platformHint.textContent = "You can change the operating system and processor type above. All published packages are below.";
    } else if (!Object.hasOwn(PLATFORM_NAMES, platform)) {
      focusTarget = elements.platformChoice;
      elements.primaryDownload.href = `#${focusTarget.id}`;
      elements.primaryDownload.textContent = "Choose operating system";
      elements.primaryDetail.textContent = "Select the computer you want to install Scratchpad on.";
      elements.platformHint.textContent = "Your browser could not identify a supported desktop platform. You can still choose a package.";
    } else if (architecture === "unknown") {
      focusTarget = elements.architectureChoice;
      elements.primaryDownload.href = `#${focusTarget.id}`;
      elements.primaryDownload.textContent = "Choose processor type";
      const checking = !detectionFinished && !manualChoice;
      elements.primaryDetail.textContent = `${PLATFORM_NAMES[platform]} · ${checking ? "checking processor type…" : "choose x64 or ARM64"}`;
      elements.platformHint.textContent = checking ? "Checking your processor type. You can choose it above now."
        : "Your browser did not identify a supported processor type. Choose it above to get a matching package.";
    } else {
      elements.primaryDownload.href = release.url;
      elements.primaryDownload.textContent = "View release packages";
      elements.primaryDetail.textContent = `No ${ARCHITECTURE_NAMES[architecture]} package for ${PLATFORM_NAMES[platform]} in v${release.version}.`;
      elements.platformHint.textContent = "Only published packages are listed below. Choose another platform or processor type to download for a different computer.";
    }
    for (const group of elements.downloads.querySelectorAll("[data-architecture]")) {
      group.classList.toggle("is-selected", architecture !== "unknown" && group.dataset.platform === platform && group.dataset.architecture === architecture);
    }
    if (detectionFinished || manualChoice) {
      elements.downloadStatus.textContent = `v${release.version}. ${elements.primaryDetail.textContent}`;
    }
  }

  elements.platformChoice.addEventListener("change", () => {
    manualChoice = true;
    selection = { platform: elements.platformChoice.value,
      architecture: defaultArchitecture(elements.platformChoice.value) };
    renderArchitectureChoices();
    renderSelection();
  });
  elements.architectureChoice.addEventListener("change", () => {
    manualChoice = true;
    selection.architecture = normalizeArchitecture(elements.architectureChoice.value);
    renderSelection();
  });
  elements.primaryDownload.addEventListener("click", event => {
    if (focusTarget) {
      event.preventDefault();
      focusTarget.focus();
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
        group.append(createElement("h4", "architecture-title", ARCHITECTURE_NAMES[architecture] || "Other architectures"));
        assets.forEach(asset => group.append(renderAsset(asset)));
        section.append(group);
      }
      elements.downloads.appendChild(section);
    });

    const notes = release.notes.split(/\n\s*\n/)[0]?.replace(/^#+\s*/, "").trim();
    elements.notes.textContent = notes || `${releaseLabel} is available.`;
    renderSelection();
  }

  // Start detection before fetch; its deadline is independent of network
  // latency. Render as soon as the catalog arrives, keeping choices usable.
  function completeDetection(architecture) {
    detectionFinished = true;
    if (!manualChoice && selection.platform === detectedPlatform) {
      selection.architecture = architecture;
      if (currentRelease) {
        renderArchitectureChoices();
        renderSelection();
      }
    }
  }
  const architectureDetection = detectArchitecture(navigator, detectedPlatform, { timeoutMs: detectionTimeoutMs })
    .then(completeDetection, () => completeDetection("unknown"));

  async function loadRelease() {
    try {
      const response = await fetchImpl("./release.json", { cache: "no-cache" });
      if (!response.ok) throw new Error(`Release manifest returned ${response.status}`);
      const manifest = await response.json();
      if (!isValidManifest(manifest)) throw new Error("Release manifest is invalid");
      renderManifest(manifest);
      await architectureDetection;
    } catch (error) {
      console.error("Could not load release manifest", error);
      currentRelease = undefined;
      focusTarget = null;
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

// SPDX-License-Identifier: GPL-3.0-or-later

const MARKDOWN_ALLOWED_TAGS = new Set([
  "a", "blockquote", "br", "code", "del", "em", "h1", "h2", "h3", "h4",
  "h5", "h6", "hr", "img", "input", "li", "ol", "p", "pre", "strong",
  "table", "tbody", "td", "th", "thead", "tr", "ul"
]);

const MARKDOWN_DROP_CONTENT_TAGS = new Set([
  "audio", "base", "button", "canvas", "embed", "form", "iframe", "link",
  "math", "meta", "object", "script", "select", "style", "svg", "textarea",
  "video"
]);

const MARKDOWN_ALLOWED_ATTRIBUTES = {
  a: new Set(["href", "title"]),
  code: new Set(["class"]),
  img: new Set(["alt", "src", "title"]),
  input: new Set(["checked", "disabled", "type"]),
  ol: new Set(["start"]),
  td: new Set(["align"]),
  th: new Set(["align"])
};

export function isSafeMarkdownUrl(value, isImage = false) {
  const compact = value.trim().replace(/[\u0000-\u0020\u007f]+/g, "").toLowerCase();
  if (!compact) return false;

  if (isImage) {
    return /^data:image\/(png|gif|jpe?g|webp);base64,/.test(compact);
  }

  return compact.startsWith("#") ||
    compact.startsWith("https://") ||
    compact.startsWith("http://") ||
    compact.startsWith("mailto:");
}

// Decides what clicking a link in the rendered preview should do. Kept apart
// from the DOM so the policy that hands URLs to the operating system can be
// tested on its own.
export function resolveLinkAction(href) {
  if (typeof href !== "string") return { kind: "ignore" };

  const value = href.trim();
  if (!value) return { kind: "ignore" };

  // In-document anchors are inert: no heading ids are generated and the
  // sanitizer strips id attributes, so there is nothing to jump to. They are
  // still called out here so they are never mistaken for something to hand to
  // the operating system.
  if (value.startsWith("#")) return { kind: "ignore" };

  // Compare on the same stripped form the URL policy uses, so a scheme split
  // by control characters cannot slip past this check.
  const compact = value.replace(/[\u0000-\u0020\u007f]+/g, "");
  if (/^(https?|mailto):/i.test(compact) && isSafeMarkdownUrl(value)) {
    return { kind: "external", url: value };
  }

  return { kind: "ignore" };
}

export function sanitizeMarkdownHtml(html) {
  const template = document.createElement("template");
  template.innerHTML = html;

  const elements = Array.from(template.content.querySelectorAll("*"));
  elements.forEach(element => {
    const tag = element.tagName.toLowerCase();

    if (MARKDOWN_DROP_CONTENT_TAGS.has(tag)) {
      element.remove();
      return;
    }
    if (!MARKDOWN_ALLOWED_TAGS.has(tag)) {
      element.replaceWith(...element.childNodes);
      return;
    }

    const allowedAttributes = MARKDOWN_ALLOWED_ATTRIBUTES[tag] || new Set();
    Array.from(element.attributes).forEach(attribute => {
      if (!allowedAttributes.has(attribute.name.toLowerCase())) {
        element.removeAttribute(attribute.name);
      }
    });

    if (tag === "a") {
      const href = element.getAttribute("href");
      if (!href || !isSafeMarkdownUrl(href)) {
        element.removeAttribute("href");
      } else {
        element.setAttribute("target", "_blank");
        element.setAttribute("rel", "noopener noreferrer");
      }
    }

    if (tag === "img") {
      const src = element.getAttribute("src");
      if (!src || !isSafeMarkdownUrl(src, true)) {
        element.remove();
        return;
      }
      element.setAttribute("loading", "lazy");
      element.setAttribute("referrerpolicy", "no-referrer");
    }

    if (tag === "input") {
      if (element.getAttribute("type") !== "checkbox") {
        element.remove();
        return;
      }
      element.setAttribute("disabled", "");
    }

    if ((tag === "td" || tag === "th") && element.hasAttribute("align")) {
      const align = element.getAttribute("align").toLowerCase();
      if (!["left", "center", "right"].includes(align)) {
        element.removeAttribute("align");
      }
    }

    if (tag === "code" && element.hasAttribute("class")) {
      const safeClasses = element.className
        .split(/\s+/)
        .filter(className => /^language-[a-z0-9_-]+$/i.test(className));
      if (safeClasses.length > 0) {
        element.className = safeClasses.join(" ");
      } else {
        element.removeAttribute("class");
      }
    }
  });

  return template.innerHTML;
}

export function renderMarkdown(rawText, emptyFallback = "", markedApi = globalThis.window?.marked) {
  if (!markedApi) return "";
  const source = rawText || emptyFallback;
  if (typeof markedApi.parse === "function") {
    return sanitizeMarkdownHtml(markedApi.parse(source));
  }
  if (typeof markedApi === "function") {
    return sanitizeMarkdownHtml(markedApi(source));
  }
  throw new Error("Markdown parser is unavailable");
}

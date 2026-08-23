// SPDX-License-Identifier: GPL-3.0-or-later

function getMatchSnippet(text, lineStart, lineEnd, match) {
  const lineText = text.slice(lineStart, lineEnd);
  const matchStart = match.start - lineStart;
  const matchEnd = Math.min(lineText.length, match.end - lineStart);
  const snippetStart = Math.max(0, matchStart - 60);
  const snippetEnd = Math.min(lineText.length, matchEnd + 60);
  const excerpt = lineText.slice(snippetStart, snippetEnd).trim();

  if (!excerpt) return "(blank line)";
  return `${snippetStart > 0 ? "…" : ""}${excerpt}${snippetEnd < lineText.length ? "…" : ""}`;
}

function addLocationContext(text, matches) {
  let line = 1;
  let lineStart = 0;
  let nextLineBreak = text.indexOf("\n");

  return matches.map((match) => {
    while (nextLineBreak !== -1 && nextLineBreak < match.start) {
      line += 1;
      lineStart = nextLineBreak + 1;
      nextLineBreak = text.indexOf("\n", lineStart);
    }

    const lineEnd = nextLineBreak === -1 ? text.length : nextLineBreak;
    return {
      ...match,
      line,
      column: match.start - lineStart + 1,
      snippet: getMatchSnippet(text, lineStart, lineEnd, match)
    };
  });
}

export function findTextMatches(text, query, useRegex = false) {
  if (!query) return { matches: [], invalidPattern: false };

  const matches = [];

  if (useRegex) {
    let regex;
    try {
      regex = new RegExp(query, "gi");
    } catch {
      return { matches: [], invalidPattern: true };
    }

    let match;
    while ((match = regex.exec(text)) !== null) {
      // Empty regex matches are not useful search results. Advancing also
      // prevents global regular expressions from looping forever.
      if (match[0].length === 0) {
        regex.lastIndex += 1;
        continue;
      }

      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        text: match[0]
      });
    }
  } else {
    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    let index = 0;

    while ((index = lowerText.indexOf(lowerQuery, index)) !== -1) {
      matches.push({
        start: index,
        end: index + query.length,
        text: text.slice(index, index + query.length)
      });
      index += query.length;
    }
  }

  return {
    matches: addLocationContext(text, matches),
    invalidPattern: false
  };
}

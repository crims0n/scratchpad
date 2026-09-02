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

const WORD_CHARACTER = /[\p{L}\p{N}\p{M}\p{Pc}]/u;

function escapeRegularExpression(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function characterAt(text, index) {
  if (index < 0 || index >= text.length) return "";
  return String.fromCodePoint(text.codePointAt(index));
}

function characterBefore(text, index) {
  if (index <= 0 || index > text.length) return "";
  const lastCodeUnit = text.charCodeAt(index - 1);
  if (lastCodeUnit >= 0xDC00 && lastCodeUnit <= 0xDFFF && index > 1) {
    return text.slice(index - 2, index);
  }
  return text[index - 1];
}

function hasExactBoundaries(text, match) {
  const firstMatchCharacter = characterAt(match.text, 0);
  const lastMatchCharacter = characterBefore(match.text, match.text.length);
  const previousCharacter = characterBefore(text, match.start);
  const nextCharacter = characterAt(text, match.end);

  const startsInsideWord = WORD_CHARACTER.test(firstMatchCharacter) &&
    WORD_CHARACTER.test(previousCharacter);
  const endsInsideWord = WORD_CHARACTER.test(lastMatchCharacter) &&
    WORD_CHARACTER.test(nextCharacter);

  return !startsInsideWord && !endsInsideWord;
}

export function findTextMatches(
  text,
  query,
  { useRegex = false, matchCase = false, exactMatch = false } = {}
) {
  if (!query) return { matches: [], invalidPattern: false };

  const matches = [];

  if (useRegex) {
    let regex;
    try {
      regex = new RegExp(query, matchCase ? "g" : "gi");
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
    // Search the original text so match offsets stay in the same coordinate
    // system. Lowercasing a copy is unsafe because some characters expand
    // when case-folded (for example, U+0130 becomes two UTF-16 code units).
    const regex = new RegExp(escapeRegularExpression(query), matchCase ? "g" : "gi");
    let match;
    while ((match = regex.exec(text)) !== null) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        text: match[0]
      });
    }
  }

  const filteredMatches = exactMatch
    ? matches.filter((match) => hasExactBoundaries(text, match))
    : matches;

  return {
    matches: addLocationContext(text, filteredMatches),
    invalidPattern: false
  };
}

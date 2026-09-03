// SPDX-License-Identifier: GPL-3.0-or-later

const EMPTY_COMPARISON = Object.freeze({
  changedLineCount: 0,
  leftDecorations: Object.freeze([]),
  rightDecorations: Object.freeze([]),
  leftChangedLines: Object.freeze([]),
  rightChangedLines: Object.freeze([])
});

function decoration(start, end, className) {
  return { start, end, className };
}

function appendChangedLines(target, start, count) {
  for (let index = 0; index < count; index += 1) {
    target.add(start + index);
  }
}

function appendWholeChange(left, right, oldText, newText, oldStart, newStart) {
  if (oldText) left.push(decoration(oldStart, oldStart + oldText.length, "diff-text-removed"));
  if (newText) right.push(decoration(newStart, newStart + newText.length, "diff-text-added"));
}

function refineContiguousChange(oldText, newText, oldStart, newStart, left, right) {
  const oldCharacters = Array.from(oldText);
  const newCharacters = Array.from(newText);
  let prefixLength = 0;

  while (
    prefixLength < oldCharacters.length &&
    prefixLength < newCharacters.length &&
    oldCharacters[prefixLength] === newCharacters[prefixLength]
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  while (
    suffixLength < oldCharacters.length - prefixLength &&
    suffixLength < newCharacters.length - prefixLength &&
    oldCharacters[oldCharacters.length - 1 - suffixLength] ===
      newCharacters[newCharacters.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }

  const oldPrefix = oldCharacters.slice(0, prefixLength).join("");
  const newPrefix = newCharacters.slice(0, prefixLength).join("");
  const removedText = oldCharacters
    .slice(prefixLength, oldCharacters.length - suffixLength)
    .join("");
  const addedText = newCharacters
    .slice(prefixLength, newCharacters.length - suffixLength)
    .join("");
  const sharedLength = prefixLength + suffixLength;
  const longestLength = Math.max(oldCharacters.length, newCharacters.length);

  // Ignore a coincidental one-character edge match between otherwise
  // unrelated words. Pure insertions/removals and stronger shared boundaries
  // still receive precise substring highlighting.
  if (
    removedText &&
    addedText &&
    sharedLength < 2 &&
    sharedLength / longestLength < 0.5
  ) {
    appendWholeChange(left, right, oldText, newText, oldStart, newStart);
    return;
  }

  appendWholeChange(
    left,
    right,
    removedText,
    addedText,
    oldStart + oldPrefix.length,
    newStart + newPrefix.length
  );
}

function refineChangedText(oldText, newText, oldStart, newStart, diffApi) {
  const left = [];
  const right = [];
  const changes = diffApi.diffWordsWithSpace(oldText, newText, {
    ignoreWhitespace: false,
    maxEditLength: 4000,
    timeout: 75
  });

  if (!changes) {
    appendWholeChange(left, right, oldText, newText, oldStart, newStart);
    return { left, right };
  }

  let leftOffset = oldStart;
  let rightOffset = newStart;
  for (let index = 0; index < changes.length;) {
    const current = changes[index];
    if (!current.added && !current.removed) {
      leftOffset += current.value.length;
      rightOffset += current.value.length;
      index += 1;
      continue;
    }

    const leftStart = leftOffset;
    const rightStart = rightOffset;
    let removedText = "";
    let addedText = "";

    while (index < changes.length) {
      const change = changes[index];
      if (!change.added && !change.removed) break;

      if (change.removed) {
        removedText += change.value;
        leftOffset += change.value.length;
      } else {
        addedText += change.value;
        rightOffset += change.value.length;
      }
      index += 1;
    }

    if (removedText && addedText) {
      refineContiguousChange(
        removedText,
        addedText,
        leftStart,
        rightStart,
        left,
        right
      );
    } else {
      appendWholeChange(left, right, removedText, addedText, leftStart, rightStart);
    }
  }

  return { left, right };
}

export function emptyNoteComparison() {
  return {
    changedLineCount: EMPTY_COMPARISON.changedLineCount,
    leftDecorations: [],
    rightDecorations: [],
    leftChangedLines: [],
    rightChangedLines: []
  };
}

export function compareNoteText(leftText, rightText, diffApi) {
  const leftSource = String(leftText ?? "");
  const rightSource = String(rightText ?? "");

  if (leftSource === rightSource) return emptyNoteComparison();
  if (
    typeof diffApi?.diffLines !== "function" ||
    typeof diffApi?.diffWordsWithSpace !== "function"
  ) {
    throw new TypeError("A compatible diff implementation is required");
  }

  const lineChanges = diffApi.diffLines(leftSource, rightSource, {
    maxEditLength: 10000,
    timeout: 200
  });

  // A bounded diff may give up on unusually large or completely unrelated
  // notes. Treat the documents as one change instead of blocking the editor.
  if (!lineChanges) {
    const leftChangedLines = leftSource ? leftSource.split("\n").map((_, index) => index) : [];
    const rightChangedLines = rightSource ? rightSource.split("\n").map((_, index) => index) : [];
    return {
      changedLineCount: Math.max(leftChangedLines.length, rightChangedLines.length),
      leftDecorations: leftSource
        ? [decoration(0, leftSource.length, "diff-line-removed")]
        : [],
      rightDecorations: rightSource
        ? [decoration(0, rightSource.length, "diff-line-added")]
        : [],
      leftChangedLines,
      rightChangedLines
    };
  }

  const leftDecorations = [];
  const rightDecorations = [];
  const leftChangedLines = new Set();
  const rightChangedLines = new Set();
  let leftOffset = 0;
  let rightOffset = 0;
  let leftLine = 0;
  let rightLine = 0;
  let changedLineCount = 0;

  for (let index = 0; index < lineChanges.length;) {
    const current = lineChanges[index];
    if (!current.added && !current.removed) {
      leftOffset += current.value.length;
      rightOffset += current.value.length;
      leftLine += current.count ?? 0;
      rightLine += current.count ?? 0;
      index += 1;
      continue;
    }

    const leftStart = leftOffset;
    const rightStart = rightOffset;
    const leftLineStart = leftLine;
    const rightLineStart = rightLine;
    let oldBlock = "";
    let newBlock = "";
    let removedLineCount = 0;
    let addedLineCount = 0;

    while (index < lineChanges.length) {
      const change = lineChanges[index];
      if (!change.added && !change.removed) break;

      if (change.removed) {
        oldBlock += change.value;
        leftOffset += change.value.length;
        removedLineCount += change.count ?? 0;
      } else {
        newBlock += change.value;
        rightOffset += change.value.length;
        addedLineCount += change.count ?? 0;
      }
      index += 1;
    }

    changedLineCount += Math.max(removedLineCount, addedLineCount);
    if (oldBlock) {
      leftDecorations.push(decoration(leftStart, leftOffset, "diff-line-removed"));
      appendChangedLines(leftChangedLines, leftLineStart, removedLineCount);
    }
    if (newBlock) {
      rightDecorations.push(decoration(rightStart, rightOffset, "diff-line-added"));
      appendChangedLines(rightChangedLines, rightLineStart, addedLineCount);
    }

    if (oldBlock && newBlock) {
      const refined = refineChangedText(oldBlock, newBlock, leftStart, rightStart, diffApi);
      leftDecorations.push(...refined.left);
      rightDecorations.push(...refined.right);
    }

    leftLine += removedLineCount;
    rightLine += addedLineCount;
  }

  return {
    changedLineCount,
    leftDecorations,
    rightDecorations,
    leftChangedLines: [...leftChangedLines],
    rightChangedLines: [...rightChangedLines]
  };
}

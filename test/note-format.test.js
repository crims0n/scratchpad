// SPDX-License-Identifier: GPL-3.0-or-later

import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { createNoteFormatDetector, detectNoteFormat } from '../src/note-format.js';

const dom = new JSDOM();
const detect = content => detectNoteFormat(content, dom.window.DOMParser);

test('detects JSON containers, leaving primitives and incomplete documents as text', () => {
  for (const content of ['{}', '[]', '{"order_id": 3}', '\ufeff\r\n [1, {"a": true}] \r\n']) {
    assert.equal(detect(content), 'JSON', content);
  }
  for (const content of ['42', 'true', 'null', '"hello"', '{"a":', '{"a": 1,}']) {
    assert.equal(detect(content), 'TXT', content);
  }
});

test('detects complete XML with declarations, namespaces, and literal parsererror tags', () => {
  for (const content of [
    '<order_id>3</order_id>', '<?xml version="1.0"?><root/>',
    '<root xmlns="urn:notes"><child/></root>', '<root><parsererror/></root>',
    '<!-- comment --><root><![CDATA[*literal*]]></root>'
  ]) assert.equal(detect(content), 'XML', content);
  for (const content of ['<root>', '<root></other>', '<a/><b/>', '<root>&undefined;</root>',
    '<!DOCTYPE root SYSTEM "https://example.com/external.dtd"><root/>']) {
    assert.equal(detect(content), 'TXT', content);
  }
});

test('recognizes YAML structure while avoiding lone mappings and ordinary lists', () => {
  for (const content of [
    'name: scratchpad\nversion: 1', 'server:\n  port: 8080',
    'fruits:\n  - apple\n  - pear', '---\nname: scratchpad',
    '# settings\nname: scratchpad\nenabled: true',
    'description: |\n  # This is literal text\n  and more text\nenabled: true',
    '- name: one\n  enabled: true'
  ]) assert.equal(detect(content), 'YAML', content);
  for (const content of ['Meeting: Friday', 'https://example.com', '---', 'name: one\nordinary prose']) {
    assert.equal(detect(content), 'TXT', content);
  }
  assert.equal(detect('- apple\n- pear'), 'MD');
});

test('recognizes parser errors in the browser engine namespace', () => {
  class BrowserParser extends dom.window.DOMParser {
    parseFromString(source, type) {
      const document = super.parseFromString(source, type);
      if (document.getElementsByTagName('parsererror').length) {
        return super.parseFromString('<root><parsererror xmlns="http://www.w3.org/1999/xhtml">Invalid XML</parsererror></root>', type);
      }
      return document;
    }
  }
  assert.equal(detectNoteFormat('<root>', BrowserParser), 'TXT');
  assert.equal(detectNoteFormat('<root/>', BrowserParser), 'XML');
});

test('recognizes common Markdown and keeps fenced structured examples as Markdown', () => {
  for (const content of [
    '# Notes', 'Heading\n=======', '- task', '1. task', '> quote',
    '[link](https://example.com)', '**x**', '__important__', '`code`', '*italic*', '_italic_', '~~deleted~~',
    '| Name | Value |\n| --- | --- |\n| a | b |',
    '```json\n{"a": 1}\n```', '```xml\n<root/>\n```',
    '---\ntitle: Notes\n---\n\n# Heading\nSome prose'
  ]) assert.equal(detect(content), 'MD', content);
});

test('recognizes CSV with consistent columns, quoted commas, escapes, and multiline fields', () => {
  for (const content of [
    'name,age\nAlice,30', 'name,age\r\nAlice,30\r\n',
    'name,description\nAlice,"one, two"',
    'name,description\nAlice,"said ""hello"""',
    'name,description\nAlice,"first line\nsecond line"',
    'name,description\nAlice,"first line\n# Heading\n- bullet"',
    'a,b,c\n1,,3', 'a,b\nc,d\ne,f',
    'name,value\nAlice,**bold**', 'name,url\nAlice,[link](https://example.com)'
  ]) assert.equal(detect(content), 'CSV', content);
  for (const content of [
    'one, two, three', 'a,b\n1,2,3', 'a,b\n"unclosed,2',
    'a,b\n"closed"tail,2', 'a,b\nunquoted"quote,2', 'ordinary prose\nmore prose'
  ]) assert.equal(detect(content), 'TXT', content);
});

test('empty and ambiguous notes fall back to TXT', () => {
  for (const content of ['', ' \r\n ', null, undefined, 'Notes for tomorrow', 'file_name', '2 < 3']) {
    assert.equal(detect(content), 'TXT', String(content));
  }
});

test('caches unchanged content without leaking format across notes or revisions', () => {
  let parses = 0;
  class CountingParser extends dom.window.DOMParser {
    parseFromString(...args) { parses += 1; return super.parseFromString(...args); }
  }
  const getFormat = createNoteFormatDetector(CountingParser);
  const note = { id: 'same', content: '<root/>' };
  assert.equal(getFormat(note), 'XML');
  note.title = 'Changed title';
  assert.equal(getFormat(note), 'XML');
  assert.equal(parses, 2, 'one error-namespace probe and one content parse');
  note.content = '{"a":1}';
  assert.equal(getFormat(note), 'JSON');
  assert.equal(getFormat({ id: 'same', content: 'ordinary text' }), 'TXT');
  note.content = '<changed/>';
  assert.equal(getFormat(note), 'XML');
  assert.equal(parses, 3, 'the error-namespace probe is reused');
});

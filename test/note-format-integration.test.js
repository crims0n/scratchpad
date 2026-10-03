// SPDX-License-Identifier: GPL-3.0-or-later

import assert from 'node:assert/strict';
import test from 'node:test';
import { getAppElement, bootApp } from './helpers/app-harness.js';

test('sidebar badges work across folders, imports, both editors, and collection replacement', async () => {
  const notes = [
    { id: 'json', title: 'JSON note', content: '{"order_id":"*value*"}', isPinned: true },
    { id: 'xml', title: 'XML note', content: '<order_id>*value*</order_id>', folderId: 'folder' },
    { id: 'md', title: 'Markdown note', content: '# Heading\nBody' },
    { id: 'yaml', title: 'YAML note', content: 'name: note_name\nenabled: true' },
    { id: 'csv', title: 'CSV note', content: 'name,value\nnote_name,*literal*' },
    { id: 'txt', title: 'Plain note', content: 'Meeting: Friday' }
  ].map(note => ({ ...note, updatedAt: 1, isTitleLocked: true }));
  const app = await bootApp({
    storage: { scratchpad_notes: notes, scratchpad_folders: [{ id: 'folder', name: 'Folder' }] },
    handlers: {
      import_file_native: () => ({ title: 'Imported', content: '<imported/>' }),
      select_db_file: () => '/tmp/formats.db',
      load_db_notes: () => [{ id: 'json', title: 'Same ID, different content', content: '# Workspace', updatedAt: 2 }]
    }
  });
  const item = id => document.querySelector(`.note-item[data-id="${id}"]`);
  const badge = id => item(id).querySelector('.note-format-badge');
  for (const note of notes) {
    assert.equal(badge(note.id).textContent, note.id.toUpperCase());
    assert.match(item(note.id).getAttribute('aria-label'), new RegExp(`detected format ${note.id.toUpperCase()}$`));
    assert.equal(badge(note.id).getAttribute('aria-hidden'), 'true');
  }
  assert.equal(item('xml').closest('.note-folder-section').dataset.sectionId, 'folder');
  assert.equal(item('json').querySelector('.note-item-snippet').textContent, notes[0].content);
  assert.equal(item('xml').querySelector('.note-item-snippet').textContent, notes[1].content);
  assert.equal(item('yaml').querySelector('.note-item-snippet').textContent, notes[3].content);
  assert.equal(item('csv').querySelector('.note-item-snippet').textContent, notes[4].content);
  assert.equal(item('md').querySelector('.note-item-snippet').textContent, 'Heading\nBody');

  await app.type('ordinary text');
  assert.equal(badge('json').textContent, 'TXT');
  await app.type('{"changed": true}');
  assert.equal(badge('json').textContent, 'JSON');
  app.click('split-note-btn');
  const secondaryId = document.getElementById('secondary-note-select').value;
  const secondary = getAppElement("secondary-editor");
  secondary.value = 'name,age\nAlice,30';
  secondary.dispatchEvent(new app.dom.window.Event('input', { bubbles: true }));
  await app.settle(500);
  assert.equal(badge(secondaryId).textContent, 'CSV');
  app.click('split-note-btn');
  app.click('import-btn');
  await app.settle();
  assert.equal(document.querySelector('.note-item.active .note-format-badge').textContent, 'XML');
  app.click('new-note-btn');
  assert.equal(document.querySelector('.note-item.active .note-format-badge').textContent, 'TXT');
  assert.ok(app.read('scratchpad_notes').every(note => !('format' in note)));
  app.click('db-connect-btn');
  await app.settle();
  assert.equal(badge('json').textContent, 'MD', 'workspace notes do not inherit local format cache entries');
  app.click('db-disconnect-btn');
  await app.settle();
  assert.equal(badge('json').textContent, 'JSON');
});

test('Markdown with mapping-like prose keeps its badge, heading fold, and cleaned snippet', async () => {
  await bootApp({ instance: 2, storage: { scratchpad_notes: [
    { id: 'shopping', title: 'Shopping', content: '# Shopping\n\nmilk: 2\neggs: 12', updatedAt: 1, isTitleLocked: true }
  ] } });
  const item = document.querySelector('.note-item[data-id="shopping"]');
  assert.equal(item.querySelector('.note-format-badge').textContent, 'MD');
  assert.ok(!item.querySelector('.note-item-snippet').textContent.includes('# Shopping'));
  const editor = getAppElement('editor');
  assert.ok(editor.contentDOM.querySelector('.syntax-heading'));
  assert.equal(editor.toggleFold(1), true);
  assert.equal(editor.foldedRanges.length, 1);
});

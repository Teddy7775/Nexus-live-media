import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { builtinTemplates, loadTemplates, printGeometry, validateTemplate } from '../server/templates.js';

const clone = (o) => JSON.parse(JSON.stringify(o));
const good = () => clone(builtinTemplates().find((t) => t.id === 'duo-4x6'));
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tpl-test-'));

test('every built-in template is valid and every slot fits inside its canvas', () => {
  for (const t of builtinTemplates()) {
    assert.deepEqual(validateTemplate(t), [], t.id);
    for (const s of t.slots) {
      assert.ok(s.x + s.width <= t.canvas.width && s.y + s.height <= t.canvas.height, `${t.id} slot out of bounds`);
    }
  }
});

test('strip template: two identical 3-photo strips, each exactly half the sheet wide, no overlap', () => {
  const strip = builtinTemplates().find((t) => t.id === 'strip-2x6-x2');
  assert.equal(strip.shots, 3);
  assert.equal(strip.slots.length, 6);
  const [left, right] = [strip.slots.filter((s) => s.x < 600), strip.slots.filter((s) => s.x >= 600)];
  assert.equal(left.length, 3);
  assert.equal(right.length, 3);
  left.forEach((s, i) => {
    assert.equal(right[i].x - s.x, 600, 'right strip is the left strip shifted by exactly 2 inches');
    assert.equal(right[i].y, s.y);
    assert.equal(right[i].width, s.width);
    assert.ok(s.x + s.width <= 600, 'left strip stays on its half so the 2-inch cut does not slice a photo');
  });
});

test('rejects a slot that spills outside the canvas', () => {
  const t = good();
  t.slots[0].width = 5000;
  assert.match(validateTemplate(t).join('|'), /outside/);
});

test('rejects a shot that no slot uses, and a slot pointing at a non-existent shot', () => {
  const unused = good();
  unused.shots = 3;
  assert.match(validateTemplate(unused).join('|'), /shot 2 is never used/);
  const bad = good();
  bad.slots[0].shot = 9;
  assert.match(validateTemplate(bad).join('|'), /shot must be an integer from 0 to 1/);
});

test('rejects bad ids, overlay path tricks and a missing overlay file', () => {
  const dir = tmpDir();
  try {
    const badId = good();
    badId.id = 'Has Spaces';
    assert.match(validateTemplate(badId).join('|'), /id must be/);

    const traversal = good();
    traversal.overlay = '../secret.png';
    assert.match(validateTemplate(traversal, { templatesDir: dir }).join('|'), /overlay must be a PNG file name/);

    const missing = good();
    missing.overlay = 'nope.png';
    assert.match(validateTemplate(missing, { templatesDir: dir }).join('|'), /not found/);

    fs.writeFileSync(path.join(dir, 'ok.png'), 'x');
    const present = good();
    present.overlay = 'ok.png';
    assert.deepEqual(validateTemplate(present, { templatesDir: dir }), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('loadTemplates merges user templates, lets a user template replace a built-in id, and skips broken files with a reason', () => {
  const dir = tmpDir();
  try {
    const custom = good();
    custom.id = 'wedding-duo';
    custom.name = 'Wedding duo';
    fs.writeFileSync(path.join(dir, 'wedding.json'), JSON.stringify(custom));

    const override = good();
    override.name = 'My renamed duo';
    fs.writeFileSync(path.join(dir, 'duo.json'), JSON.stringify(override));

    fs.writeFileSync(path.join(dir, 'broken.json'), '{ not json');
    const invalid = good();
    invalid.id = 'bad id';
    fs.writeFileSync(path.join(dir, 'invalid.json'), JSON.stringify(invalid));

    const { templates, problems } = loadTemplates({ templatesDir: dir });
    assert.ok(templates.has('wedding-duo'));
    assert.equal(templates.get('duo-4x6').name, 'My renamed duo');
    assert.ok(templates.has('strip-2x6-x2'), 'built-ins are still there');
    assert.deepEqual(problems.map((p) => p.file).sort(), ['broken.json', 'invalid.json']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('print geometry: landscape canvases rotate onto a portrait 4x6 page (288x432 pt); portrait ones do not', () => {
  const single = builtinTemplates().find((t) => t.id === 'single-4x6');
  const g = printGeometry(single);
  assert.equal(g.rotate, true);
  assert.equal(g.pageWidthPt, 288);
  assert.equal(g.pageHeightPt, 432);
  const strip = printGeometry(builtinTemplates().find((t) => t.id === 'strip-2x6-x2'));
  assert.equal(strip.rotate, false);
  assert.equal(strip.pageWidthPt, 288);
  assert.equal(strip.pageHeightPt, 432);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compact, groupKey, relevance, tokenize } from '../server/text.js';

test('compact ignores case, trademarks, spacing and punctuation', () => {
  assert.equal(compact('ELDEN RING™'), compact('Elden Ring'));
  assert.equal(compact('해리 포터'), compact('해리포터'));
  assert.equal(compact('Cyberpunk 2077: Phantom Liberty'), 'cyberpunk2077phantomliberty');
});

test('tokenize splits on non letters/digits, keeping Korean', () => {
  assert.deepEqual(tokenize('해리 포터와 마법사의 돌!'), ['해리', '포터와', '마법사의', '돌']);
});

test('groupKey separates categories so a movie and a book with the same title do not merge', () => {
  assert.notEqual(groupKey('movie', 'Dune'), groupKey('ebook', 'Dune'));
  assert.equal(groupKey('game', 'HADES'), groupKey('game', 'Hades'));
});

test('relevance ranks exact > prefix > partial > unrelated', () => {
  const exact = relevance('elden ring', 'ELDEN RING');
  const prefix = relevance('elden ring', 'ELDEN RING Shadow of the Erdtree');
  const partial = relevance('elden ring', 'Ring Fit Adventure');
  const unrelated = relevance('elden ring', 'Stardew Valley');
  assert.ok(exact > prefix, `${exact} > ${prefix}`);
  assert.ok(prefix > partial, `${prefix} > ${partial}`);
  assert.ok(partial > unrelated, `${partial} > ${unrelated}`);
  assert.equal(unrelated, 0);
});

test('relevance treats Korean spacing variants as a full match and counts creator', () => {
  assert.ok(relevance('해리포터', '해리 포터와 마법사의 돌') >= 1);
  assert.ok(relevance('james clear', 'Atomic Habits', 'James Clear') >= 1);
});

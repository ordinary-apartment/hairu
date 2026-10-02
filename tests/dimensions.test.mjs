import test from 'node:test';
import assert from 'node:assert/strict';
import { extractDimensions, plainText } from '../scripts/dimensions.mjs';

test('actual observed outer dimensions win over inner and packaging sizes', () => {
  const result = extractDimensions('キャビネット 幅110cm', '■商品サイズ本体外寸：幅110×奥行40×高さ75cm扉収納内寸：幅70×奥行35×高さ44cm引き出し内寸：幅29.5×奥行27×高さ7cm梱包サイズ116×46×56cm');
  assert.deepEqual([result.dimensions.width, result.dimensions.depth, result.dimensions.height], [110, 40, 75]);
  assert.equal(result.dimensions.evidence, '本体外寸:幅110×奥行40×高さ75cm');
});

test('actual observed multiple cabinet body options remain unknown', () => {
  const result = extractDimensions('キャビネット 幅120 幅75', '本体サイズ：W75×D35×H82(cm) 扉内内寸：W34.4×D31.7×H68.2(cm) 本体サイズ：W118×D35×H82(cm) 梱包サイズ W126×D40.5×H12(cm)');
  assert.equal(result.dimensions, null);
});

test('observed handle-inclusive depth ambiguity is never guessed', () => {
  assert.equal(extractDimensions('キャビネット 幅120cm', '商品サイズ（約）幅120cm×奥行き38（取手込み40）cm×高さ87cm 梱包サイズ1.（約）幅124cm×奥行き57cm×高さ13cm').dimensions, null);
});

for (const [label, caption] of [
  ['inner', '引き出し内寸：幅20×奥行30×高さ40cm'],
  ['drawer outer', '引き出し外寸：幅20×奥行30×高さ40cm'],
  ['packaging', '梱包サイズ：幅20×奥行30×高さ40cm'],
  ['shelf', '棚板：幅20×奥行30×高さ40cm'],
  ['unlabelled caption', '幅20×奥行30×高さ40cm'],
  ['missing units', '本体サイズ：幅20×奥行30×高さ40'],
  ['missing axis', '本体サイズ：幅20×奥行30cm'],
  ['unlabelled triple', '本体サイズ：20×30×40cm'],
  ['range', '本体サイズ：幅20〜30×奥行30×高さ40cm'],
  ['zero', '本体サイズ：幅0×奥行30×高さ40cm'],
  ['negative', '本体サイズ：幅-20×奥行30×高さ40cm'],
]) test(`${label} is not an outer-size match`, () => assert.equal(extractDimensions('収納家具', caption).dimensions, null));

test('fullwidth, decimals and millimeters are read without changing dimensions', () => {
  const result = extractDimensions('収納棚 幅600mm', '本体サイズ：約Ｗ６００ｍｍ×Ｄ３００ｍｍ×Ｈ１２５０ｍｍ');
  assert.deepEqual([result.dimensions.width, result.dimensions.depth, result.dimensions.height], [60, 30, 125]);
});
test('mixed explicit units convert correctly', () => {
  const result = extractDimensions('', '商品サイズ：幅600mm×奥行30cm×高さ120cm');
  assert.deepEqual([result.dimensions.width, result.dimensions.depth, result.dimensions.height], [60, 30, 120]);
});
test('repeated identical body statements are not conflicting options', () => {
  assert.ok(extractDimensions('幅60×奥行30×高さ120cm', '本体サイズ：幅60×奥行30×高さ120cm 本体外寸：幅60×奥行30×高さ120cm').dimensions);
});
test('title-only triples cannot establish explicit caption body dimensions', () => {
  assert.equal(extractDimensions('収納棚 幅60×奥行30×高さ120cm', '').dimensions, null);
  assert.equal(extractDimensions('収納ケース 内寸 幅60×奥行30×高さ120cm', '').dimensions, null);
});
test('dimensions excluding handles or casters cannot guarantee outer fit', () => {
  assert.equal(extractDimensions('', '本体サイズ：幅60×奥行30×高さ120cm（キャスターを含まない）').dimensions, null);
});
test('telescoping and title options cannot be treated as a fixed matching size', () => {
  for (const name of ['伸縮ラック', 'ラック 幅60/80cm', 'ラック 幅60cm 幅80cm']) assert.equal(extractDimensions(name, '本体サイズ：幅60×奥行30×高さ120cm').dimensions, null);
});
test('different caption body sizes and title disagreements remain unknown', () => {
  assert.equal(extractDimensions('幅80cm', '本体サイズ：幅60×奥行30×高さ120cm').dimensions, null);
  assert.equal(extractDimensions('収納棚 奥行40cm', '本体サイズ：幅60×奥行30×高さ120cm').dimensions, null);
  assert.equal(extractDimensions('', '本体サイズ：幅60×奥行30×高さ120cm 商品サイズ：幅80×奥行30×高さ120cm').dimensions, null);
});
test('plain text normalizes safely', () => assert.equal(plainText('<b>本体</b>&nbsp;サイズ'), '本体 サイズ'));

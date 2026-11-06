import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { usesCamera } from '../../media/shaderSource.ts';
import { DEFAULT_SHADER_SOURCE, SHADER_TEMPLATES } from '../../media/shaderTemplates.ts';

describe('shader templates', () => {
  it('each defines mainImage', () => {
    for (const template of SHADER_TEMPLATES)
      assert.match(template.source, /void mainImage\(out vec4 \w+, in vec2 \w+\)/, template.id);
  });

  it('each says truthfully whether it opens your camera', () => {
    for (const template of SHADER_TEMPLATES) assert.equal(usesCamera(template.source), template.camera, template.id);
  });

  it('have unique ids', () => {
    assert.equal(new Set(SHADER_TEMPLATES.map((template) => template.id)).size, SHADER_TEMPLATES.length);
  });

  it('the default is the pixel plasma, and it never touches the camera', () => {
    assert.equal(DEFAULT_SHADER_SOURCE, SHADER_TEMPLATES.find((template) => template.id === 'pixel-plasma')?.source);
    assert.equal(usesCamera(DEFAULT_SHADER_SOURCE), false);
  });
});

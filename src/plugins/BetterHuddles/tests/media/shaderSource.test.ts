import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ShaderCompileError, shaderErrorLines, usesCamera, wrapShaderSource } from '../../media/shaderSource.ts';

const USER_SOURCE = 'void mainImage(out vec4 fragColor, in vec2 fragCoord) {\n  fragColor = vec4(1.0);\n}';

/** The compiled-source line that holds the user's first line, as a driver would report it. */
function compiledLineOfUserLine(userLine: number): number {
  const lines = wrapShaderSource(USER_SOURCE).split('\n');
  return lines.indexOf(USER_SOURCE.split('\n')[0]) + userLine;
}

describe('wrapShaderSource', () => {
  it('declares the Shadertoy-style uniforms and calls mainImage from main', () => {
    const wrapped = wrapShaderSource(USER_SOURCE);
    assert.match(wrapped, /^#version 300 es\n/);
    for (const name of ['iResolution', 'iTime', 'iFrame', 'iCamera'])
      assert.match(wrapped, new RegExp(`uniform \\w+ ${name};`));
    assert.match(wrapped, /void main\(\) \{[\s\S]*mainImage\(color, gl_FragCoord\.xy\);/);
    assert.ok(wrapped.includes(USER_SOURCE));
  });
});

describe('shaderErrorLines', () => {
  it("reports the user's own line numbers, not the wrapper's", () => {
    const log = `ERROR: 0:${compiledLineOfUserLine(2)}: 'fragColr' : undeclared identifier\n`;
    assert.deepEqual(shaderErrorLines(log), ["Error (line 2): 'fragColr' : undeclared identifier"]);
  });

  it('labels warnings and drops blank lines and NULs', () => {
    const log = `WARNING: 0:${compiledLineOfUserLine(1)}: something odd\n\n\0`;
    assert.deepEqual(shaderErrorLines(log), ['Warning (line 1): something odd']);
  });

  it('leaves lines it does not recognise as they are', () => {
    assert.deepEqual(shaderErrorLines('Link failed: too many uniforms'), ['Link failed: too many uniforms']);
  });

  it('ShaderCompileError leads with the first problem', () => {
    const error = new ShaderCompileError(['Error (line 3): bad', 'Error (line 4): worse']);
    assert.match(error.message, /didn't compile: Error \(line 3\): bad/);
    assert.equal(error.lines.length, 2);
  });
});

describe('usesCamera', () => {
  it('is true when the shader calls camera() or reads iCamera', () => {
    assert.equal(usesCamera('vec3 c = camera(uv).rgb;'), true);
    assert.equal(usesCamera('vec4 c = texture(iCamera, uv);'), true);
  });

  it('ignores mentions in comments, so the starter template does not open the camera', () => {
    assert.equal(usesCamera('// camera(uv) samples your camera\n/* iCamera */\nvoid mainImage() {}'), false);
  });

  it('does not match names that merely contain "camera"', () => {
    assert.equal(usesCamera('float mycamera = 1.0; float cameraShake = 2.0;'), false);
  });
});

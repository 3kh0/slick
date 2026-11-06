// The GLSL around a user's shader. They write a Shadertoy-style
// `mainImage(out vec4 fragColor, in vec2 fragCoord)`; this adds the uniforms,
// a `camera(uv)` helper and `main()`. Pure (no WebGL), so it's testable.

const SHADER_HEADER = `#version 300 es
precision highp float;
uniform vec3 iResolution;
uniform float iTime;
uniform int iFrame;
uniform sampler2D iCamera;
uniform vec2 iCameraResolution;
out vec4 slickFragColor;
vec4 camera(vec2 uv) {
  if (iCameraResolution.x <= 0.0) return vec4(0.0, 0.0, 0.0, 1.0);
  float outputAspect = iResolution.x / iResolution.y;
  float cameraAspect = iCameraResolution.x / iCameraResolution.y;
  vec2 centered = uv - 0.5;
  if (cameraAspect > outputAspect) centered.x *= outputAspect / cameraAspect;
  else centered.y *= cameraAspect / outputAspect;
  return texture(iCamera, centered + 0.5);
}
`;

const SHADER_FOOTER = `
void main() {
  vec4 color = vec4(0.0, 0.0, 0.0, 1.0);
  mainImage(color, gl_FragCoord.xy);
  slickFragColor = vec4(color.rgb, 1.0);
}
`;

// The user's line 1 is this line of the compiled source, so error line numbers can be mapped back.
const HEADER_LINES = SHADER_HEADER.split('\n').length - 1;

export const VERTEX_SHADER = `#version 300 es
in vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`;

export function wrapShaderSource(userSource: string): string {
  return `${SHADER_HEADER}${userSource}\n${SHADER_FOOTER}`;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

/** Whether the shader reads the camera; only then is the camera opened for it. */
export function usesCamera(userSource: string): boolean {
  return /\b(camera\s*\(|iCamera\b)/.test(stripComments(userSource));
}

/**
 * Turns a GLSL info log into messages about the user's own lines. Drivers
 * write "ERROR: 0:14: 'x' : undeclared identifier"; the 14 counts our header.
 */
export function shaderErrorLines(infoLog: string): string[] {
  return infoLog
    .split('\n')
    .map((line) => line.replace(/\0/g, '').trim())
    .filter(Boolean)
    .map((line) =>
      line.replace(/^(ERROR|WARNING):\s*\d+:(\d+):\s*/, (_match, level: string, lineNumber: string) => {
        const userLine = Number(lineNumber) - HEADER_LINES;
        const where = userLine >= 1 ? `line ${userLine}` : 'setup';
        return `${level === 'ERROR' ? 'Error' : 'Warning'} (${where}): `;
      }),
    );
}

/** A shader that didn't compile; `lines` are ready to show next to the editor. */
export class ShaderCompileError extends Error {
  readonly lines: string[];

  constructor(lines: string[]) {
    super(`The shader didn't compile: ${lines[0] ?? 'unknown error'}`);
    this.name = 'ShaderCompileError';
    this.lines = lines;
  }
}

// Starting points for the video-effect editor. Each is a Shadertoy-style
// `mainImage`; see shaderSource.ts for what's available to them.

export interface ShaderTemplate {
  id: string;
  name: string;
  /** Whether the template reads your camera (it opens the camera when sent). */
  camera: boolean;
  source: string;
}

const PIXEL_PLASMA = `// Pixel plasma: four moving sine waves, drawn as chunky cells
// with only a few brightness steps, so it reads as pixel art.
//   fragCoord   this pixel's position (0,0 = bottom-left)
//   iResolution output size in pixels (.xy)
//   iTime       seconds since the effect started
//   camera(uv)  your camera at uv (0..1); using it turns your camera on

const float CELLS_TALL = 32.0;

vec3 hsl2rgb(float hue, float saturation, float lightness) {
  vec3 k = mod(vec3(0.0, 8.0, 4.0) + hue / 30.0, 12.0);
  float chroma = saturation * min(lightness, 1.0 - lightness);
  return lightness - chroma * clamp(min(k - 3.0, 9.0 - k), -1.0, 1.0);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  float cellSize = iResolution.y / CELLS_TALL;
  vec2 cell = floor(vec2(fragCoord.x, iResolution.y - fragCoord.y) / cellSize);
  vec2 center = floor(iResolution.xy / cellSize) / 2.0;
  float t = iTime;

  float plasma = sin(cell.x / 4.0 + t)
    + sin(cell.y / 3.0 - t * 1.3)
    + sin((cell.x + cell.y) / 6.0 + t * 0.7)
    + sin(distance(cell, center) / 3.0 - t * 1.6);

  float hue = mod(t * 20.0 + plasma * 22.5, 360.0);
  float band = clamp(floor((plasma + 4.0) / 8.0 * 4.0), 0.0, 3.0);
  fragColor = vec4(hsl2rgb(hue, 0.75, 0.28 + band * 0.14), 1.0);
}
`;

const GAME_BOY_CAMERA = `// 8-bit camera: your camera in big pixels and four greens.

const float CELLS_TALL = 72.0;

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  float cellSize = iResolution.y / CELLS_TALL;
  vec2 cellCenter = (floor(fragCoord / cellSize) + 0.5) * cellSize;
  vec3 color = camera(cellCenter / iResolution.xy).rgb;
  float brightness = dot(color, vec3(0.299, 0.587, 0.114));

  vec3 palette[4] = vec3[4](
    vec3(0.06, 0.22, 0.06),
    vec3(0.19, 0.38, 0.19),
    vec3(0.55, 0.67, 0.06),
    vec3(0.61, 0.74, 0.06)
  );
  int shade = int(clamp(floor(brightness * 4.0), 0.0, 3.0));
  fragColor = vec4(palette[shade], 1.0);
}
`;

const THERMAL_CAMERA = `// Thermal camera: brightness mapped onto a heat gradient.

vec3 heat(float level) {
  vec3 color = mix(vec3(0.0, 0.0, 0.25), vec3(0.55, 0.0, 0.75), smoothstep(0.0, 0.25, level));
  color = mix(color, vec3(1.0, 0.2, 0.0), smoothstep(0.25, 0.5, level));
  color = mix(color, vec3(1.0, 0.85, 0.0), smoothstep(0.5, 0.75, level));
  return mix(color, vec3(1.0), smoothstep(0.75, 1.0, level));
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec3 color = camera(fragCoord / iResolution.xy).rgb;
  float brightness = dot(color, vec3(0.299, 0.587, 0.114));
  fragColor = vec4(heat(brightness), 1.0);
}
`;

const TUNNEL = `// Checkerboard tunnel, flying forward forever.

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  // Centered, with y running -1..1 whatever the output's shape.
  vec2 point = (2.0 * fragCoord - iResolution.xy) / iResolution.y;
  float radius = length(point);
  float angle = atan(point.y, point.x);

  vec2 walls = vec2(0.4 / radius + iTime * 0.6, angle / 3.14159265);
  float checker = mod(floor(walls.x * 4.0) + floor(walls.y * 8.0), 2.0);
  vec3 color = mix(vec3(0.1, 0.05, 0.25), vec3(0.95, 0.35, 0.7), checker);
  // Darker toward the middle, so it looks far away.
  fragColor = vec4(color * clamp(radius * 1.4, 0.0, 1.0), 1.0);
}
`;

const BLANK = `// Start here. Runs once per pixel of your video, ~24 times a second.
//   fragCoord   this pixel's position (0,0 = bottom-left)
//   iResolution output size in pixels (.xy)
//   iTime       seconds since the effect started
//   iFrame      frame number
//   camera(uv)  your camera at uv (0..1); using it turns your camera on

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  fragColor = vec4(uv, 0.5 + 0.5 * sin(iTime), 1.0);
}
`;

export const SHADER_TEMPLATES: readonly ShaderTemplate[] = [
  { id: 'pixel-plasma', name: 'Pixel plasma', camera: false, source: PIXEL_PLASMA },
  { id: 'tunnel', name: 'Checkerboard tunnel', camera: false, source: TUNNEL },
  { id: 'game-boy-camera', name: '8-bit camera', camera: true, source: GAME_BOY_CAMERA },
  { id: 'thermal-camera', name: 'Thermal camera', camera: true, source: THERMAL_CAMERA },
  { id: 'blank', name: 'Blank (start here)', camera: false, source: BLANK },
];

export const DEFAULT_SHADER_SOURCE = PIXEL_PLASMA;

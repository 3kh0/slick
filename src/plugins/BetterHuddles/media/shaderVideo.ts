// A fake "camera" drawn by a user-editable fragment shader (WebGL 2) and
// captured as a MediaStream, so it can replace your camera in a huddle. A
// shader that calls `camera(uv)` gets your real camera as a texture.

import { mediaDeviceError } from './mediaSession.ts';
import { ShaderCompileError, shaderErrorLines, usesCamera, VERTEX_SHADER, wrapShaderSource } from './shaderSource.ts';

// 4:3 like most webcams; the stage shows it at this shape, uncropped.
export const SHADER_OUTPUT_SIZE = { width: 640, height: 480 };
const FRAMES_PER_SECOND = 24;
const FULL_SCREEN_QUAD = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);

export interface ShaderVideoSource {
  stream: MediaStream;
  /** Stops the animation, the stream, and the camera if it was opened. */
  stop: () => void;
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  return Object.assign(document.createElement('canvas'), { width, height });
}

function createContext(canvas: HTMLCanvasElement): WebGL2RenderingContext {
  // preserveDrawingBuffer: the canvas isn't on the page, so captureStream reads it between our draws.
  const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false, alpha: false });
  if (!gl) throw new Error("Couldn't start the video effect: this browser doesn't support WebGL 2.");
  return gl;
}

function releaseContext(gl: WebGL2RenderingContext): void {
  // Browsers cap live WebGL contexts per page; don't wait for garbage collection to free ours.
  gl.getExtension('WEBGL_lose_context')?.loseContext();
}

function compileStage(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Couldn't start the video effect: WebGL refused to create a shader.");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  const lines = shaderErrorLines(gl.getShaderInfoLog(shader) ?? '');
  gl.deleteShader(shader);
  throw new ShaderCompileError(lines.length ? lines : ['unknown compile error']);
}

/** Compiles and links a user shader; throws ShaderCompileError with the user's line numbers. */
function linkShaderProgram(gl: WebGL2RenderingContext, userSource: string): WebGLProgram {
  const vertex = compileStage(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  let fragment: WebGLShader;
  try {
    fragment = compileStage(gl, gl.FRAGMENT_SHADER, wrapShaderSource(userSource));
  } catch (error) {
    gl.deleteShader(vertex);
    throw error;
  }
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (gl.getProgramParameter(program, gl.LINK_STATUS)) return program;
  const lines = shaderErrorLines(gl.getProgramInfoLog(program) ?? '');
  gl.deleteProgram(program);
  throw new ShaderCompileError(lines.length ? lines : ['the shader failed to link']);
}

/** Compiles a shader without running it, for the editor. Returns its errors; empty means it's fine. */
export function checkShaderSource(userSource: string): string[] {
  let gl: WebGL2RenderingContext;
  try {
    gl = createContext(createCanvas(1, 1));
  } catch (error) {
    return [(error as Error).message];
  }
  try {
    gl.deleteProgram(linkShaderProgram(gl, userSource));
    return [];
  } catch (error) {
    if (error instanceof ShaderCompileError) return error.lines;
    return [(error as Error).message];
  } finally {
    releaseContext(gl);
  }
}

interface CameraFeed {
  video: HTMLVideoElement;
  stop: () => void;
}

async function openCameraFeed(constraints: MediaTrackConstraints): Promise<CameraFeed> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: constraints, audio: false });
  } catch (error) {
    throw mediaDeviceError('camera', error);
  }
  const video = Object.assign(document.createElement('video'), { muted: true, playsInline: true, srcObject: stream });
  const stop = () => stream.getTracks().forEach((track) => track.stop());
  try {
    await video.play();
  } catch (error) {
    stop();
    throw new Error(`Couldn't play your camera into the video effect: ${(error as Error).message}`, { cause: error });
  }
  return { video, stop };
}

/** Draws frames of one linked program; uploads the camera (if any) as texture unit 0 each frame. */
function createRenderer(gl: WebGL2RenderingContext, program: WebGLProgram, feed: CameraFeed | null) {
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, FULL_SCREEN_QUAD, gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'position');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  // Video rows start at the top; GL's texture coordinates start at the bottom.
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  const black = new Uint8Array([0, 0, 0, 255]);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, black);

  const uniform = (name: string) => gl.getUniformLocation(program, name);
  const locations = {
    resolution: uniform('iResolution'),
    time: uniform('iTime'),
    frame: uniform('iFrame'),
    camera: uniform('iCamera'),
    cameraResolution: uniform('iCameraResolution'),
  };
  gl.uniform1i(locations.camera, 0);
  gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
  const startedAt = performance.now();
  let frame = 0;

  return function draw(): void {
    const video = feed?.video;
    if (video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
      gl.uniform2f(locations.cameraResolution, video.videoWidth, video.videoHeight);
    }
    gl.uniform3f(locations.resolution, gl.drawingBufferWidth, gl.drawingBufferHeight, 1);
    gl.uniform1f(locations.time, (performance.now() - startedAt) / 1000);
    gl.uniform1i(locations.frame, frame++);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };
}

/**
 * Starts a shader as a camera-like MediaStream. Each call makes a new stream:
 * Chime stops the tracks of a video input when it's swapped out.
 * `cameraConstraints` are only used if the shader reads the camera.
 */
export async function startShaderStream(
  userSource: string,
  cameraConstraints: MediaTrackConstraints,
): Promise<ShaderVideoSource> {
  const canvas = createCanvas(SHADER_OUTPUT_SIZE.width, SHADER_OUTPUT_SIZE.height);
  const gl = createContext(canvas);
  let feed: CameraFeed | null = null;
  let draw: () => void;
  try {
    const program = linkShaderProgram(gl, userSource);
    if (usesCamera(userSource)) feed = await openCameraFeed(cameraConstraints);
    draw = createRenderer(gl, program, feed);
    draw();
  } catch (error) {
    feed?.stop();
    releaseContext(gl);
    throw error;
  }

  // setInterval rather than requestAnimationFrame so the video keeps moving while this tab is in the background.
  const timer = setInterval(draw, 1000 / FRAMES_PER_SECOND);
  const stream = canvas.captureStream(FRAMES_PER_SECOND);
  // Keep edges sharp rather than smoothing motion: pixel-art effects stay crisp.
  for (const track of stream.getVideoTracks()) track.contentHint = 'detail';

  return {
    stream,
    stop() {
      clearInterval(timer);
      for (const track of stream.getTracks()) track.stop();
      feed?.stop();
      releaseContext(gl);
    },
  };
}

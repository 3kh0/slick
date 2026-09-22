import fs from 'node:fs';
import path from 'node:path';

/** Stage on the destination filesystem so the final rename is atomic. */
export function stageAppImage(verifiedFile: string, currentFile: string): string {
  const dir = path.dirname(currentFile);
  const staged = path.join(dir, `.slick-update-${process.pid}-${Date.now()}.AppImage`);
  try {
    fs.copyFileSync(verifiedFile, staged, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(staged, 0o755);
    return staged;
  } catch (error) {
    fs.rmSync(staged, { force: true });
    throw error;
  }
}

export function swapAppImage(staged: string, currentFile: string): void {
  fs.renameSync(staged, currentFile);
}

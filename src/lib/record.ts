/**
 * Records the current browser tab to a video file, entirely in the browser (Screen Capture API +
 * MediaRecorder). Nothing is uploaded: the file is handed to the user as a download.
 */

export function canRecord(): boolean {
  return typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;
}

/** MP4 where the browser can write it (plays everywhere, incl. LinkedIn and Slack), else WebM. */
function pickFormat(): { mime: string; ext: string } {
  const candidates = [
    { mime: 'video/mp4;codecs=avc1.640028', ext: 'mp4' },
    { mime: 'video/mp4', ext: 'mp4' },
    { mime: 'video/webm;codecs=vp9', ext: 'webm' },
    { mime: 'video/webm', ext: 'webm' },
  ];
  return candidates.find((c) => MediaRecorder.isTypeSupported(c.mime)) ?? { mime: '', ext: 'webm' };
}

export interface Recording {
  start: () => void;
  /** Stops and downloads the file (also happens if the user ends sharing from the browser bar). */
  stop: () => void;
}

/**
 * Asks the user to share this tab (Chrome/Edge preselect it). Resolves null when they cancel.
 * `onEnd` runs once the file has been saved or the recording was abandoned.
 */
export async function captureTab(fileName: string, onEnd: () => void): Promise<Recording | null> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 30, cursor: 'never' } as MediaTrackConstraints,
      audio: false,
      // Chrome/Edge: offer "this tab" first and keep the user from switching away mid-recording
      preferCurrentTab: true,
      selfBrowserSurface: 'include',
      surfaceSwitching: 'exclude',
    } as DisplayMediaStreamOptions);
  } catch {
    return null;
  }
  const { mime, ext } = pickFormat();
  const rec = new MediaRecorder(stream, { ...(mime && { mimeType: mime }), videoBitsPerSecond: 12_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.onstop = () => {
    stream.getTracks().forEach((t) => t.stop());
    if (chunks.length) {
      const url = URL.createObjectURL(new Blob(chunks, { type: rec.mimeType || mime || 'video/webm' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${fileName}.${ext}`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }
    onEnd();
  };
  const stop = () => rec.state !== 'inactive' && rec.stop();
  stream.getVideoTracks()[0]?.addEventListener('ended', () => (rec.state === 'inactive' ? onEnd() : stop()));
  return { start: () => rec.state === 'inactive' && rec.start(1000), stop };
}

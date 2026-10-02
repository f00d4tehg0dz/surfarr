import { useEffect, useRef } from 'react';
import { isArchiveId, archiveFileUrl, youtubeEmbedUrl } from '../shared/media';

// Plays one video from whichever source it lives on: a YouTube embed, or a
// plain <video> for Internet Archive MP4 files. Starts at `seekSeconds` so
// the virtual clock stays in sync; rebuild it (change `key`) to re-tune.
export default function SourcePlayer({ videoId, seekSeconds = 0, controls = true, title = 'SurfArr', className = 'absolute inset-0 h-full w-full' }) {
  const ref = useRef(null);
  const archive = isArchiveId(videoId);

  useEffect(() => {
    const v = ref.current;
    if (!archive || !v) return;
    const start = () => {
      if (seekSeconds > 0 && Math.abs(v.currentTime - seekSeconds) > 2) v.currentTime = seekSeconds;
      // Browsers block unmuted autoplay until the user interacts: fall back to muted
      v.play().catch(() => { v.muted = true; v.play().catch(() => {}); });
    };
    if (v.readyState >= 1) start();
    else v.addEventListener('loadedmetadata', start, { once: true });
    return () => v.removeEventListener('loadedmetadata', start);
  }, [videoId, archive]); // eslint-disable-line react-hooks/exhaustive-deps — seek only on (re)tune

  if (!videoId) return null;
  if (archive) {
    return (
      <video
        ref={ref}
        className={`${className} bg-black object-contain`}
        src={archiveFileUrl(videoId)}
        title={title}
        controls={controls}
        playsInline
        preload="metadata"
      />
    );
  }
  return (
    <iframe
      className={className}
      src={youtubeEmbedUrl(videoId, seekSeconds, controls)}
      title={title}
      allow="autoplay; encrypted-media"
      allowFullScreen
      style={{ border: 'none' }}
    />
  );
}

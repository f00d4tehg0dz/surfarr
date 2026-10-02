import { useState, useEffect, useRef } from 'react';
import { useNowPlaying } from '../../hooks/useChannels';
import SourcePlayer from './SourcePlayer';

export default function VideoPlayer({ channelId }) {
  const { data: nowPlayingList } = useNowPlaying();
  const [iframeSrc, setIframeSrc] = useState(null);
  const prevVideoRef = useRef(null);

  // Find the now-playing entry for this channel
  const nowPlaying = nowPlayingList?.find((ch) => ch.id === channelId)?.nowPlaying;

  useEffect(() => {
    if (!nowPlaying?.videoId) {
      setIframeSrc(null);
      return;
    }

    // Only rebuild the iframe when the video ID changes (not on seek updates)
    if (prevVideoRef.current === nowPlaying.videoId) return;
    prevVideoRef.current = nowPlaying.videoId;

    setIframeSrc({ id: nowPlaying.videoId, seek: nowPlaying.seekSeconds || 0 });
  }, [nowPlaying?.videoId]);

  return (
    <div className="relative w-full h-full bg-m3-black">
      {iframeSrc ? (
        <SourcePlayer
          key={iframeSrc.id}
          videoId={iframeSrc.id}
          seekSeconds={iframeSrc.seek}
          title="SurfArr Live"
          className="absolute inset-0 w-full h-full"
        />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 scanlines">
          <div className="font-mono text-sm font-bold tracking-[0.3em] text-m3-primary animate-on-air">NO SIGNAL</div>
          <div className="text-m3-muted text-xs">
            {nowPlayingList ? 'No video data for this channel' : 'Loading...'}
          </div>
        </div>
      )}
    </div>
  );
}

import { useState, useEffect, useRef } from 'react';
import SourcePlayer from '../player/SourcePlayer';

export default function CrtTv({ videoId, seekSeconds, channelName, channelNumber }) {
  const [showStatic, setShowStatic] = useState(false);
  const prevVideoRef = useRef(videoId);
  const [lockedSrc, setLockedSrc] = useState(null);
  const [osd, setOsd] = useState(true);

  // Show the green on-screen channel number for 3s after every tune
  useEffect(() => {
    setOsd(true);
    const t = setTimeout(() => setOsd(false), 3000);
    return () => clearTimeout(t);
  }, [channelNumber]);

  useEffect(() => {
    if (!videoId) {
      setLockedSrc(null);
      return;
    }

    if (prevVideoRef.current && prevVideoRef.current !== videoId) {
      setShowStatic(true);
      const timer = setTimeout(() => setShowStatic(false), 400);
      setLockedSrc({ id: videoId, seek: seekSeconds || 0 });
      prevVideoRef.current = videoId;
      return () => clearTimeout(timer);
    }

    if (!lockedSrc) {
      setLockedSrc({ id: videoId, seek: seekSeconds || 0 });
    }

    prevVideoRef.current = videoId;
  }, [videoId]); // intentionally omit seekSeconds — only rebuild on video change

  return (
    <div className="flex flex-col items-center justify-center h-full" style={{ padding: '3%' }}>
      {/* TV Unit — all sizing is relative so it scales with its container */}
      <div className="relative w-full" style={{ maxWidth: 'min(92%, calc((100dvh - 9rem) * 1.2))' }}>

        {/* TV Outer Shell — padding as % keeps bezel proportional */}
        <div
          className="relative rounded-[3%]"
          style={{
            background: 'linear-gradient(180deg,#26222c 0%,#17151c 55%,#121016 100%)',
            border: '0.5vw solid #0b0a0e',
            padding: '2.5% 3% 1.5%',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), inset 0 0 2vw rgba(0,0,0,0.7), 0 0.6vw 0 #000, 0 2vw 6vw -1vw rgba(255,181,71,0.18)',
          }}
        >
          {/* Top vents — repeatable bars that fill available width */}
          <div className="flex justify-center gap-[0.4%] mb-[1.5%]">
            {Array.from({ length: 20 }).map((_, i) => (
              <div
                key={i}
                className="rounded-full"
                style={{ flex: '1 1 0', maxWidth: '3%', height: '0.2vw', minHeight: 1, background: '#222' }}
              />
            ))}
          </div>

          {/* Screen bezel — inset shadow scales with viewport */}
          <div
            className="relative overflow-hidden rounded-[2%]"
            style={{
              background: '#111',
              border: '0.35vw solid #0a0a0a',
              boxShadow: 'inset 0 0 1.5vw rgba(0,0,0,0.9), inset 0 0 4vw rgba(0,0,0,0.5)',
            }}
          >
            {/* 4:3 aspect ratio */}
            <div className="relative w-full" style={{ paddingBottom: '75%' }}>
              {/* Player: YouTube embed or Internet Archive video */}
              {lockedSrc && !showStatic && (
                <SourcePlayer
                  key={lockedSrc.id}
                  videoId={lockedSrc.id}
                  seekSeconds={lockedSrc.seek}
                  controls={false}
                  title={channelName || 'SurfArr TV'}
                  className="absolute inset-0 w-full h-full"
                />
              )}

              {/* No signal screen */}
              {!videoId && !showStatic && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0a0a0a]">
                  <div className="text-m3-primary font-bold tracking-wide animate-pulse"
                    style={{ fontSize: 'clamp(1rem, 2.5vw, 2rem)' }}>
                    NO SIGNAL
                  </div>
                  <div className="text-m3-muted mt-[0.5%]"
                    style={{ fontSize: 'clamp(0.6rem, 1vw, 0.85rem)' }}>
                    Select a channel
                  </div>
                </div>
              )}

              {/* On-screen channel number, shown briefly after tuning */}
              {osd && channelNumber && (
                <div className="absolute right-[4%] top-[5%] z-30 font-mono font-bold text-[#7CFF8A] tabular-nums"
                  style={{ fontSize: 'clamp(1.2rem, 4vw, 3.4rem)', textShadow: '0 0 12px rgba(124,255,138,.8), 2px 2px 0 #000' }}>
                  {String(channelNumber).padStart(2, '0')}
                </div>
              )}

              {/* Static / channel switch effect */}
              {showStatic && (
                <div className="absolute inset-0 z-20 crt-static" />
              )}

              {/* Scanline overlay */}
              <div
                className="absolute inset-0 z-10 pointer-events-none"
                style={{
                  background: 'repeating-linear-gradient(0deg, rgba(0,0,0,0.15) 0px, rgba(0,0,0,0.15) 1px, transparent 1px, transparent 3px)',
                  mixBlendMode: 'multiply',
                }}
              />

              {/* Vignette overlay */}
              <div
                className="absolute inset-0 z-10 pointer-events-none"
                style={{
                  background: 'radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.6) 100%)',
                }}
              />

              {/* Screen glow — blue tint */}
              <div
                className="absolute inset-0 z-10 pointer-events-none"
                style={{
                  background: 'radial-gradient(ellipse at center, rgba(255,181,71,0.04) 0%, transparent 70%)',
                }}
              />
            </div>
          </div>

          {/* Channel info bar below screen — font sizes clamp for readability */}
          <div className="flex items-center justify-between px-[1%]" style={{ marginTop: '1.5%' }}>
            <div className="flex items-center" style={{ gap: 'clamp(4px, 0.8vw, 12px)' }}>
              {/* Power LED — scales with vw */}
              <div
                className="rounded-full bg-m3-success"
                style={{
                  width: 'clamp(4px, 0.5vw, 8px)',
                  height: 'clamp(4px, 0.5vw, 8px)',
                  boxShadow: '0 0 clamp(3px, 0.4vw, 6px) rgba(129,201,149,0.6)',
                }}
              />
              <div className="font-medium tracking-wide"
                style={{ color: '#444', fontSize: 'clamp(0.5rem, 0.8vw, 0.75rem)' }}>
                SURFARR · COLOR TV
              </div>
            </div>
            {channelNumber && (
              <div className="flex items-center" style={{ gap: 'clamp(4px, 0.5vw, 8px)' }}>
                <span className="font-mono font-bold text-m3-primary tabular-nums"
                  style={{ fontSize: 'clamp(0.6rem, 1vw, 0.9rem)', textShadow: '0 0 8px rgba(255,181,71,.6)' }}>
                  CH {channelNumber}
                </span>
                <span className="font-medium"
                  style={{ color: '#555', fontSize: 'clamp(0.5rem, 0.8vw, 0.75rem)' }}>
                  {channelName}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* TV Stand / legs — gap and size are % of TV width */}
        <div className="flex justify-center" style={{ gap: '30%', marginTop: '-0.2%' }}>
          <div
            className="rounded-b-sm"
            style={{
              width: '2%', height: 'clamp(4px, 0.8vw, 10px)',
              background: '#111', borderLeft: '1px solid #0a0a0a', borderRight: '1px solid #0a0a0a',
              transform: 'perspective(50px) rotateY(-5deg)',
            }}
          />
          <div
            className="rounded-b-sm"
            style={{
              width: '2%', height: 'clamp(4px, 0.8vw, 10px)',
              background: '#111', borderLeft: '1px solid #0a0a0a', borderRight: '1px solid #0a0a0a',
              transform: 'perspective(50px) rotateY(5deg)',
            }}
          />
        </div>
      </div>

      {/* Inline styles for static animation */}
      <style>{`
        @keyframes staticNoise {
          0% { background-position: 0 0; }
          10% { background-position: -5% -10%; }
          20% { background-position: -15% 5%; }
          30% { background-position: 7% -25%; }
          40% { background-position: -5% 25%; }
          50% { background-position: -15% 10%; }
          60% { background-position: 15% 0%; }
          70% { background-position: 0% 15%; }
          80% { background-position: 3% -35%; }
          90% { background-position: -10% 5%; }
          100% { background-position: 0 0; }
        }
        .crt-static {
          background: repeating-radial-gradient(
            circle at 17% 32%, #fff 0px, transparent 1px),
            repeating-radial-gradient(
            circle at 62% 17%, #ccc 0px, transparent 1px),
            repeating-radial-gradient(
            circle at 83% 72%, #fff 0px, transparent 1px);
          background-size: 3px 3px, 4px 4px, 2px 2px;
          animation: staticNoise 0.15s steps(5) infinite;
          opacity: 0.7;
        }
      `}</style>
    </div>
  );
}

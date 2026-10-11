/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';

const SPOTIFY_REFRESH_KEY = 'spotify_refresh_token';

declare global {
  interface Window {
    AndroidNotch?: {
      updateNotchSize?: (widthDp: number, heightDp: number) => void;
    };
    webkit?: {
      messageHandlers?: {
        notchBounds?: {
          postMessage?: (bounds: { width: number; height: number }) => void;
        };
      };
    };
  }
}

interface SpotifyTrackState {
  connected: boolean;
  isPlaying: boolean;
  hasTrack?: boolean;
  title?: string;
  artist?: string;
  albumArt?: string;
  progressMs?: number;
  durationMs?: number;
  refreshToken?: string;
}

function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

export default function App() {
  const [spotify, setSpotify] = useState<SpotifyTrackState>(() => ({
    connected: Boolean(
      typeof window !== 'undefined' &&
        window.localStorage.getItem(SPOTIFY_REFRESH_KEY)
    ),
    isPlaying: false,
  }));
  const [isMusicExpanded, setIsMusicExpanded] = useState(false);
  const [localProgressMs, setLocalProgressMs] = useState(0);
  const [dominantColor, setDominantColor] = useState('#E5D5D2');

  // Check if running in transparent system overlay mode (?overlay=1 or ?transparent=1 or inside AndroidNotch wrapper)
  const [isOverlayMode] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    return (
      params.get('overlay') === '1' ||
      params.get('transparent') === '1' ||
      Boolean(window.AndroidNotch)
    );
  });

  // Track landscape full-screen video mode so the notch automatically collapses/hides when watching full-screen videos
  const [isLandscapeFullscreen, setIsLandscapeFullscreen] =
    useState<boolean>(false);

  const longPressTimerRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef<boolean>(false);

  // Detect landscape orientation or fullscreen video to auto-collapse the notch
  useEffect(() => {
    const checkOrientationAndFullscreen = () => {
      const isLandscape =
        window.innerWidth > window.innerHeight && window.innerWidth > 500;
      const isDocFullscreen = Boolean(document.fullscreenElement);
      if (isLandscape || isDocFullscreen) {
        setIsMusicExpanded(false);
        setIsLandscapeFullscreen(true);
      } else {
        setIsLandscapeFullscreen(false);
      }
    };

    window.addEventListener('resize', checkOrientationAndFullscreen);
    window.addEventListener('orientationchange', checkOrientationAndFullscreen);
    document.addEventListener(
      'fullscreenchange',
      checkOrientationAndFullscreen
    );
    return () => {
      window.removeEventListener('resize', checkOrientationAndFullscreen);
      window.removeEventListener(
        'orientationchange',
        checkOrientationAndFullscreen
      );
      document.removeEventListener(
        'fullscreenchange',
        checkOrientationAndFullscreen
      );
    };
  }, []);

  // Dominant color extraction from Spotify album cover art (with vibrancy boost)
  useEffect(() => {
    if (!spotify.albumArt) return;
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.src = spotify.albumArt;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 50;
      canvas.height = 50;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, 50, 50);
        const data = ctx.getImageData(0, 0, 50, 50).data;
        let r = 0,
          g = 0,
          b = 0;
        for (let i = 0; i < data.length; i += 4) {
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
        }
        const avgR = Math.floor(r / (data.length / 4));
        const avgG = Math.floor(g / (data.length / 4));
        const avgB = Math.floor(b / (data.length / 4));

        const boost = (c: number) => Math.min(255, Math.floor(c * 1.6 + 40));
        setDominantColor(
          `rgb(${boost(avgR)}, ${boost(avgG)}, ${boost(avgB)})`
        );
      }
    };
  }, [spotify.albumArt]);

  // Poll Spotify live playback state, automatically supplying saved refreshToken so user never has to log in again
  const fetchSpotifyNowPlaying = useCallback(async () => {
    try {
      const savedRefresh =
        window.localStorage.getItem(SPOTIFY_REFRESH_KEY) || '';
      const res = await fetch('/api/spotify/now-playing', {
        cache: 'no-store',
        headers: savedRefresh
          ? { 'x-spotify-refresh-token': savedRefresh }
          : undefined,
      });
      if (!res.ok) return;
      const data = (await res.json()) as SpotifyTrackState;

      if (data.refreshToken) {
        window.localStorage.setItem(SPOTIFY_REFRESH_KEY, data.refreshToken);
      }

      setSpotify(data);
      if (typeof data.progressMs === 'number') {
        setLocalProgressMs(data.progressMs);
      }
      if (!data.isPlaying && !data.hasTrack) {
        setIsMusicExpanded(false);
      }
    } catch {
      // Ignore network errors
    }
  }, []);

  useEffect(() => {
    fetchSpotifyNowPlaying();
    const spInterval = window.setInterval(fetchSpotifyNowPlaying, 2000);

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        if (event.data.refreshToken) {
          window.localStorage.setItem(
            SPOTIFY_REFRESH_KEY,
            event.data.refreshToken
          );
        }
        fetchSpotifyNowPlaying();
      }
    };
    window.addEventListener('message', handleMessage);

    return () => {
      window.clearInterval(spInterval);
      window.removeEventListener('message', handleMessage);
    };
  }, [fetchSpotifyNowPlaying]);

  // Smooth 1-second local progress ticker while Spotify song is playing
  useEffect(() => {
    if (!spotify.isPlaying || !spotify.durationMs) return;
    const timer = window.setInterval(() => {
      setLocalProgressMs((prev) =>
        Math.min(spotify.durationMs || prev, prev + 1000)
      );
    }, 1000);
    return () => window.clearInterval(timer);
  }, [spotify.isPlaying, spotify.durationMs]);

  // Connect to Spotify via OAuth popup (only needed once; saved forever after)
  const connectSpotify = useCallback(async () => {
    try {
      const origin = encodeURIComponent(window.location.origin);
      const res = await fetch(`/api/spotify/auth-url?origin=${origin}`);
      if (!res.ok) return;
      const { url } = await res.json();
      const popup = window.open(
        url,
        'spotify_oauth_popup',
        'width=520,height=700'
      );
      // Fallback for Android WebView where window.open may be blocked
      if (!popup) {
        window.location.href = url;
      }
    } catch {
      // Ignore error
    }
  }, []);

  const showMusicNotch =
    !isLandscapeFullscreen &&
    spotify.connected &&
    (spotify.isPlaying || (isMusicExpanded && Boolean(spotify.hasTrack)));

  // Calculate exact pixel dimensions and notify Samsung A16 / iOS native overlay window for touch passthrough
  const currentNotchWidth = showMusicNotch ? 315 : 209;
  const currentNotchHeight = showMusicNotch && isMusicExpanded ? 180 : 44;

  useEffect(() => {
    try {
      // Notify Android Samsung A16 WindowManager overlay service
      if (window.AndroidNotch?.updateNotchSize) {
        window.AndroidNotch.updateNotchSize(
          currentNotchWidth,
          currentNotchHeight
        );
      }
      // Notify iOS WKWebView passthrough window
      if (window.webkit?.messageHandlers?.notchBounds?.postMessage) {
        window.webkit.messageHandlers.notchBounds.postMessage({
          width: currentNotchWidth + 12,
          height: currentNotchHeight,
        });
      }
    } catch {
      // Ignore bridge errors in normal browser
    }
  }, [currentNotchWidth, currentNotchHeight]);

  // Long press on the music notch drops down the expanded Spotify player
  const handlePointerDown = () => {
    longPressTriggeredRef.current = false;
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current);
    }
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTriggeredRef.current = true;
      if (!spotify.connected) {
        connectSpotify();
      } else if (showMusicNotch) {
        setIsMusicExpanded((prev) => !prev);
      }
    }, 450);
  };

  const handlePointerUpOrLeave = () => {
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleNotchClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false;
      return;
    }
    if (!spotify.connected) {
      connectSpotify();
    }
  };

  const handleControl = async (
    e: React.MouseEvent,
    action: 'play' | 'pause' | 'next' | 'previous'
  ) => {
    e.stopPropagation();
    try {
      const savedRefresh =
        window.localStorage.getItem(SPOTIFY_REFRESH_KEY) || '';
      await fetch('/api/spotify/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, refreshToken: savedRefresh }),
      });
      window.setTimeout(fetchSpotifyNowPlaying, 250);
    } catch {
      // Ignore error
    }
  };

  // Width: 209px normal; 315px when extended horizontally for music so album art and waves sit cleanly outside the 209px hardware notch
  const notchWidthClass = showMusicNotch ? 'w-[315px]' : 'w-[209px]';

  // Vertical Height:
  // Exact 44px top notch depth; expands to 180px when long-pressed dropped down
  const notchHeightClass =
    showMusicNotch && isMusicExpanded ? 'h-[180px]' : 'h-[44px]';

  const durationMs = spotify.durationMs || 1;
  const progressPercent = Math.min(
    100,
    Math.max(0, (localProgressMs / durationMs) * 100)
  );
  const remainingMs = Math.max(0, durationMs - localProgressMs);

  return (
    <div
      onClick={() => {
        if (isMusicExpanded) {
          setIsMusicExpanded(false);
        }
      }}
      className={`fixed inset-0 w-full h-full ${
        isOverlayMode ? 'bg-transparent' : 'bg-white'
      } flex justify-center items-start overflow-hidden select-none`}
    >
      {/* Pitch Black Notch Only (flush at the very top edge, 44px exact vertical height) */}
      <div
        onClick={handleNotchClick}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUpOrLeave}
        onPointerLeave={handlePointerUpOrLeave}
        onContextMenu={(e) => e.preventDefault()}
        className="relative flex items-start cursor-pointer"
      >
        {/* Left inward curve fillet (6px CAD radius) */}
        <svg
          width="6"
          height="6"
          viewBox="0 0 6 6"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="block shrink-0"
        >
          <path d="M0 0H6V6C6 2.68629 3.31371 0 0 0Z" fill="#000000" />
        </svg>

        {/* Main pitch black notch body */}
        <div
          className={`${notchWidthClass} ${notchHeightClass} bg-black rounded-b-[22px] overflow-hidden transition-[width,height] duration-300 ease-in-out relative flex flex-col items-center justify-end`}
        >
          {/* 1. COMPACT MUSIC STATE: Extended horizontally at 44px vertical height, album art on left, 6-bar wave on right */}
          <div
            className={`absolute inset-x-0 top-0 h-[44px] px-[13px] flex items-center justify-between transition-opacity duration-200 ${
              showMusicNotch && !isMusicExpanded
                ? 'opacity-100'
                : 'opacity-0 pointer-events-none'
            }`}
          >
            {/* Left Album Cover Art */}
            {spotify.albumArt ? (
              <img
                src={spotify.albumArt}
                alt=""
                className="w-[23px] h-[23px] rounded-[6px] object-cover shrink-0"
              />
            ) : (
              <div className="w-[23px] h-[23px] rounded-[6px] bg-neutral-800 shrink-0" />
            )}

            {/* Center 209px pitch-black notch space */}
            <div className="flex-1" />

            {/* Right Animated 6-Bar Music Equalizer Waves (interactive) */}
            <div className="flex items-center gap-[2.5px] h-[18px] shrink-0">
              {[0.1, 0.05, 0.15, 0, 0.1, 0.08].map((delay, i) => (
                <span
                  key={i}
                  className={`w-[2px] rounded-full ${
                    spotify.isPlaying ? 'animate-fast-wave' : 'h-[4px]'
                  }`}
                  style={{
                    backgroundColor: dominantColor,
                    animationDelay: `${delay}s`,
                    height: spotify.isPlaying ? '20px' : '4px',
                  }}
                />
              ))}
            </div>
          </div>

          {/* 2. EXPANDED MUSIC STATE (Long-press drop-down at exact same 315px width) */}
          <div
            className={`w-full h-full pt-[36px] pb-[15px] px-[18px] flex flex-col justify-between transition-opacity duration-250 ${
              showMusicNotch && isMusicExpanded
                ? 'opacity-100'
                : 'opacity-0 pointer-events-none hidden'
            }`}
          >
            {/* Top row: Album Art + Title/Artist + Small Waveform */}
            <div className="flex items-center justify-between gap-[12px]">
              {spotify.albumArt ? (
                <img
                  src={spotify.albumArt}
                  alt=""
                  className="w-[52px] h-[52px] rounded-[11px] object-cover shrink-0"
                />
              ) : (
                <div className="w-[52px] h-[52px] rounded-[11px] bg-neutral-800 shrink-0" />
              )}

              <div className="flex flex-col flex-1 min-w-0">
                <span className="text-white text-[14px] font-semibold leading-tight truncate">
                  {spotify.title}
                </span>
                <span className="text-[#8E8E93] text-[12.5px] font-normal leading-tight truncate mt-[2px]">
                  {spotify.artist}
                </span>
              </div>

              {/* Right mini waveform */}
              <div className="flex items-center gap-[2px] h-[16px] shrink-0">
                {[0.1, 0.05, 0.15, 0, 0.1].map((delay, i) => (
                  <span
                    key={i}
                    className={`w-[2px] rounded-full ${
                      spotify.isPlaying ? 'animate-fast-wave' : 'h-[4px]'
                    }`}
                    style={{
                      backgroundColor: dominantColor,
                      animationDelay: `${delay}s`,
                      height: spotify.isPlaying ? '20px' : '4px',
                    }}
                  />
                ))}
              </div>
            </div>

            {/* Middle row: Elapsed time + Progress bar + Remaining time */}
            <div className="flex items-center gap-[8px] w-full mt-[6px]">
              <span className="text-[#8E8E93] text-[10px] font-medium tabular-nums">
                {formatTime(localProgressMs)}
              </span>
              <div className="flex-1 h-[4.5px] bg-[#3A3A3C] rounded-full overflow-hidden">
                <div
                  className="h-full bg-white rounded-full transition-[width] duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <span className="text-[#8E8E93] text-[10px] font-medium tabular-nums">
                -{formatTime(remainingMs)}
              </span>
            </div>

            {/* Bottom row: Playback Controls (Prev, Pause/Play, Next) + AirPlay icon */}
            <div className="relative flex items-center justify-center w-full mt-[4px]">
              <div className="flex items-center gap-[32px]">
                {/* Previous Track (double left triangles) */}
                <button
                  type="button"
                  onClick={(e) => handleControl(e, 'previous')}
                  className="text-white active:opacity-60"
                >
                  <svg
                    width="22"
                    height="16"
                    viewBox="0 0 24 16"
                    fill="currentColor"
                  >
                    <path d="M11 1.5C11 0.9 10.3 0.6 9.8 1L1.2 7.2C0.7 7.6 0.7 8.4 1.2 8.8L9.8 15C10.3 15.4 11 15.1 11 14.5V1.5ZM22.5 1.5C22.5 0.9 21.8 0.6 21.3 1L12.7 7.2C12.2 7.6 12.2 8.4 12.7 8.8L21.3 15C21.8 15.4 22.5 15.1 22.5 14.5V1.5Z" />
                  </svg>
                </button>

                {/* Play / Pause */}
                <button
                  type="button"
                  onClick={(e) =>
                    handleControl(e, spotify.isPlaying ? 'pause' : 'play')
                  }
                  className="text-white active:opacity-60"
                >
                  {spotify.isPlaying ? (
                    <svg
                      width="18"
                      height="20"
                      viewBox="0 0 18 20"
                      fill="currentColor"
                    >
                      <rect x="2" y="1" width="5" height="18" rx="1.5" />
                      <rect x="11" y="1" width="5" height="18" rx="1.5" />
                    </svg>
                  ) : (
                    <svg
                      width="18"
                      height="20"
                      viewBox="0 0 18 20"
                      fill="currentColor"
                    >
                      <path d="M3 1.8C3 1.1 3.8 0.7 4.4 1.1L16.2 9.1C16.7 9.5 16.7 10.5 16.2 10.9L4.4 18.9C3.8 19.3 3 18.9 3 18.2V1.8Z" />
                    </svg>
                  )}
                </button>

                {/* Next Track (double right triangles) */}
                <button
                  type="button"
                  onClick={(e) => handleControl(e, 'next')}
                  className="text-white active:opacity-60"
                >
                  <svg
                    width="22"
                    height="16"
                    viewBox="0 0 24 16"
                    fill="currentColor"
                  >
                    <path d="M1.5 1.5C1.5 0.9 2.2 0.6 2.7 1L11.3 7.2C11.8 7.6 11.8 8.4 11.3 8.8L2.7 15C2.2 15.4 1.5 15.1 1.5 14.5V1.5ZM13 1.5C13 0.9 13.7 0.6 14.2 1L22.8 7.2C23.3 7.6 23.3 8.4 22.8 8.8L14.2 15C13.7 15.4 13 15.1 13 14.5V1.5Z" />
                  </svg>
                </button>
              </div>

              {/* Bottom-right AirPlay / Output icon matching Screenshot 2 */}
              <div className="absolute right-0 text-[#C7C7CC]">
                <svg
                  width="17"
                  height="17"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M6 17.5a7.5 7.5 0 1 1 12 0" />
                  <path d="M9 14.5a3.5 3.5 0 1 1 6 0" />
                  <polygon
                    points="12 14 7 21 17 21 12 14"
                    fill="currentColor"
                    stroke="none"
                  />
                </svg>
              </div>
            </div>
          </div>
        </div>

        {/* Right inward curve fillet (6px CAD radius) */}
        <svg
          width="6"
          height="6"
          viewBox="0 0 6 6"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="block shrink-0"
        >
          <path d="M6 0H0V6C0 2.68629 2.68629 0 6 0Z" fill="#000000" />
        </svg>
      </div>
    </div>
  );
}

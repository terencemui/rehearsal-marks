import type { SyntheticEvent } from 'react';

export interface ThumbnailProps {
  videoId: string;
  className: string;
}

/**
 * A recording's still, decorative beside whatever title names it. hq720 is
 * the high-resolution still; not every upload has one, so a failed load
 * steps down to the medium still, and a second failure hides the image
 * rather than leaving a broken frame.
 */
export function Thumbnail({ videoId, className }: ThumbnailProps) {
  function handleError(event: SyntheticEvent<HTMLImageElement>): void {
    const image = event.currentTarget;
    if (image.dataset.fallback === 'true') {
      image.hidden = true;
      return;
    }
    image.dataset.fallback = 'true';
    image.src = `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
  }

  return (
    <img
      className={className}
      src={`https://i.ytimg.com/vi/${videoId}/hq720.jpg`}
      alt=""
      loading="lazy"
      decoding="async"
      onError={handleError}
    />
  );
}

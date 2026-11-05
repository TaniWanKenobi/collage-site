// Zoom order. Index k is held at scroll position P = k + 0.5 (see ZoomStage camera script).
export const ORDER = ['projects', 'timeline', 'photos', 'writing', 'map', 'guestbook', 'contact'] as const;
export type SectionKey = (typeof ORDER)[number];
export const NAMES: Record<SectionKey, string> = {
  projects: 'Projects', timeline: 'Timeline', photos: 'Photos', writing: 'Writing',
  map: 'Places', guestbook: 'Guestbook', contact: 'Say hi',
};
/** Join a path onto the site base ("/collage-site"), e.g. url('projects') -> "/collage-site/projects". */
export function url(p = ''): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return p ? `${base}/${p.replace(/^\//, '')}` : `${base}/`;
}

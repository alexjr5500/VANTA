/**
 * goLiveEntry — the single source of truth for where every "Go Live" entry
 * point in VANTA navigates.
 *
 * REGRESSION GUARD
 * ---------------
 * The "+ Create → Go Live" action must open the dedicated VANTA Live
 * pre-stream screen and must NEVER open the normal video-recording / camera
 * capture flow (Create Post / Reel / Story). Keeping the destination in one
 * tested module makes that invariant executable instead of a comment. Both the
 * "+" Create hub (`CreateHub`) and the composer quick-action
 * (`CreatePostComposer`) resolve Go Live here.
 */
export const GO_LIVE_ROUTE = '/live/go-live';

/**
 * Routes owned by the normal media-capture/upload flows. Go Live must never
 * resolve to any of these — asserting the exclusion is a unit-testable form of
 * the product requirement "Go Live ≠ video recording".
 */
export const NON_LIVE_RECORD_ROUTES: readonly string[] = Object.freeze([
  '/create',
  '/create/post',
  '/create/video',
  '/create/reel',
  '/create/story',
  '/upload',
  '/reels',
]);

/**
 * True only for the dedicated VANTA Live pre-stream destination. Any other
 * route (especially a recording/upload route) is a routing regression.
 */
export function isGoLiveRoute(route: string): boolean {
  return route === GO_LIVE_ROUTE;
}

/**
 * Returns the route each create-action id resolves to. Go Live flavours
 * (`livestream` from the "+" Create hub, `live` from the composer quick
 * action) all land on the dedicated pre-stream screen. Actions routed through
 * modals instead of navigation (post/story/reel) resolve to ''.
 */
export function routeForCreateAction(actionId: string): string {
  switch (actionId) {
    case 'livestream':
    case 'live':
      return GO_LIVE_ROUTE;
    default:
      return '';
  }
}
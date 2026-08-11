// Collision groups.
//
// Rapier packs membership in the high 16 bits and the filter in the low 16.
// Two colliders interact when each is a member of a group the other filters
// for. Colliders left at the default belong to every group, so only the ones
// that need to be treated specially are tagged.
//
// The point of this is the camera. In a forest this dense, something is behind
// Sam almost always, and a camera that recoils from every bush spends the
// whole game pressed against his back. Foliage should be pushed through, not
// bounced off -- so the camera's probe only sees SOLID things.

export const GROUP_SOLID = 0x0001;
export const GROUP_SOFT = 0x0002;

/** Membership SOFT, still interacting with everything (Sam included). */
export const SOFT_GROUPS = (GROUP_SOFT << 16) | 0xffff;

/** What the camera probe is allowed to hit: solid geometry only. */
export const CAMERA_FILTER = (GROUP_SOLID << 16) | GROUP_SOLID;

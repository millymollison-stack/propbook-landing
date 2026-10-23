// Shared "has the user manually changed brand color or font THIS session"
// flag. Several places re-apply a property's saved brand_color/font_accent
// whenever property/scrapedProperty state updates (which happens on nearly
// every edit, not just when actually switching properties) -- without this
// guard, a still-in-flight or stale re-apply can silently revert a color or
// font the user just picked, back to the old saved value. David: "the
// changes to the fonts and colors kept swapping back... took 2 or 3 tries
// till it stuck." Once the user has picked something via a color/font
// picker this session, server/property-derived re-applies are skipped so
// they can't fight the user's own fresh choice.
let edited = false;

export function markAppearanceEdited() {
  edited = true;
}

export function hasAppearanceBeenEdited() {
  return edited;
}

// David 2026-10-22: "the font and color is decided by the admin and should
// then be displayed with that color and font for everyone... not something
// that is effected by who is looking at the site." Without this, `edited`
// stayed true for the rest of the browser tab's life once ANYONE touched
// the picker on ANY property (most often the owner, while building their
// own site) -- so navigating to a different property in the same tab, or
// just reloading later, could permanently block that OTHER property's own
// saved font/color from ever applying, leaving whatever was last manually
// picked stuck on screen instead. Call this once, before applying a
// property's saved appearance, whenever a page starts loading a (possibly
// different) property -- it only protects an in-progress, unsaved pick for
// the remainder of THAT property's current view, never across a switch.
export function resetAppearanceEdited() {
  edited = false;
}

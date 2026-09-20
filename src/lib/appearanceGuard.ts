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

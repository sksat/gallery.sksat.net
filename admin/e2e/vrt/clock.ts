// The access charts' time axes follow the clock: which column is 0時,
// where midnight falls and which hour is still filling change every hour.
// Screenshots take those labels and lines out ([data-clock]; masks would
// move with them). `display: none`, not `visibility: hidden`: a hidden
// label still takes its place, so the page's size could follow the clock.
// The columns, whose heights come from e2e/fake-graphql.mjs by position,
// stay.
export const CLOCK_STYLE = `[data-clock] { display: none !important; }`;

// The access charts' time axes follow the clock: which column is 0時,
// where midnight falls and which hour is still filling change every hour.
// Screenshots hide those labels and lines ([data-clock]; masks would move
// with them); the columns, whose heights come from e2e/fake-graphql.mjs
// by position, stay.
export const CLOCK_STYLE = `[data-clock] { visibility: hidden !important; }`;

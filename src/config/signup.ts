/**
 * Whether new shops can be created. Closed for now: the page is there, but trying to create a
 * shop shows who to contact, and the server refuses too. Set NEXT_PUBLIC_SIGNUP_ENABLED=1 (at
 * build time, as pages are built ahead) to open it again.
 */
export const SIGNUP_OPEN = process.env.NEXT_PUBLIC_SIGNUP_ENABLED === "1";

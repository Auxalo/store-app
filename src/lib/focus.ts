/**
 * Put the cursor back in a search box, but only on a computer (mouse or trackpad), where a barcode
 * scanner or the keyboard is how the next item is added. On a phone or tablet focusing a box opens
 * the on-screen keyboard over the list, which is the opposite of what a tap on a product wants.
 */
export function refocusOnComputer(input: HTMLElement | null | undefined) {
  if (!input) return;
  if (typeof window.matchMedia !== "function") return;
  if (window.matchMedia("(pointer: fine)").matches) input.focus();
}

/**
 * On a phone or tablet, once the on-screen keyboard is up, bring the box that was tapped to the
 * middle of what is left of the screen (a box low in a list could otherwise stay under the keyboard).
 * A computer has no such keyboard, so nothing moves there.
 */
export function keepInView(event: { currentTarget: HTMLElement }) {
  const box = event.currentTarget;
  if (typeof window.matchMedia !== "function") return;
  if (window.matchMedia("(pointer: fine)").matches) return;
  window.setTimeout(
    () => box.scrollIntoView?.({ block: "center", behavior: "smooth" }),
    350,
  );
}

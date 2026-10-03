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

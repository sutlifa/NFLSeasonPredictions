"use client";

import { useEffect } from "react";

const HIGHLIGHT_CLASS = "game-target";

/**
 * Rings the game card named in the URL fragment, for arrivals from a club's
 * schedule (/picks/5#game-123).
 *
 * This was a CSS `:target` rule first, which looked tidy and did not work.
 * Next navigates on the client, and a fragment applied through the History
 * API does not reliably re-evaluate `:target` -- verified in the browser:
 * the URL read /picks/1#game-16 and the card was scrolled into place, but
 * `document.querySelector('[id^="game-"]:target')` matched nothing. It only
 * worked on a full page load, which is the one case a link inside the app
 * never produces.
 *
 * So the class is applied directly to the node instead. This is a real
 * "synchronise with something outside React" effect -- the address bar --
 * and it deliberately touches the DOM rather than holding the highlighted id
 * in state: the ring is a transient flourish, not something any other part
 * of the page needs to know about.
 */
export function GameHashHighlight() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let highlighted: Element | null = null;

    const clear = () => {
      if (timer) clearTimeout(timer);
      highlighted?.classList.remove(HIGHLIGHT_CLASS);
      highlighted = null;
    };

    const apply = () => {
      clear();
      const id = window.location.hash.slice(1);
      if (!id.startsWith("game-")) return;
      // getElementById rather than a selector: an id from the URL is
      // arbitrary text and would need escaping to be safe in a selector.
      const element = document.getElementById(id);
      if (!element) return;

      highlighted = element;
      element.classList.add(HIGHLIGHT_CLASS);
      // Removed once the animation has run so that returning to the same
      // game later re-triggers it rather than finding the class already set.
      timer = setTimeout(() => {
        element.classList.remove(HIGHLIGHT_CLASS);
        highlighted = null;
      }, 3000);
    };

    apply();
    window.addEventListener("hashchange", apply);
    return () => {
      window.removeEventListener("hashchange", apply);
      clear();
    };
  }, []);

  return null;
}

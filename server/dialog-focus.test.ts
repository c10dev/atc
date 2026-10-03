import assert from "node:assert/strict";
import { test } from "node:test";
import { dockedEscapeAction, escapeAction, isTextEntry, trapMove } from "../web/src/kit/dialog-focus.ts";

test("trapMove: Tab wraps at the ends and enters from outside", () => {
  assert.equal(trapMove(2, 3, false), "first");
  assert.equal(trapMove(0, 3, true), "last");
  assert.equal(trapMove(1, 3, false), null);
  assert.equal(trapMove(1, 3, true), null);
  assert.equal(trapMove(-1, 3, false), "first");
  assert.equal(trapMove(-1, 3, true), "last");
  assert.equal(trapMove(-1, 0, false), "container");
});

test("isTextEntry: text fields yes, buttons and checkboxes no", () => {
  assert.equal(isTextEntry({ tagName: "TEXTAREA" }), true);
  assert.equal(isTextEntry({ tagName: "INPUT" }), true);
  assert.equal(isTextEntry({ tagName: "INPUT", type: "search" }), true);
  assert.equal(isTextEntry({ tagName: "INPUT", type: "checkbox" }), false);
  assert.equal(isTextEntry({ tagName: "BUTTON" }), false);
  assert.equal(isTextEntry({ tagName: "DIV", isContentEditable: true }), true);
  assert.equal(isTextEntry(null), false);
});

test("escapeAction: closes, but a text field only gives up focus", () => {
  assert.equal(escapeAction("Escape", { tagName: "ASIDE" }, false, false), "close");
  assert.equal(escapeAction("Escape", { tagName: "TEXTAREA" }, false, false), "leave-field");
  assert.equal(escapeAction("Escape", { tagName: "ASIDE" }, true, false), "ignore");
  assert.equal(escapeAction("Escape", { tagName: "ASIDE" }, false, true), "ignore");
  assert.equal(escapeAction("Enter", { tagName: "ASIDE" }, false, false), "ignore");
});

test("dockedEscapeAction: a text field outside the drawer is not the drawer's business (ATC-444)", () => {
  assert.equal(dockedEscapeAction("Escape", { tagName: "INPUT" }, false, false, false), "ignore");
  assert.equal(dockedEscapeAction("Escape", { tagName: "TEXTAREA" }, false, false, true), "leave-field");
  assert.equal(dockedEscapeAction("Escape", { tagName: "BUTTON" }, false, false, false), "close");
  assert.equal(dockedEscapeAction("Escape", { tagName: "BODY" }, false, false, false), "close");
  assert.equal(dockedEscapeAction("Escape", { tagName: "INPUT" }, true, false, true), "ignore");
});

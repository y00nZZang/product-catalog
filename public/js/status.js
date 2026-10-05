import { $ } from "./dom.js";
export function message(text, isError = false, target = "status") {
  $(target).textContent = text;
  $(target).classList.toggle("error", isError);
}

import { $ } from "/modules/dom.js";

export async function post(path, payload) {
  $(".results").classList.remove("hidden");
  setStatus("Working. SEC and market data calls can take a bit.", false);
  $("#result-table").innerHTML = "";
  $("#summary").innerHTML = "";
  $("#result-meta").textContent = "";

  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error || "Request failed.");
  return data;
}

export function setStatus(message, error = false) {
  const status = $("#status");
  status.textContent = message;
  status.classList.toggle("error", error);
}

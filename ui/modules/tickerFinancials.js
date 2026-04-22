import { state } from "/modules/state.js";
import { $ } from "/modules/dom.js";
import { post, setStatus } from "/modules/data.js";
import { renderTable } from "/modules/table.js";

export async function runTickerFinancials() {
  const ticker = state.ticker;
  if (!ticker) return;
  state.tickerView = $("#ticker-statement").value;
  const quarterly = $("#ticker-period").value === "true";
  const pivot = $("#ticker-pivot").value === "true";
  try {
    const data = await post("/api/ticker-financials", {
      ticker,
      view: state.tickerView,
      quarterly,
      pivot,
    });
    state.tickerFinancialsData = data.data;
    $("#result-title").textContent = data.title;
    renderTickerFinancialsTable();
  } catch (error) {
    setStatus(error.message, true);
  }
}

export function bindTickerFinancialsControls() {
  ["#ticker-statement", "#ticker-period", "#ticker-pivot"].forEach((sel) => {
    $(sel).addEventListener("change", () => {
      if (state.route === "ticker" && state.tickerMainTab === "financials") {
        runTickerFinancials();
      }
    });
  });

  $("#ticker-percentage-toggle")?.addEventListener("change", () => {
    if (!["regions", "segments"].includes(state.tickerView)) return;
    state.tickerFinancialsAsPercent = $("#ticker-percentage-toggle").checked;
    renderTickerFinancialsTable();
  });
}

function renderTickerFinancialsTable() {
  syncTickerFinancialsToggle();
  if (!state.tickerFinancialsData) return;
  const data = shouldShowTickerPercentages()
    ? percentageTable(state.tickerFinancialsData, state.tickerView)
    : state.tickerFinancialsData;
  renderTable(data);
}

function shouldShowTickerPercentages() {
  return state.tickerFinancialsAsPercent && ["regions", "segments"].includes(state.tickerView);
}

function syncTickerFinancialsToggle() {
  const wrap = $("#ticker-percentage-toggle-wrap");
  const input = $("#ticker-percentage-toggle");
  if (!wrap || !input) return;
  const enabled = ["regions", "segments"].includes(state.tickerView);
  wrap.classList.toggle("hidden", !enabled);
  input.checked = shouldShowTickerPercentages();
}

function percentageTable(data, view) {
  if (!data?.columns?.length || !Array.isArray(data.rows)) return data;
  const labelColumn = data.columns.includes(view.slice(0, -1)) ? view.slice(0, -1) : data.columns[0];
  const valueColumns = data.columns.filter((column) => column !== labelColumn && column !== "ticker");
  const totals = Object.fromEntries(
    valueColumns.map((column) => [
      column,
      data.rows.reduce(
        (sum, row) =>
          sum + (typeof row[column] === "number" && Number.isFinite(row[column]) ? row[column] : 0),
        0
      ),
    ])
  );
  return {
    ...data,
    rows: data.rows.map((row) => {
      const next = { ...row };
      valueColumns.forEach((column) => {
        const value = row[column];
        const total = totals[column];
        if (typeof value === "number" && Number.isFinite(value) && total) {
          next[column] = `${((value / total) * 100).toFixed(1)}%`;
        } else if (value === null || value === undefined || value === "") {
          next[column] = "";
        } else {
          next[column] = "—";
        }
      });
      return next;
    }),
  };
}

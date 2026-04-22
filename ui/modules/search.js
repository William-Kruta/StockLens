import { $ } from "/modules/dom.js";
import { escapeHtml } from "/modules/utils.js";

export function initSearch(openTickerPage) {
  const input = $("#search-input");
  const dropdown = $("#search-dropdown");
  let focusedIndex = -1;
  let debounceTimer = null;
  let lastQuery = "";

  function getItems() {
    return Array.from(dropdown.querySelectorAll(".search-item"));
  }

  function setFocused(index) {
    const items = getItems();
    items.forEach((item, i) => item.classList.toggle("focused", i === index));
    focusedIndex = index;
  }

  function closeDropdown() {
    dropdown.classList.remove("open");
    focusedIndex = -1;
  }

  function openDropdown() {
    if (dropdown.children.length > 0) dropdown.classList.add("open");
  }

  async function search(q) {
    if (q === lastQuery) return;
    lastQuery = q;

    if (!q.trim()) {
      dropdown.innerHTML = "";
      closeDropdown();
      return;
    }

    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    const results = await res.json();

    dropdown.innerHTML = "";
    focusedIndex = -1;

    if (!results.length) {
      const empty = document.createElement("li");
      empty.className = "search-empty";
      empty.textContent = "No matches";
      dropdown.appendChild(empty);
    } else {
      results.forEach(({ ticker, name }) => {
        const li = document.createElement("li");
        li.className = "search-item";
        li.setAttribute("role", "option");
        li.innerHTML = `<span class="search-item-ticker">${escapeHtml(ticker)}</span><span class="search-item-name">${escapeHtml(name)}</span>`;
        li.addEventListener("mousedown", (e) => {
          e.preventDefault();
          selectResult(ticker, name);
        });
        dropdown.appendChild(li);
      });
    }
    openDropdown();
  }

  function selectResult(ticker, name) {
    input.value = "";
    lastQuery = "";
    dropdown.innerHTML = "";
    closeDropdown();
    openTickerPage(ticker, name);
  }

  input.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => search(input.value.trim()), 150);
  });

  input.addEventListener("focus", () => {
    if (dropdown.children.length > 0) openDropdown();
  });

  input.addEventListener("blur", () => {
    setTimeout(closeDropdown, 150);
  });

  input.addEventListener("keydown", (e) => {
    const items = getItems().filter((item) => item.classList.contains("search-item"));
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocused(Math.min(focusedIndex + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocused(Math.max(focusedIndex - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (focusedIndex >= 0 && items[focusedIndex]) {
        const ticker = items[focusedIndex].querySelector(".search-item-ticker").textContent;
        const name = items[focusedIndex].querySelector(".search-item-name").textContent;
        selectResult(ticker, name);
      }
    } else if (e.key === "Escape") {
      closeDropdown();
      input.blur();
    }
  });
}

const API_URL = "https://data.cityofnewyork.us/resource/vfnx-vebw.json";
const PAGE_SIZE = 5000;
const LIST_LIMIT = 72;

const ACTIVITY_FIELDS = {
  running: "Running",
  chasing: "Chasing",
  climbing: "Climbing",
  eating: "Eating",
  foraging: "Foraging",
};

const REACTION_FIELDS = {
  approaches: "Approached people",
  indifferent: "Stayed indifferent",
  runs_from: "Ran away",
};

const MARKER_COLORS = {
  Gray: "#71847b",
  Cinnamon: "#d66b32",
  Black: "#1f3029",
  missing: "#e4c55c",
};

const numberFormat = new Intl.NumberFormat("en-US");
const dateTimeFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const state = {
  records: [],
  filtered: [],
  selectedKey: null,
  map: null,
  markerLayer: null,
  markerByKey: new Map(),
  visibleLimit: LIST_LIMIT,
  loading: false,
};

const elements = {
  filters: document.querySelector("#filters"),
  color: document.querySelector("#color-filter"),
  activity: document.querySelector("#activity-filter"),
  reaction: document.querySelector("#reaction-filter"),
  reset: document.querySelector("#reset-filters"),
  random: document.querySelector("#random-sighting"),
  status: document.querySelector("#load-status"),
  statusTitle: document.querySelector("#status-title"),
  statusMessage: document.querySelector("#status-message"),
  retry: document.querySelector("#retry-load"),
  resultsBar: document.querySelector("#results-bar"),
  resultCount: document.querySelector("#result-count"),
  mapStage: document.querySelector("#map-stage"),
  observationSection: document.querySelector("#observation-section"),
  list: document.querySelector("#observation-list"),
  listNote: document.querySelector("#list-note"),
  showMore: document.querySelector("#show-more"),
  emptyDetail: document.querySelector("#empty-detail"),
  detailContent: document.querySelector("#detail-content"),
  detailCard: document.querySelector("#sighting-card"),
};

function truthy(value) {
  return value === true || String(value).toLowerCase() === "true";
}

function parseCensusDate(value) {
  const match = String(value || "").match(/^(\d{2})(\d{2})(\d{4})$/);
  if (!match) return null;
  const [, month, day, year] = match;
  const date = new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day), 12),
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatCensusDate(record, includeYear = true) {
  const date = parseCensusDate(record.date);
  if (!date) return "Date not recorded";
  const label = date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: includeYear ? "numeric" : undefined,
    timeZone: "UTC",
  });
  return record.shift ? `${label} · ${record.shift}` : label;
}

function normalizeRecord(row, index) {
  const latitude = Number(row.y);
  const longitude = Number(row.x);

  return {
    ...row,
    internalKey: `observation-${index}`,
    latitude,
    longitude,
    validCoordinates:
      Number.isFinite(latitude) &&
      Number.isFinite(longitude) &&
      latitude >= -90 &&
      latitude <= 90 &&
      longitude >= -180 &&
      longitude <= 180,
    furColor: row.primary_fur_color || "missing",
  };
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(
      `NYC Open Data returned ${response.status} ${response.statusText}.`,
    );
  }

  const json = await response.json();
  if (!Array.isArray(json)) {
    throw new Error("NYC Open Data returned an unexpected response.");
  }
  return json;
}

async function loadAllSightings() {
  const records = [];

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const url = new URL(API_URL);
    url.searchParams.set("$limit", String(PAGE_SIZE));
    url.searchParams.set("$offset", String(offset));
    url.searchParams.set("$order", "unique_squirrel_id,:id");

    const page = await fetchJson(url);
    records.push(...page);

    if (page.length < PAGE_SIZE) break;
  }

  if (records.length === 0) {
    throw new Error(
      "The dataset loaded successfully but contained no sighting records.",
    );
  }

  const normalized = records.map(normalizeRecord);
  if (!normalized.some((record) => record.validCoordinates)) {
    throw new Error(
      "The sighting records did not contain usable map coordinates.",
    );
  }

  return normalized;
}

function initializeMap() {
  if (!window.L) {
    throw new Error("The map library could not be loaded.");
  }
  if (state.map) return;

  state.map = L.map("map", {
    zoomControl: false,
    minZoom: 12,
    maxZoom: 19,
  }).setView([40.7829, -73.9654], 14);

  L.control.zoom({ position: "bottomright" }).addTo(state.map);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  }).addTo(state.map);

  state.markerLayer = L.layerGroup().addTo(state.map);
}

function recordMatches(record) {
  const color = elements.color.value;
  const activity = elements.activity.value;
  const reaction = elements.reaction.value;

  return (
    (color === "all" || record.furColor === color) &&
    (activity === "all" || truthy(record[activity])) &&
    (reaction === "all" || truthy(record[reaction]))
  );
}

function activityLabels(record) {
  return Object.entries(ACTIVITY_FIELDS)
    .filter(([field]) => truthy(record[field]))
    .map(([, label]) => label);
}

function reactionLabels(record) {
  return Object.entries(REACTION_FIELDS)
    .filter(([field]) => truthy(record[field]))
    .map(([, label]) => label);
}

function briefActivity(record) {
  const activities = activityLabels(record);
  if (activities.length) return activities.slice(0, 2).join(" + ");
  if (record.other_activities) return record.other_activities;
  return "No activity recorded";
}

function markerColor(record) {
  return MARKER_COLORS[record.furColor] || MARKER_COLORS.missing;
}

function defaultMarkerStyle(record) {
  return {
    radius: 4,
    color: "#ffffff",
    weight: 1,
    opacity: 0.95,
    fillColor: markerColor(record),
    fillOpacity: 0.88,
  };
}

function makeTag(text) {
  const tag = document.createElement("span");
  tag.textContent = text;
  return tag;
}

function setOptionalText(element, value, fallback = "") {
  element.textContent = value || fallback;
  element.hidden = !element.textContent;
}

function renderDetail(record) {
  if (!record) {
    elements.emptyDetail.hidden = false;
    elements.detailContent.hidden = true;
    return;
  }

  elements.emptyDetail.hidden = true;
  elements.detailContent.hidden = false;

  const colorLabel =
    record.furColor === "missing"
      ? "Fur color not recorded"
      : `${record.furColor} fur`;
  const activities = activityLabels(record);
  const reactions = reactionLabels(record);
  const article = /^[aeiou]/i.test(colorLabel) ? "An" : "A";
  const subject =
    record.furColor === "missing"
      ? "A squirrel in the field notes"
      : `${article} ${record.furColor.toLowerCase()} squirrel`;

  document.querySelector("#detail-swatch").style.background =
    markerColor(record);
  document.querySelector("#detail-fur").textContent = colorLabel;
  document.querySelector("#detail-id").textContent =
    record.unique_squirrel_id || "Observation ID not recorded";
  document.querySelector("#detail-title").textContent = activities.length
    ? `${subject}, ${activities[0].toLowerCase()}`
    : subject;
  document.querySelector("#detail-date").textContent = formatCensusDate(record);
  document.querySelector("#detail-age").textContent =
    record.age && record.age !== "?" ? record.age : "Not recorded";
  document.querySelector("#detail-location").textContent =
    record.location || "Not recorded";

  const activitiesContainer = document.querySelector("#detail-activities");
  activitiesContainer.replaceChildren(
    ...(activities.length ? activities : ["No listed activity"]).map(makeTag),
  );

  const reactionsContainer = document.querySelector("#detail-reactions");
  reactionsContainer.replaceChildren(
    ...(reactions.length ? reactions : ["No listed reaction"]).map(makeTag),
  );

  setOptionalText(
    document.querySelector("#detail-other-activity"),
    record.other_activities,
  );
  setOptionalText(
    document.querySelector("#detail-other-interaction"),
    record.other_interactions,
  );
  setOptionalText(
    document.querySelector("#detail-specific"),
    record.specific_location
      ? `Location note: ${record.specific_location}`
      : "",
  );
}

function selectRecord(record, { moveMap = true, scroll = false } = {}) {
  if (!record) return;

  const previous = state.records.find(
    (candidate) => candidate.internalKey === state.selectedKey,
  );
  const previousMarker =
    previous && state.markerByKey.get(previous.internalKey);
  if (previousMarker) previousMarker.setStyle(defaultMarkerStyle(previous));

  state.selectedKey = record.internalKey;
  renderDetail(record);
  renderObservationList();

  if (moveMap && record.validCoordinates) {
    const destination = [record.latitude, record.longitude];
    const zoom = Math.max(state.map.getZoom(), 16);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      state.map.setView(destination, zoom);
    } else {
      state.map.flyTo(destination, zoom, { duration: 0.65 });
    }
  }

  const marker = state.markerByKey.get(record.internalKey);
  if (marker) {
    marker.setStyle({ radius: 7, weight: 3, color: "#fff8df" });
    marker.bringToFront();
  }

  if (scroll && window.matchMedia("(max-width: 900px)").matches) {
    elements.detailCard.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      block: "start",
    });
  }

  if (scroll) elements.detailCard.focus({ preventScroll: true });
}

function renderMarkers({ fit = false } = {}) {
  state.markerLayer.clearLayers();
  state.markerByKey.clear();
  const bounds = [];

  state.filtered.forEach((record) => {
    if (!record.validCoordinates) return;

    const marker = L.circleMarker(
      [record.latitude, record.longitude],
      record.internalKey === state.selectedKey
        ? {
            ...defaultMarkerStyle(record),
            radius: 7,
            color: "#fff8df",
            weight: 3,
          }
        : defaultMarkerStyle(record),
    );
    marker.on("click", () =>
      selectRecord(record, { moveMap: false, scroll: true }),
    );
    marker.addTo(state.markerLayer);
    state.markerByKey.set(record.internalKey, marker);
    bounds.push([record.latitude, record.longitude]);
  });

  if (fit && bounds.length) {
    state.map.fitBounds(bounds, { padding: [28, 28], maxZoom: 16 });
  }
}

function renderObservationList() {
  const visible = state.filtered.slice(0, state.visibleLimit);
  const fragment = document.createDocumentFragment();

  visible.forEach((record) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    const swatch = document.createElement("span");
    const copy = document.createElement("span");
    const id = document.createElement("span");
    const meta = document.createElement("span");
    const arrow = document.createElement("span");

    button.type = "button";
    button.className = "observation-button";
    if (record.internalKey === state.selectedKey)
      button.classList.add("selected");
    button.setAttribute(
      "aria-label",
      `Open ${record.unique_squirrel_id || "squirrel observation"} from ${formatCensusDate(record, false)}`,
    );

    swatch.className = "list-swatch";
    swatch.style.background = markerColor(record);
    copy.className = "list-copy";
    id.className = "observation-id";
    id.textContent = record.unique_squirrel_id || "ID not recorded";
    meta.className = "list-meta";
    meta.textContent = `${record.furColor === "missing" ? "Color not recorded" : record.furColor} · ${briefActivity(record)} · ${formatCensusDate(record, false)}`;
    arrow.className = "list-arrow";
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = "↗";

    copy.append(id, meta);
    button.append(swatch, copy, arrow);
    button.addEventListener("click", () =>
      selectRecord(record, { scroll: true }),
    );
    item.append(button);
    fragment.append(item);
  });

  elements.list.replaceChildren(fragment);

  if (state.filtered.length > state.visibleLimit) {
    elements.listNote.textContent = `Showing ${numberFormat.format(visible.length)} of ${numberFormat.format(state.filtered.length)}. Every match appears on the map.`;
  } else if (state.filtered.length) {
    elements.listNote.textContent = "All matching records are shown.";
  } else {
    elements.listNote.textContent = "Change a filter to bring sightings back.";
  }
  elements.showMore.hidden = state.filtered.length <= state.visibleLimit;
  elements.showMore.textContent = `Show ${numberFormat.format(Math.min(LIST_LIMIT, state.filtered.length - state.visibleLimit))} more observations`;
}

function renderResults({ fitMap = false } = {}) {
  state.filtered = state.records.filter(recordMatches);

  if (
    state.selectedKey &&
    !state.filtered.some((record) => record.internalKey === state.selectedKey)
  ) {
    state.selectedKey = null;
    renderDetail(null);
  }

  const count = state.filtered.length;
  elements.resultCount.textContent = `${numberFormat.format(count)} ${count === 1 ? "sighting" : "sightings"} match`;
  elements.random.disabled = count === 0;
  renderMarkers({ fit: fitMap });
  renderObservationList();
}

function showLoading() {
  state.loading = true;
  elements.status.hidden = false;
  elements.status.classList.remove("error");
  elements.statusTitle.textContent = "Gathering the field notes…";
  elements.statusMessage.textContent =
    "Loading every sighting from NYC Open Data.";
  elements.retry.hidden = true;
  elements.filters.setAttribute("aria-busy", "true");
  elements.filters.querySelectorAll("select, button").forEach((control) => {
    control.disabled = true;
  });
}

function showError(error) {
  state.loading = false;
  elements.status.hidden = false;
  elements.status.classList.add("error");
  elements.statusTitle.textContent = "The field notes could not be loaded.";
  elements.statusMessage.textContent =
    error instanceof Error
      ? error.message
      : "Check your connection and try again.";
  elements.retry.hidden = false;
  elements.filters.removeAttribute("aria-busy");
  elements.retry.disabled = false;
}

function showExplorer() {
  elements.status.hidden = true;
  elements.resultsBar.hidden = false;
  elements.mapStage.hidden = false;
  elements.observationSection.hidden = false;
  elements.filters.removeAttribute("aria-busy");
  elements.filters.querySelectorAll("select, button").forEach((control) => {
    control.disabled = false;
  });
}

function updateSourceFacts() {
  const dates = state.records
    .map((record) => parseCensusDate(record.date))
    .filter(Boolean)
    .sort((a, b) => a - b);
  const uniqueDays = new Set(
    dates.map((date) => date.toISOString().slice(0, 10)),
  );
  const uniqueIds = new Set(
    state.records.map((record) => record.unique_squirrel_id).filter(Boolean),
  );
  const repeatedRows = state.records.length - uniqueIds.size;

  document.querySelector("#hero-count").textContent = numberFormat.format(
    state.records.length,
  );
  document.querySelector("#stamp-days").textContent =
    `${uniqueDays.size} census days`;
  document.querySelector("#source-count").textContent =
    `${numberFormat.format(state.records.length)} sighting records`;
  document.querySelector("#retrieved-at").textContent = dateTimeFormat.format(
    new Date(),
  );

  if (dates.length) {
    const options = {
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    };
    document.querySelector("#coverage-dates").textContent =
      `${dates[0].toLocaleDateString("en-US", options)} – ${dates.at(-1).toLocaleDateString("en-US", options)}`;
  }

  const method = document.querySelector("#method-note");
  method.textContent = `Historical 2018 snapshot from the 2018 Central Park Squirrel Census. ${numberFormat.format(uniqueIds.size)} distinct source IDs appear in ${numberFormat.format(state.records.length)} sighting records${repeatedRows ? `; the ${repeatedRows} additional records that share an ID are retained` : ""}. The explorer reads NYC Open Data directly.`;
}

async function load() {
  showLoading();

  try {
    const records = await loadAllSightings();
    state.records = records;
    initializeMap();
    updateSourceFacts();
    showExplorer();
    state.map.invalidateSize();
    renderResults({ fitMap: true });
    state.loading = false;
  } catch (error) {
    showError(error);
  }
}

elements.filters.addEventListener("change", () => {
  state.visibleLimit = LIST_LIMIT;
  renderResults({ fitMap: true });
});

elements.reset.addEventListener("click", () => {
  elements.filters.reset();
  state.visibleLimit = LIST_LIMIT;
  renderResults({ fitMap: true });
});

elements.random.addEventListener("click", () => {
  if (!state.filtered.length) return;
  const record =
    state.filtered[Math.floor(Math.random() * state.filtered.length)];
  selectRecord(record, { scroll: true });
});

elements.retry.addEventListener("click", load);

elements.showMore.addEventListener("click", () => {
  state.visibleLimit += LIST_LIMIT;
  renderObservationList();
});

load();

// Native HTML5 drag-and-drop for activity cards.
// Reorders within a day column and moves between day columns.
// Calls onDrop(itinerary) after every successful drop so callers can persist.

let draggedCard = null;
let draggedDayIndex = null;
let draggedActivityIndex = null;

/** @type {(itinerary: object) => void} */
let dropCallback = null;

/** @type {object} — live reference to the itinerary being mutated */
let itinerary = null;

/**
 * Initialize drag-and-drop on the #day-columns container.
 * @param {object} currentItinerary — mutable itinerary object from state
 * @param {(itinerary: object) => void} onDrop — called after each successful drop
 */
export function initDragDrop(currentItinerary, onDrop) {
  itinerary = currentItinerary;
  dropCallback = onDrop;
  attachListeners();
}

/** Re-attach after the DOM is re-rendered with new activity cards */
export function refreshDragDrop() {
  attachListeners();
}

function attachListeners() {
  document.querySelectorAll('.activity-card').forEach(card => {
    card.setAttribute('draggable', 'true');
    card.addEventListener('dragstart', handleDragStart);
    card.addEventListener('dragend', handleDragEnd);
  });

  document.querySelectorAll('.day-column').forEach(col => {
    col.addEventListener('dragover', handleDragOver);
    col.addEventListener('dragleave', handleDragLeave);
    col.addEventListener('drop', handleDrop);
  });
}

function handleDragStart(e) {
  draggedCard = e.currentTarget;
  draggedDayIndex = parseInt(draggedCard.dataset.dayIndex, 10);
  draggedActivityIndex = parseInt(draggedCard.dataset.activityIndex, 10);
  draggedCard.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', '');
}

function handleDragEnd() {
  if (draggedCard) draggedCard.classList.remove('dragging');
  document.querySelectorAll('.day-column').forEach(col => col.classList.remove('drag-over'));
  document.querySelectorAll('.drop-indicator').forEach(el => el.classList.remove('visible'));
  draggedCard = null;
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const col = e.currentTarget;
  col.classList.add('drag-over');

  // Show drop indicator at cursor position
  const list = col.querySelector('.activity-list');
  const indicators = list.querySelectorAll('.drop-indicator');
  indicators.forEach(i => i.classList.remove('visible'));

  const afterCard = getDragAfterElement(list, e.clientY);
  if (afterCard) {
    const indicator = afterCard.previousElementSibling;
    if (indicator?.classList.contains('drop-indicator')) {
      indicator.classList.add('visible');
    }
  } else {
    const last = indicators[indicators.length - 1];
    if (last) last.classList.add('visible');
  }
}

function handleDragLeave(e) {
  if (!e.currentTarget.contains(e.relatedTarget)) {
    e.currentTarget.classList.remove('drag-over');
  }
}

function handleDrop(e) {
  e.preventDefault();
  const col = e.currentTarget;
  col.classList.remove('drag-over');

  const targetDayIndex = parseInt(col.dataset.dayIndex, 10);
  const list = col.querySelector('.activity-list');
  const afterCard = getDragAfterElement(list, e.clientY);

  let targetActivityIndex;
  if (afterCard) {
    targetActivityIndex = parseInt(afterCard.dataset.activityIndex, 10);
  } else {
    targetActivityIndex = itinerary.days[targetDayIndex].activities.length;
  }

  // Mutate itinerary
  const sourceDay = itinerary.days[draggedDayIndex];
  const [moved] = sourceDay.activities.splice(draggedActivityIndex, 1);

  const targetDay = itinerary.days[targetDayIndex];
  // Adjust index if moving within the same day and source was before target
  let insertAt = targetActivityIndex;
  if (draggedDayIndex === targetDayIndex && draggedActivityIndex < targetActivityIndex) {
    insertAt = Math.max(0, targetActivityIndex - 1);
  }
  targetDay.activities.splice(insertAt, 0, moved);

  dropCallback(itinerary);
}

/** Returns the card element that the dragged item should be inserted BEFORE, or null (insert at end). */
function getDragAfterElement(list, y) {
  const cards = [...list.querySelectorAll('.activity-card:not(.dragging)')];
  return cards.reduce((closest, card) => {
    const box = card.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) {
      return { offset, element: card };
    }
    return closest;
  }, { offset: Number.NEGATIVE_INFINITY }).element || null;
}

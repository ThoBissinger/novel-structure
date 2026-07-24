// ---------------------------------------------------------------------------
// Shared id-keyed reconciliation for a container holding a list of custom
// elements (TodoRowElement, QuickTodoRowElement, TodoSceneGroupElement, …) —
// reuses existing rows in place (via `update`, which triggers that row's own
// diff-and-skip) instead of wiping the container and rebuilding every child
// on every data change. Every list-holding element in this directory builds
// on this instead of hand-rolling the same loop.
// ---------------------------------------------------------------------------

export function reconcileChildrenById<TItem, TEl extends HTMLElement>(
  container: HTMLElement,
  tag: string,
  items: TItem[],
  getId: (item: TItem) => string,
  create: (item: TItem) => TEl,
  update: (el: TEl, item: TItem) => void
): void {
  // Direct children only — deliberately not querySelectorAll, so a
  // container never accidentally picks up same-tag elements nested two
  // levels down inside one of its own children.
  const existing = new Map<string, TEl>();
  Array.from(container.children).forEach((child) => {
    if (child.tagName.toLowerCase() !== tag) return;
    const el = child as TEl;
    const id = el.dataset.reconcileId;
    if (id) existing.set(id, el);
  });

  const nextIds = items.map(getId);
  const seen = new Set<string>();
  let prevEl: TEl | null = null;
  let orderChanged = false;

  items.forEach((item, i) => {
    const id = nextIds[i];
    seen.add(id);
    let el = existing.get(id);
    if (el) {
      update(el, item);
    } else {
      el = create(item);
      el.dataset.reconcileId = id;
      orderChanged = true;
    }
    const shouldFollow = prevEl ? prevEl.nextElementSibling !== el : container.firstElementChild !== el;
    if (shouldFollow) {
      orderChanged = true;
      if (prevEl) {
        prevEl.after(el);
      } else {
        container.prepend(el);
      }
    }
    prevEl = el;
  });

  existing.forEach((el, id) => {
    if (!seen.has(id)) el.remove();
  });

  void orderChanged;
}

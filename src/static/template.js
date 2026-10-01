// Template — a small, dependency-free template engine. Not a UI framework:
// no virtual DOM, no reactivity, nothing watches for changes. It exists so
// view markup lives as declarative <template> HTML (with data-field/
// data-when/data-unless/data-bind attributes), not as .map(...).join("")
// string concatenation inside a fetch handler — that mixing of "get the
// data" and "build the markup" in one function was the actual complaint;
// this is the fix, sized to a project with no build step and no framework
// dependency anywhere else.
//
// Supported bindings, read off elements inside a <template>:
//   data-field="key"        el.textContent = String(data[key])
//   data-when="key"         element stays in the DOM only if data[key] is truthy
//   data-unless="key"       element stays in the DOM only if data[key] is falsy
//   data-bind="attr:key"    el.setAttribute(attr, data[key]) — space-separate for more than one
window.Template = (() => {
  function applyBindings(root, data) {
    for (const el of root.querySelectorAll("[data-field]")) {
      const value = data[el.dataset.field];
      el.textContent = value == null ? "" : String(value);
    }

    for (const el of root.querySelectorAll("[data-when]")) {
      if (!data[el.dataset.when]) el.remove();
    }

    for (const el of root.querySelectorAll("[data-unless]")) {
      if (data[el.dataset.unless]) el.remove();
    }

    for (const el of root.querySelectorAll("[data-bind]")) {
      for (const pair of el.dataset.bind.split(" ")) {
        const [attr, key] = pair.split(":");
        const value = data[key];
        if (value != null) el.setAttribute(attr, String(value));
      }
    }

    return root;
  }

  function render(templateId, data) {
    const tpl = document.getElementById(templateId);
    if (!(tpl instanceof HTMLTemplateElement)) {
      throw new Error(`Template#${templateId} not found or not a <template>`);
    }
    const node = tpl.content.firstElementChild.cloneNode(true);
    return applyBindings(node, data);
  }

  function renderInto(container, templateId, items) {
    const frag = document.createDocumentFragment();
    for (const item of items) frag.appendChild(render(templateId, item));
    container.replaceChildren(frag);
  }

  return { render, renderInto };
})();
